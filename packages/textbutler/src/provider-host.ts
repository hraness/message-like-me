import { join } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import { AgentRouter, AgentStoppedError, unqualifiedAdapter, type AgentAdapter, type RuntimeQualification } from "../../agentrouter/src/runtime.ts";
import { createClaudeApiAdapter, type ClaudeApiAdapterOptions } from "../../agentrouter/src/claude-api.ts";
import { createFileClaudeApiKeyResolver } from "../../agentrouter/src/claude-credentials.ts";
import { discoverClaudeModels, type ClaudeModelDiscoveryOptions } from "../../agentrouter/src/claude-api-models.ts";
import { selectClassifierModel, type ModelCatalog } from "../../agentrouter/src/models.ts";
import type { AccountLeaseStore } from "../../agentrouter/src/accounts.ts";
import type { ProviderAccountConfig, HostConfig } from "./host-config.ts";
import type { ContactSettings } from "./config.ts";
import type { ProviderSelection } from "./routed-agent.ts";
import type { ProviderAccountDiagnostic } from "../../control/src/index.ts";

export type { ProviderAccountDiagnostic } from "../../control/src/index.ts";
export interface ProviderHost {
  readonly router: AgentRouter;
  accounts(): readonly ProviderAccountDiagnostic[];
  check(accountId: string, signal: AbortSignal): Promise<void>;
  selection(contact: ContactSettings): Promise<ProviderSelection>;
  validateAccountChange(previous: ContactSettings, next: { provider: "claude" | "codex"; accountId?: string }): void;
  close(): Promise<void>;
}
type Dependencies = {
  createAdapter: (options: ClaudeApiAdapterOptions) => Promise<AgentAdapter>;
  discover: (options: ClaudeModelDiscoveryOptions) => Promise<ModelCatalog>;
};

/** Owner account wiring. Configuration contains references; it never grants tool authority. */
export function createProviderHost(options: {
  dataDir: string;
  config: HostConfig;
  leases: AccountLeaseStore;
  runtimeArtifact?: ClaudeApiAdapterOptions["runtimeArtifact"];
  now?: () => number;
}, dependencies: Dependencies = { createAdapter: createClaudeApiAdapter, discover: discoverClaudeModels }): ProviderHost {
  const accounts: readonly ProviderAccountConfig[] = [
    { id: "native-codex", label: "Codex", route: "codex" },
    { id: "native-claude-code", label: "Claude Code", route: "claude-code" },
    ...(options.config.providerAccounts ?? []),
  ], now = options.now ?? Date.now;
  const shutdown = new AbortController(), pending = new Set<Promise<unknown>>();
  const credentials = createFileClaudeApiKeyResolver({ directory: join(options.dataDir, "state", "provider-credentials"),
    bindings: Object.fromEntries(accounts.filter((account): account is ProviderAccountConfig & { route: "claude-api" } => account.route === "claude-api").map(account => [account.id, account.credentialFile])) });
  const adapters = new Map<string, AgentAdapter>(), catalogs = new Map<string, ModelCatalog>();
  const generations = new Map<string, AbortController>(), credentialPins = new Map<string, string>();
  const checking = new Map<string, Promise<void>>(), fingerprintKey = randomBytes(32);
  const fingerprint = (key: string) => createHmac("sha256", fingerprintKey).update(key).digest("hex");
  const retire = (id: string) => { generations.get(id)?.abort(); generations.delete(id); adapters.delete(id); catalogs.delete(id); };
  const failures = new Set<string>();
  const currentModels = (account: ProviderAccountConfig, value: ModelCatalog | undefined): boolean => account.route === "claude-api"
    && account.prices.observedAt <= now() && account.prices.observedAt >= now() - 30 * 86_400_000
    && value !== undefined && value.observedAt <= now() && value.observedAt >= now() - 86_400_000;
  const qualified = (): RuntimeQualification => [...adapters.values()].find(adapter => adapter.qualification.status === "qualified" && adapter.qualification.expiresAt > now())?.qualification
    ?? { status: "unqualified", reason: "No explicitly configured Claude API account is ready." };
  const route: AgentAdapter = { provider: "claude", get qualification() { return qualified(); },
    async run(request, broker) {
      if (shutdown.signal.aborted || accounts.find(account => account.id === request.accountId)?.route !== "claude-api") throw new AgentStoppedError("PROVIDER_ROUTE_UNAVAILABLE");
      const adapter = adapters.get(request.accountId), generation = generations.get(request.accountId);
      if (!adapter || !generation) throw new AgentStoppedError("PROVIDER_ACCOUNT_UNAVAILABLE");
      const task = adapter.run({ ...request, signal: AbortSignal.any([request.signal, shutdown.signal, generation.signal]) }, broker);
      pending.add(task); try { return await task; } finally { pending.delete(task); }
    } };
  async function refresh(account: ProviderAccountConfig, externalSignal: AbortSignal, allowCredentialChange: boolean): Promise<void> {
    if (account.route !== "claude-api" || !options.runtimeArtifact) throw new Error("Provider route is not admitted");
    const generation = new AbortController(), signal = AbortSignal.any([externalSignal, shutdown.signal, generation.signal]); signal.throwIfAborted();
    retire(account.id);
    let pinned: string | undefined, admitting = true;
    const pinnedCredentials: ClaudeApiAdapterOptions["credentials"] = { async withApiKey(id, external, run) {
      if (id !== account.id || !pinned || !admitting && generations.get(id) !== generation) throw new Error("Provider credential generation is unavailable");
      const scopedSignal = AbortSignal.any([external, shutdown.signal, generation.signal]); scopedSignal.throwIfAborted();
      try {
        return await credentials.withApiKey(id, scopedSignal, async key => {
          if (fingerprint(key) !== pinned) throw new Error("Provider credential changed");
          scopedSignal.throwIfAborted(); return run(key);
        });
      } catch (error) {
        generation.abort();
        if (generations.get(id) === generation) { retire(id); failures.add(id); }
        throw error;
      }
    } };
    try {
      // Verify the reviewed compiled artifact before opening a credential or network.
      const adapter = await dependencies.createAdapter({ runtimeArtifact: options.runtimeArtifact, credentials: pinnedCredentials,
        modelCatalog: async accountId => {
          if (accountId !== account.id || shutdown.signal.aborted || generations.get(accountId) !== generation) throw new Error("Provider account revoked");
          const value = catalogs.get(accountId); if (!value) throw new Error("Provider models unavailable"); return value;
        }, maxBudgetUsd: account.maxBudgetUsd, now });
      await credentials.withApiKey(account.id, signal, async key => {
        pinned = fingerprint(key);
        if (!allowCredentialChange && credentialPins.has(account.id) && credentialPins.get(account.id) !== pinned) throw new Error("Check the replacement credential explicitly");
      });
      const modelCatalog = await dependencies.discover({ credentials: pinnedCredentials, accountId: account.id, priceCatalog: account.prices, signal, now });
      if (!currentModels(account, modelCatalog) || !modelCatalog.models.some(model => model.id === account.replyModel && model.available && model.supportsStructuredOutput)) throw new Error("Reply model is unavailable");
      selectClassifierModel(modelCatalog, now());
      await pinnedCredentials.withApiKey(account.id, signal, async () => {}); signal.throwIfAborted();
      generations.set(account.id, generation); credentialPins.set(account.id, pinned!); admitting = false;
      catalogs.set(account.id, modelCatalog); adapters.set(account.id, adapter); failures.delete(account.id);
    } finally { if (admitting) generation.abort(); }
  }
  const check = async (accountId: string, signal: AbortSignal, allowCredentialChange = true) => {
    signal.throwIfAborted();
    const existing = checking.get(accountId); if (existing) { await existing; signal.throwIfAborted(); return; }
    const account = accounts.find(account => account.id === accountId);
    if (!account) throw new Error("Unknown provider account");
    const task = refresh(account, signal, allowCredentialChange).catch(() => { failures.add(accountId); retire(accountId); throw new Error("Provider setup could not be verified. Check the selected credential, models, prices and compiled runtime."); });
    pending.add(task); checking.set(accountId, task);
    try { await task; }
    finally { pending.delete(task); checking.delete(accountId); }
  };
  return {
    router: new AgentRouter({ adapters: [route, unqualifiedAdapter("codex")], leases: options.leases, now }),
    accounts() { return accounts.map(account => {
      const provider = account.route === "codex" ? "codex" as const : "claude" as const;
      const modelCatalog = catalogs.get(account.id), adapter = adapters.get(account.id);
      const ready = !shutdown.signal.aborted && currentModels(account, modelCatalog)
        && adapter?.qualification.status === "qualified" && adapter.qualification.expiresAt > now();
      return { id: account.id, label: account.label, provider, route: account.route,
        status: ready ? "ready" as const : account.route !== "claude-api" ? "unavailable" as const : "setup-required" as const,
        detail: account.route !== "claude-api" ? "This coding-agent route is not qualified for contact-scoped execution. No API fallback is used."
          : !options.runtimeArtifact ? "Claude API requires a reviewed compiled runtime. Source-mode execution is unavailable."
          : failures.has(account.id) ? "Check the selected credential file, model access and current price catalog."
          : ready ? "Claude API account and models are available. This does not enable message delivery."
          : "Check this explicit Claude API account to verify model access. API usage is billed separately from coding-agent subscriptions.",
        defaultReplyModel: account.route === "claude-api" ? account.replyModel : null,
        classifierModel: ready ? selectClassifierModel(modelCatalog!, now()).id : null };
    }); },
    check,
    async selection(contact) {
      const account = accounts.find(account => account.id === contact.accountId);
      if (!account || account.route !== "claude-api" || contact.provider !== "claude" || shutdown.signal.aborted) throw new Error("The selected coding-agent account is unavailable; no API substitution is permitted.");
      const modelCatalog = catalogs.get(account.id), adapter = adapters.get(account.id);
      if (!currentModels(account, modelCatalog) || adapter?.qualification.status !== "qualified" || adapter.qualification.expiresAt <= now()) {
        await check(account.id, shutdown.signal, false);
      }
      return { qualification: adapters.get(account.id)!.qualification, modelCatalog: catalogs.get(account.id)!, defaultReplyModel: account.replyModel };
    },
    validateAccountChange(previous, next) {
      const id = next.accountId ?? previous.accountId, account = accounts.find(value => value.id === id);
      if (next.accountId !== undefined && ((!account && id !== previous.accountId) || account && (account.route === "codex" ? "codex" : "claude") !== next.provider)) throw new Error("Choose a configured account for this provider.");
      if (account?.route === "claude-api" && next.accountId === undefined && previous.provider !== next.provider) throw new Error("Choose the Claude API account explicitly; changing provider alone does not authorize API billing.");
    },
    async close() { shutdown.abort(); await Promise.allSettled([...pending]); },
  };
}
