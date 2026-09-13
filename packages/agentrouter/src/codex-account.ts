import type { AccountLease, AccountLeaseStore } from "./accounts.ts";
import { boundedText, identifier, safeInteger } from "./validation.ts";

/** Host-only managed ChatGPT authentication. This is not an execution qualification.
 * Projection contract: admitted native v2 GetAccountResponse, LoginAccountResponse,
 * CancelLoginAccountResponse and ModelListResponse schemas (0.153.4). The host must
 * independently admit its current runtime/schema before constructing a transport.
 */
export type CodexAccountState = "unchecked" | "signed-out" | "signing-in" | "signed-in" | "unavailable" | "recovery-required" | "closed";
export type CodexManagedLoginMethod = "chatgpt" | "chatgptDeviceCode";
export type CodexLoginChallenge = Readonly<
  { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
>;
export type CodexAccountModel = Readonly<{
  id: string; model: string; displayName: string; hidden: boolean; isDefault: boolean;
  supportedReasoningEfforts: readonly string[]; defaultReasoningEffort: string;
  serviceTiers: readonly Readonly<{ id: string; name: string; description: string }>[];
  defaultServiceTier: string | null;
}>;
export type CodexAccountSnapshot = Readonly<{
  accountId: string; state: CodexAccountState; accountGeneration: number; processGeneration: number;
  models: readonly CodexAccountModel[]; pendingLoginId: string | null; planType?: string; detail?: string;
}>;
export type CodexAccountBinding = Readonly<{
  accountId: string; owner: string; leaseGeneration: number; processGeneration: number;
}>;
export type CodexAccountRequest = Readonly<{
  binding: CodexAccountBinding; accountGeneration: number; signal: AbortSignal; deadlineMs: number;
}>;
export type CodexAccountResponse = Readonly<{
  binding: CodexAccountBinding; accountGeneration: number; value: unknown;
}>;
export type CodexAccountEvent = Readonly<{
  binding: CodexAccountBinding;
  type: "account-updated" | "login-completed" | "disconnected";
  loginId?: string | null; success?: boolean;
}>;
export type CodexAccountCloseReceipt = Readonly<{
  binding: CodexAccountBinding;
  processExited: boolean; processGroupStopped: boolean;
  stdoutEnded: boolean; stderrEnded: boolean;
  writesSettled: boolean; requestsSettled: boolean; notificationsSettled: boolean;
}>;
/**
 * Trusted implementation owns initialize, runtime/schema admission, credential home,
 * and process custody. There is deliberately no raw RPC, token export or turn method.
 * Return the handle before asynchronous launch, so close can join failed launches.
 */
export interface CodexAccountTransport {
  accountRead(request: CodexAccountRequest & { refreshToken: false }): Promise<CodexAccountResponse>;
  startLogin(request: CodexAccountRequest & { method: CodexManagedLoginMethod }): Promise<CodexAccountResponse>;
  cancelLogin(request: CodexAccountRequest & { loginId: string }): Promise<CodexAccountResponse>;
  logout(request: CodexAccountRequest): Promise<CodexAccountResponse>;
  listModels(request: CodexAccountRequest & { cursor: string | null; limit: 100; includeHidden: true }): Promise<CodexAccountResponse>;
  close(request: { binding: CodexAccountBinding; deadlineMs: number }): Promise<CodexAccountCloseReceipt>;
}
export type ManagedCodexAccountOptions = Readonly<{
  accountId: string; owner: string; processGeneration: number; leases: AccountLeaseStore;
  transportFactory: (binding: CodexAccountBinding, onEvent: (event: CodexAccountEvent) => void) => CodexAccountTransport;
  now?: () => number; operationTimeoutMs?: number; closeTimeoutMs?: number;
}>;
export interface ManagedCodexAccountController {
  snapshot(): CodexAccountSnapshot;
  check(signal?: AbortSignal): Promise<CodexAccountSnapshot>;
  startLogin(method: CodexManagedLoginMethod, signal?: AbortSignal): Promise<CodexLoginChallenge>;
  cancelLogin(loginId: string, signal?: AbortSignal): Promise<Readonly<{ status: "canceled" | "notFound" }>>;
  logout(signal?: AbortSignal): Promise<CodexAccountSnapshot>;
  close(): Promise<Readonly<{ released: boolean; state: "closed" | "recovery-required" }>>;
}

export function createManagedCodexAccountController(options: ManagedCodexAccountOptions): ManagedCodexAccountController {
  const accountId = identifier(options.accountId), owner = identifier(options.owner);
  const processGeneration = safeInteger(options.processGeneration, 1, Number.MAX_SAFE_INTEGER);
  const now = options.now ?? Date.now;
  const operationTimeoutMs = safeInteger(options.operationTimeoutMs ?? 40_000, 1, 120_000);
  const closeTimeoutMs = safeInteger(options.closeTimeoutMs ?? 10_000, 1, 120_000);
  let accountGeneration = 1;
  let pendingLogin: string | undefined;
  let snapshot: CodexAccountSnapshot = freezeSnapshot("unchecked");
  let lease: AccountLease | undefined, binding: CodexAccountBinding | undefined, transport: CodexAccountTransport | undefined;
  let loginDispatch = false;
  const earlyLoginCompletions = new Map<string, boolean>();
  let active: AbortController | undefined;
  const unsettled = new Set<Promise<unknown>>();
  let closing = false;
  let closeTask: Promise<Readonly<{ released: boolean; state: "closed" | "recovery-required" }>> | undefined;

  function freezeSnapshot(state: CodexAccountState, extra: { models?: readonly CodexAccountModel[]; planType?: string; detail?: string } = {}): CodexAccountSnapshot {
    return Object.freeze({ accountId, state, accountGeneration, processGeneration, models: Object.freeze([]), pendingLoginId: pendingLogin ?? null, ...extra });
  }
  function publish(state: CodexAccountState, extra?: Parameters<typeof freezeSnapshot>[1]): void { snapshot = freezeSnapshot(state, extra); }
  function invalidate(state: CodexAccountState, detail?: string): void {
    accountGeneration = safeInteger(accountGeneration + 1, 1, Number.MAX_SAFE_INTEGER);
    publish(state, detail === undefined ? {} : { detail });
  }
  function onEvent(event: CodexAccountEvent): void {
    if (closing || binding === undefined || !sameBinding(event.binding, binding)) return;
    if (event.type === "login-completed") {
      if (typeof event.loginId !== "string" || typeof event.success !== "boolean") return;
      if (pendingLogin === undefined && loginDispatch) {
        // Native notifications can precede the login/start response carrying its ID.
        // Admission is already closed; correlate only after that response arrives.
        if (event.loginId.length <= 160 && earlyLoginCompletions.size < 8) earlyLoginCompletions.set(event.loginId, event.success);
        return;
      }
      if (event.loginId !== pendingLogin) return;
    }
    if (event.type !== "account-updated" && event.type !== "login-completed" && event.type !== "disconnected") return;
    pendingLogin = undefined;
    // Synchronous invalidation is the authority barrier. Only check() can reopen it.
    invalidate(event.type === "disconnected" ? "unavailable" : "unchecked", event.type === "disconnected" ? "CODEX_ACCOUNT_DISCONNECTED" : event.type === "login-completed" && !event.success ? "CODEX_LOGIN_FAILED" : undefined);
    active?.abort();
  }
  function ensureTransport(): CodexAccountTransport {
    if (transport !== undefined) return transport;
    if (lease !== undefined) throw new Error("CODEX_ACCOUNT_RECOVERY_REQUIRED");
    lease = options.leases.acquire({ provider: "codex", accountId, owner, now: now(), ttlMs: 120_000 });
    binding = Object.freeze({ accountId, owner, leaseGeneration: lease.generation, processGeneration });
    try { transport = options.transportFactory(binding, onEvent); }
    catch { publish("recovery-required", { detail: "CODEX_ACCOUNT_FACTORY_FAILED" }); throw new Error("CODEX_ACCOUNT_FACTORY_FAILED"); }
    return transport;
  }
  function assertCurrent(request: CodexAccountRequest): void {
    if (closing || request.signal.aborted || request.accountGeneration !== accountGeneration || binding === undefined || !sameBinding(request.binding, binding)) throw new Error("CODEX_ACCOUNT_STALE");
  }
  function response(request: CodexAccountRequest, result: CodexAccountResponse): unknown {
    assertCurrent(request);
    if (result === null || typeof result !== "object" || !sameBinding(result.binding, request.binding) || result.accountGeneration !== request.accountGeneration) throw new Error("CODEX_ACCOUNT_STALE");
    return result.value;
  }
  async function run<T>(signal: AbortSignal | undefined, action: (driver: CodexAccountTransport, request: CodexAccountRequest) => Promise<T>): Promise<T> {
    if (closing || snapshot.state === "closed" || snapshot.state === "recovery-required") throw new Error("CODEX_ACCOUNT_UNAVAILABLE");
    if (signal?.aborted) throw new Error("CODEX_ACCOUNT_ABORTED");
    if (active !== undefined) throw new Error("CODEX_ACCOUNT_BUSY");
    const controller = new AbortController(); active = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    invalidate("unchecked");
    const generation = accountGeneration;
    let task: Promise<T> | undefined;
    try {
      const driver = ensureTransport();
      const request = Object.freeze({ binding: binding!, accountGeneration: generation, signal: controller.signal, deadlineMs: now() + operationTimeoutMs });
      task = Promise.resolve().then(async () => { assertCurrent(request); return action(driver, request); });
      unsettled.add(task);
      const retainedTask = task;
      void task.finally(() => { unsettled.delete(retainedTask); if (active === controller) active = undefined; }).catch(() => {});
      return await bounded(task, operationTimeoutMs, controller.signal, () => controller.abort());
    } catch (error) {
      if (generation === accountGeneration && !closing && (snapshot.state as CodexAccountState) !== "recovery-required") publish("unavailable", { detail: error instanceof Error && error.message === "CODEX_ACCOUNT_TIMEOUT" ? "CODEX_ACCOUNT_TIMEOUT" : "CODEX_ACCOUNT_OPERATION_FAILED" });
      throw new Error(error instanceof Error && ["CODEX_ACCOUNT_BUSY", "CODEX_ACCOUNT_TIMEOUT", "CODEX_ACCOUNT_ABORTED", "CODEX_ACCOUNT_STALE", "CODEX_ACCOUNT_FACTORY_FAILED"].includes(error.message) ? error.message : "CODEX_ACCOUNT_OPERATION_FAILED");
    } finally {
      signal?.removeEventListener("abort", abort);
      if (task === undefined && active === controller) active = undefined;
    }
  }
  async function read(driver: CodexAccountTransport, request: CodexAccountRequest): Promise<CodexAccountSnapshot> {
    const result = record(response(request, await driver.accountRead({ ...request, refreshToken: false })));
    if (typeof result.requiresOpenaiAuth !== "boolean") throw new Error("INVALID_ACCOUNT_RESPONSE");
    if (!result.requiresOpenaiAuth) { publish("unavailable", { detail: "CODEX_SUBSCRIPTION_REQUIRED" }); return snapshot; }
    if (result.account === null || result.account === undefined) { publish(pendingLogin === undefined ? "signed-out" : "signing-in"); return snapshot; }
    const account = record(result.account);
    if (account.type !== "chatgpt") { publish("unavailable", { detail: "CODEX_SUBSCRIPTION_REQUIRED" }); return snapshot; }
    const planType = cleanText(account.planType, 128);
    if (!["free", "go", "plus", "pro", "prolite", "team", "self_serve_business_prolite", "self_serve_business_usage_based", "business", "ent26", "enterprise_cbp_automation", "enterprise_cbp_usage_based", "enterprise", "edu", "edu_plus", "edu_pro", "unknown"].includes(planType)) throw new Error("INVALID_ACCOUNT_PLAN");
    const models: CodexAccountModel[] = [], cursors = new Set<string>(), ids = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      assertCurrent(request);
      const result = record(response(request, await driver.listModels({ ...request, cursor, limit: 100, includeHidden: true })));
      if (!Array.isArray(result.data) || result.data.length > 500 || models.length + result.data.length > 5_000) throw new Error("INVALID_MODEL_CATALOG");
      for (const value of result.data) {
        const model = parseModel(value);
        if (ids.has(model.id)) throw new Error("DUPLICATE_MODEL");
        ids.add(model.id); models.push(model);
      }
      cursor = result.nextCursor === null || result.nextCursor === undefined ? null : cleanText(result.nextCursor, 4_096);
      if (cursor === null) { publish("signed-in", { planType, models: Object.freeze(models) }); return snapshot; }
      if (cursors.has(cursor)) throw new Error("REPEATED_MODEL_CURSOR");
      cursors.add(cursor);
    }
    throw new Error("MODEL_PAGE_LIMIT");
  }
  return Object.freeze({
    snapshot: () => snapshot,
    check: (signal?: AbortSignal) => run(signal, read),
    startLogin: (method: CodexManagedLoginMethod, signal?: AbortSignal) => {
      if (method !== "chatgpt" && method !== "chatgptDeviceCode") return Promise.reject(new Error("CODEX_MANAGED_LOGIN_REQUIRED"));
      if (pendingLogin !== undefined) return Promise.reject(new Error("CODEX_LOGIN_PENDING"));
      return run(signal, async (driver, request) => {
        loginDispatch = true;
        try {
          const challenge = parseChallenge(response(request, await driver.startLogin({ ...request, method })), method);
          if (earlyLoginCompletions.has(challenge.loginId)) {
            const success = earlyLoginCompletions.get(challenge.loginId)!;
            invalidate("unchecked", success ? undefined : "CODEX_LOGIN_FAILED");
            throw new Error("CODEX_ACCOUNT_STALE");
          }
          pendingLogin = challenge.loginId; publish("signing-in"); return challenge;
        } finally { loginDispatch = false; earlyLoginCompletions.clear(); }
      });
    },
    cancelLogin: (loginId: string, signal?: AbortSignal) => {
      try { cleanText(loginId, 160); } catch { return Promise.reject(new Error("INVALID_LOGIN_ID")); }
      if (loginId !== pendingLogin) return Promise.reject(new Error("CODEX_LOGIN_STALE"));
      return run(signal, async (driver, request) => {
        const value = record(response(request, await driver.cancelLogin({ ...request, loginId })));
        if (value.status !== "canceled" && value.status !== "notFound") throw new Error("INVALID_LOGIN_CANCEL");
        pendingLogin = undefined; publish("unchecked");
        return Object.freeze({ status: value.status });
      });
    },
    logout: (signal?: AbortSignal) => run(signal, async (driver, request) => {
      const value = record(response(request, await driver.logout(request)));
      if (Object.keys(value).length !== 0) throw new Error("INVALID_LOGOUT_RESULT");
      pendingLogin = undefined;
      return read(driver, request);
    }),
    close: () => {
      if (closeTask !== undefined) return closeTask;
      closing = true;
      // Publish the shared promise before abort listeners or a trusted close
      // implementation can synchronously reenter and duplicate cleanup.
      const task = Promise.resolve().then(async () => {
        active?.abort(); pendingLogin = undefined; invalidate("unchecked");
        if (lease === undefined) { publish("closed"); return Object.freeze({ released: true, state: "closed" as const }); }
        try {
          if (transport === undefined || binding === undefined) throw new Error("CLOSE_UNPROVEN");
          const deadlineMs = now() + closeTimeoutMs;
          const remaining = () => {
            const duration = deadlineMs - now();
            if (duration <= 0) throw new Error("CLOSE_UNPROVEN");
            return Math.min(duration, closeTimeoutMs);
          };
          const receipt = await bounded(transport.close({ binding, deadlineMs }), remaining());
          await bounded(Promise.allSettled([...unsettled]), remaining());
          if (!sameBinding(receipt.binding, binding) || receipt.processExited !== true || receipt.processGroupStopped !== true || receipt.stdoutEnded !== true || receipt.stderrEnded !== true || receipt.writesSettled !== true || receipt.requestsSettled !== true || receipt.notificationsSettled !== true || unsettled.size !== 0) throw new Error("CLOSE_UNPROVEN");
          if (!options.leases.release(lease)) throw new Error("LEASE_RELEASE_UNPROVEN");
          publish("closed"); return Object.freeze({ released: true, state: "closed" as const });
        } catch { publish("recovery-required", { detail: "CODEX_ACCOUNT_STOP_UNPROVEN" }); return Object.freeze({ released: false, state: "recovery-required" as const }); }
      });
      closeTask = task;
      void task.then(result => { if (!result.released && closeTask === task) closeTask = undefined; });
      return task;
    },
  });
}

function sameBinding(a: CodexAccountBinding | undefined, b: CodexAccountBinding): boolean {
  return a !== undefined && a !== null && a.accountId === b.accountId && a.owner === b.owner && a.leaseGeneration === b.leaseGeneration && a.processGeneration === b.processGeneration;
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_CODEX_RESPONSE");
  return value as Record<string, unknown>;
}
function cleanText(value: unknown, max: number, empty = false): string {
  const text = boundedText(value, max, empty);
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(text)) throw new Error("INVALID_CODEX_TEXT");
  return text;
}
function parseModel(value: unknown): CodexAccountModel {
  const model = record(value);
  if (typeof model.hidden !== "boolean" || typeof model.isDefault !== "boolean" || !Array.isArray(model.supportedReasoningEfforts) || model.supportedReasoningEfforts.length > 32) throw new Error("INVALID_CODEX_MODEL");
  const efforts = model.supportedReasoningEfforts.map(value => cleanText(record(value).reasoningEffort, 128));
  if (new Set(efforts).size !== efforts.length) throw new Error("DUPLICATE_MODEL_EFFORT");
  const tiers = model.serviceTiers ?? [];
  if (!Array.isArray(tiers) || tiers.length > 32) throw new Error("INVALID_CODEX_TIERS");
  const serviceTiers = tiers.map(value => { const tier = record(value); return Object.freeze({ id: cleanText(tier.id, 160), name: cleanText(tier.name, 256), description: cleanText(tier.description, 2_048, true) }); });
  if (new Set(serviceTiers.map(tier => tier.id)).size !== serviceTiers.length) throw new Error("DUPLICATE_MODEL_TIER");
  return Object.freeze({ id: cleanText(model.id, 160), model: cleanText(model.model, 160), displayName: cleanText(model.displayName, 512), hidden: model.hidden, isDefault: model.isDefault, supportedReasoningEfforts: Object.freeze(efforts), defaultReasoningEffort: cleanText(model.defaultReasoningEffort, 128), serviceTiers: Object.freeze(serviceTiers), defaultServiceTier: model.defaultServiceTier === undefined || model.defaultServiceTier === null ? null : cleanText(model.defaultServiceTier, 128) });
}
function parseChallenge(value: unknown, method: CodexManagedLoginMethod): CodexLoginChallenge {
  const challenge = record(value);
  if (challenge.type !== method) throw new Error("UNEXPECTED_LOGIN_METHOD");
  const loginId = cleanText(challenge.loginId, 160);
  if (method === "chatgpt") return Object.freeze({ type: method, loginId, authUrl: loginUrl(challenge.authUrl) });
  return Object.freeze({ type: method, loginId, verificationUrl: loginUrl(challenge.verificationUrl), userCode: cleanText(challenge.userCode, 128) });
}
function loginUrl(value: unknown): string {
  const text = cleanText(value, 8_192), url = new URL(text);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || !["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(url.hostname)) throw new Error("INVALID_LOGIN_URL");
  return text;
}
function bounded<T>(task: Promise<T>, timeoutMs: number, signal?: AbortSignal, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => finish(() => reject(new Error("CODEX_ACCOUNT_ABORTED")));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); fn(); };
    timer = setTimeout(() => finish(() => { reject(new Error("CODEX_ACCOUNT_TIMEOUT")); onTimeout?.(); }), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    task.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}
