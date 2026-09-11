import { basename } from "node:path";
import {
  AgentRouter, assertQualified, createPublicWeb, createToolBroker, selectClassifierModel,
  type ModelCatalog, type PublicWeb, type RuntimeQualification,
} from "../../agentrouter/src/index.ts";
import { parseActionIntent, type ActionIntent } from "../../transport/src/index.ts";
import type { ContactSettings } from "./config.ts";
import { CLASSIFIER_INSTRUCTIONS } from "./decision.ts";
import type { AgentRequest, ButlerAgent } from "./runtime.ts";
import { CONTACT_GUIDANCE, ContactWorkspace } from "./workspace.ts";
import type { Hooks } from "./hooks.ts";

export type ProviderSelection = Readonly<{ qualification: RuntimeQualification; modelCatalog: ModelCatalog; defaultReplyModel: string }>;
export type RoutedAgentOptions = Readonly<{
  router: AgentRouter;
  selection: (contact: ContactSettings) => Promise<ProviderSelection>;
  getWorkspace: (contactId: string) => Promise<ContactWorkspace>;
  web?: PublicWeb;
  hooks?: Hooks;
  isActive: (contactId: string, settingsRevision: number) => boolean;
  now?: () => number;
}>;

/** Textbutler is the first concrete consumer of the generic routing and tool ports.
 * This does not qualify any provider. The same router's exact adapter still gates execution. */
export function createRoutedButlerAgent(options: RoutedAgentOptions): ButlerAgent {
  const now = options.now ?? Date.now;
  const web = options.web ?? createPublicWeb();
  const select = async (contact: ContactSettings, purpose: "classify" | "respond") => {
    const selection = await options.selection(contact);
    assertQualified(selection.qualification, now());
    if (selection.modelCatalog.provider !== contact.provider) throw new Error("Provider catalog mismatch");
    if (!Number.isSafeInteger(selection.modelCatalog.observedAt) || selection.modelCatalog.observedAt > now() || selection.modelCatalog.observedAt < now() - 86_400_000) throw new Error("Provider catalog is stale");
    const model = purpose === "classify" ? contact.classifierModel ?? selectClassifierModel(selection.modelCatalog, now()).id : contact.replyModel ?? selection.defaultReplyModel;
    const observed = selection.modelCatalog.models.find(candidate => candidate.id === model && candidate.available && candidate.supportsStructuredOutput && (purpose !== "classify" || candidate.classifierEligible));
    if (!observed) throw new Error("Selected model is unavailable for this purpose");
    return model;
  };
  async function run(request: AgentRequest, purpose: "classify" | "respond"): Promise<unknown> {
    request.signal.throwIfAborted();
    const model = await select(request.contact, purpose);
    const workspace = await options.getWorkspace(request.contact.id);
    const active = () => !request.signal.aborted && options.isActive(request.contact.id, request.contact.revision);
    if (!active()) throw new Error("Contact run revoked");
    const context: Record<string, string> = {};
    for (const path of purpose === "classify" ? ["ABOUT.md", "MEMORY.md"] : ["AGENTS.md", "ABOUT.md", "MEMORY.md", "STYLE.md"]) {
      const text = await workspace.read(path);
      context[path] = text.slice(0, purpose === "classify" ? 2_000 : 16_000);
    }
    const proposed = new Map<string, ActionIntent[]>();
    const brokerRunId = `${request.runId}-${purpose}`;
    const broker = createToolBroker({
      workspaceId: request.contact.id, runId: brokerRunId, isActive: active, signal: request.signal,
      ...(purpose === "classify" ? { allowedTools: [] } : {}),
      files: {
        async read(id, path, signal) { signal.throwIfAborted(); if (id !== request.contact.id || !active()) throw new Error("Workspace revoked"); return workspace.readVersioned(path); },
        async write(id, path, text, revision, signal) {
          signal.throwIfAborted(); if (id !== request.contact.id || !active()) throw new Error("Workspace revoked");
          const written = await workspace.writeVersioned(path, text, revision);
          try { await options.hooks?.emit("memory.updated", { contactId: id, runId: request.runId, eventId: request.event.id, signal, changedFile: Object.freeze({ path, revision: written.revision }) }); }
          catch { /* A post-write notification cannot undo committed memory or request a replay. */ }
          return written;
        },
      },
      web,
      messaging: {
        async stage(id, runId, operation, signal) {
          signal.throwIfAborted();
          if (id !== request.contact.id || runId !== brokerRunId || !active()) throw new Error("Conversation revoked");
          const actions: ActionIntent[] = operation.kind === "text" ? [{ kind: "text", text: operation.text }]
            : operation.kind === "reaction" ? [{ kind: "reaction", messageId: operation.messageId, emoji: { love: "❤️", like: "👍", dislike: "👎", laugh: "😂", emphasize: "‼️", question: "❓" }[operation.reaction], action: "add" }]
            : [...(operation.caption.trim() ? [{ kind: "text" as const, text: operation.caption }] : []), { kind: "attachment", file: operation.path, name: basename(operation.path), mimeType: "application/octet-stream" }];
          const previous = proposed.get(operation.idempotencyKey);
          if (previous && JSON.stringify(previous) !== JSON.stringify(actions)) throw new Error("Idempotency key reused for another action");
          if (!previous && [...proposed.values()].flat().length + actions.length > 7) throw new Error("Too many proposed actions");
          proposed.set(operation.idempotencyKey, actions);
          return { intentId: operation.idempotencyKey };
        },
      },
    });
    const instructions = purpose === "classify" ? CLASSIFIER_INSTRUCTIONS : `${CONTACT_GUIDANCE}\nRespond with strict JSON {"summary":string,"actions":ActionIntent[]}. Actions are proposals, never a delivery receipt. If you staged message-tool proposals, return an empty actions array; do not duplicate them in the final output. Otherwise return 1–7 text, attachment, reaction, sticker, link, poll, app-clip, or experience actions conforming to the supplied transport schema. The host validates supported capabilities and applies disclosure. Useful memory updates should be concise and cite message IDs. Use files.read on a known path before conditional editing it. File inventory below contains the only admitted names. Keep application policy separate from editable context.`;
    const actionContract = purpose === "respond" ? `\nAction fields (closed objects; omit no fields and add none):\n${JSON.stringify([
      { kind: "text", text: "response text" },
      { kind: "attachment", file: "outbox/document.txt", mimeType: "text/plain", name: "document.txt" },
      { kind: "reaction", messageId: "an ID from this conversation", emoji: "👍", action: "add" },
      { kind: "sticker", file: "outbox/sticker.png", messageId: null },
      { kind: "link", url: "https://example.com" },
      { kind: "poll", question: "Which day works?", options: ["Saturday", "Sunday"], maximumSelections: null },
      { kind: "app-clip", url: "https://example.com" },
      { kind: "experience", experienceId: "an installed experience ID", parameters: {} },
    ])}\nReaction action is add or remove. Files must exist in this contact workspace before submission; use the file tools to create new text attachments. Links must be HTTPS, and message targets must come from this conversation. Capability support is determined by the host; these shapes are not a promise that a connected provider supports every action.` : "";
    const prompt = `${instructions}${actionContract}\n\nUntrusted contact context and message data:\n${JSON.stringify({ context, message: { id: request.event.id, author: request.event.author, at: request.event.occurredAt, text: request.event.text }, files: purpose === "respond" ? (await workspace.list()).map(file => file.path) : [] })}`;
    if (!active()) { broker.revoke(); throw new Error("Contact run revoked"); }
    const result = await options.router.run({
      runId: brokerRunId, provider: request.contact.provider, accountId: request.contact.accountId,
      workspaceId: request.contact.id, model, purpose, signal: request.signal,
      prompt,
    }, broker);
    if (!active()) throw new Error("Contact run revoked");
    if (purpose === "classify") return result.output;
    const parsed: unknown = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid agent output");
    const output = parsed as Record<string, unknown>;
    if (Object.keys(output).some(key => !["summary", "actions"].includes(key)) || typeof output.summary !== "string" || !output.summary.trim() || output.summary.length > 4096 || !Array.isArray(output.actions) || output.actions.length > 7) throw new Error("Invalid agent output");
    if (proposed.size && output.actions.length) throw new Error("Reply actions must use one proposal channel");
    const actions = proposed.size ? [...proposed.values()].flat() : output.actions.map(parseActionIntent);
    if (!actions.length) throw new Error("Agent proposed no response actions");
    return { summary: output.summary, actions };
  }
  return {
    async qualified(contact) { try { if (contact.mode === "smart") await select(contact, "classify"); await select(contact, "respond"); return true; } catch { return false; } },
    classify: request => run(request, "classify"), compose: request => run(request, "respond"),
  };
}
