import { describe, expect, test } from "bun:test";
import { createGhostgetTransport, type GhostgetInvocation } from "./ghostget";
import { ghostgetCommand } from "./cli";
import { parseActionIntent } from "./validation";
import type { ActionIntent, ActionPlan } from "./types";

const candidate = `wmroute_${"a".repeat(22)}`, resolved = `wmroute_${"b".repeat(22)}`, contextId = `wmcontext_${"c".repeat(22)}`, planDigest = "d".repeat(64);
const expiresAt = "2026-09-11T14:00:00.000Z", now = "2026-09-11T12:00:00.000Z";
function harness(change?: (request: GhostgetInvocation, output: Record<string, unknown>) => unknown) {
  const calls: GhostgetInvocation[] = []; let prepared: Record<string, unknown> | undefined;
  const route = (id: string) => ({ schemaVersion: 2, format: "wrench.messaging-route", routeRef: id, network: "imessage", conversation: { kind: "single", title: "Synthetic person", participantCount: 2 }, expiresAt });
  const transport = createGhostgetTransport({ authId: "synthetic", clock: () => new Date(now), invoke: async request => {
    calls.push(request); let output: Record<string, unknown>;
    switch (request.command) {
      case "capabilities": output = { ok: true, adapters: [{ id: "imessage-direct", surfaceId: "imessage", operations: ["messaging.list", "conversations.read", "messaging.read", "messaging.send"].map(id => ({ id, state: "observed", transport: "local-cli", surface: "imessage", localCliAction: id, localCliContractVersion: 1 })) }] }; break;
      case "messaging.routes": output = { schemaVersion: 2, format: "wrench.messaging-routes", routes: [route(candidate)] }; break;
      case "messaging.resolve": output = route(resolved); break;
      case "messaging.context": output = { schemaVersion: 1, format: "wrench.messaging-context", network: "imessage", liveness: "fresh-as-of-live-preflight", truncated: false, completeness: { kind: "bounded-local" }, binding: { schemaVersion: 2, format: "wrench.messaging-context-binding", routeRef: resolved, contextRef: contextId, exactDataRevision: "e".repeat(64), expiresAt }, messages: [{ messageRef: `wmreply_${"f".repeat(22)}`, direction: "incoming", time: now, body: "butler hello", bodyTruncated: false, untrustedData: true }] }; break;
      case "messaging.preview": prepared = request.input; output = { schemaVersion: 1, format: "wrench.messaging-preview", status: "confirmation-required", risk: "R3", planDigest, expiresAt, routeRef: prepared.routeRef, contextRef: prepared.contextRef, clientIntentSha256: prepared.clientIntentSha256, partCount: (prepared.parts as unknown[]).length, bubbles: (prepared.parts as Record<string, unknown>[]).map(part => ({ text: part.text, replyRef: part.replyRef, partId: part.partId })), recipient: { network: "imessage" } }; break;
      case "confirm": output = { schemaVersion: 1, format: "wrench.messaging-run", planDigest, routeRef: resolved, contextRef: contextId, clientIntentSha256: prepared?.clientIntentSha256, state: "submitted", partCount: 1, provenPartCount: 1, runId: "synthetic-run", recordedAt: now }; break;
    }
    return change === undefined ? output : change(request, output);
  } });
  const prepare = async (): Promise<ActionPlan> => {
    const history = await transport.history({ conversationId: candidate }); expect(history.ok).toBe(true);
    const result = await transport.prepare({ intentId: "synthetic-intent", conversationId: resolved, contextId, actions: [{ kind: "text", text: "🤖{ Hello }" }] });
    if (!result.ok) throw new Error(result.error.message); return result.value;
  };
  return { calls, transport, prepare };
}

describe("Ghostget contact-bound transport seam", () => {
  test("negotiates real contract versions and reports absent autonomy and rich features", async () => {
    const { transport } = harness(); const result = await transport.capabilities();
    expect(result.ok && result.value.capabilities.filter(entry => entry.available).map(entry => entry.capability)).toEqual(["history", "text"]);
    expect((await transport.contacts()).ok).toBe(false);
    expect((await transport.events({ conversationIds: [candidate], cursor: null })).ok).toBe(false);
  });
  test("does not treat a future or unrelated executable contract as supported", async () => {
    const { transport } = harness((request, output) => request.command === "capabilities" ? { ok: true, adapters: [{ id: "imessage-direct", surfaceId: "imessage", operations: [{ id: "messaging.send", localCliAction: "messaging.send", localCliContractVersion: 2, surface: "imessage", transport: "local-cli", state: "observed" }] }] } : output);
    const result = await transport.capabilities(); expect(result.ok && result.value.capabilities.every(entry => !entry.available)).toBe(true);
  });
  test("uses newly resolved route references and preserves bounded history coverage", async () => {
    const { transport, calls } = harness();
    expect((await transport.conversations()).ok).toBe(true);
    const result = await transport.history({ conversationId: candidate });
    expect(result.ok && result.value).toMatchObject({ conversationId: resolved, contextId, complete: false, nextCursor: null });
    expect(calls.find(call => call.command === "messaging.context")).toMatchObject({ input: { routeRef: resolved } });
    expect((await transport.history({ conversationId: resolved })).ok).toBe(true);
    expect(calls.filter(call => call.command === "messaging.resolve")).toHaveLength(1);
  });
  test("rejects context belonging to another conversation", async () => {
    const { transport } = harness((request, output) => request.command === "messaging.context" ? { ...output, binding: { ...(output.binding as object), routeRef: candidate } } : output);
    expect(await transport.history({ conversationId: candidate })).toMatchObject({ ok: false, error: { code: "contract-mismatch" } });
  });
  test("does not invent history pagination", async () => {
    const { transport, calls } = harness();
    expect(await transport.history({ conversationId: candidate, cursor: "offset-100" })).toMatchObject({ ok: false, error: { code: "unsupported" } });
    expect(calls).toHaveLength(0);
  });
  test("prepares exact text with canonical field-order independent comparison", async () => {
    const { prepare, calls } = harness(); const plan = await prepare();
    expect(plan.digest).toBe(planDigest);
    expect(calls.find(call => call.command === "messaging.preview")).toMatchObject({ input: { format: "wrench.messaging-turn", routeRef: resolved, contextRef: contextId, parts: [{ partId: "part-1", text: "🤖{ Hello }", replyRef: null }] } });
  });
  test("rejects provider preview text substitution", async () => {
    const { transport } = harness((request, output) => request.command === "messaging.preview" ? { ...output, bubbles: [{ partId: "part-1", text: "Changed", replyRef: null }] } : output);
    await transport.history({ conversationId: candidate });
    expect(await transport.prepare({ intentId: "id", conversationId: resolved, contextId, actions: [{ kind: "text", text: "Original" }] })).toMatchObject({ ok: false, error: { code: "contract-mismatch" } });
  });
  test("delegated sends fail before confirm, exact manual send has one claim", async () => {
    const { prepare, transport, calls } = harness(); const plan = await prepare();
    expect(await transport.submit(plan, { mode: "delegated", grantId: "activated-contact" })).toMatchObject({ ok: false, error: { capability: "autonomous-send" } });
    const result = await transport.submit(plan, { mode: "owner-confirmed", planDigest });
    expect(result).toMatchObject({ ok: true, value: { state: "submitted", delivery: "unknown", retryable: false, submittedCount: 1 } });
    expect((await transport.submit(plan, { mode: "owner-confirmed", planDigest })).ok).toBe(false);
    expect(calls.filter(call => call.command === "confirm")).toHaveLength(1);
  });
  test("a lost or mismatched result is indeterminate and never retried", async () => {
    const { prepare, transport, calls } = harness((request, output) => { if (request.command === "confirm") throw new Error("secret diagnostic must not escape"); return output; });
    const plan = await prepare(); const result = await transport.submit(plan, { mode: "owner-confirmed", planDigest });
    expect(result).toMatchObject({ ok: false, error: { code: "indeterminate", retryable: false } });
    expect(JSON.stringify(result)).not.toContain("secret diagnostic");
    await transport.submit(plan, { mode: "owner-confirmed", planDigest });
    expect(calls.filter(call => call.command === "confirm")).toHaveLength(1);
  });
  test("rich intents stay explicit unsupported actions, never silently become text", async () => {
    const actions: readonly ActionIntent[] = [
      { kind: "attachment", file: "files/test.pdf", mimeType: "application/pdf", name: "test.pdf" },
      { kind: "reaction", messageId: "msg", emoji: "👍", action: "add" }, { kind: "sticker", file: "files/sticker.png", messageId: null },
      { kind: "link", url: "https://example.com/" }, { kind: "app-clip", url: "https://example.com/app" }, { kind: "experience", experienceId: "quiz", parameters: { question: "Synthetic?" } },
    ];
    const { transport, calls } = harness();
    for (const action of actions) expect(await transport.prepare({ intentId: "id", conversationId: resolved, contextId, actions: [action] })).toMatchObject({ ok: false, error: { code: "unsupported", capability: action.kind } });
    expect(calls).toHaveLength(0);
  });
  test("rich intent parser rejects escapes, executable values and invalid URLs", () => {
    expect(() => parseActionIntent({ kind: "attachment", file: "../secret", mimeType: "text/plain", name: "x" })).toThrow();
    expect(() => parseActionIntent({ kind: "link", url: "file:///private/data" })).toThrow();
    expect(() => parseActionIntent({ kind: "experience", experienceId: "x", parameters: { toJSON: () => "hidden" } })).toThrow();
  });
  test("CLI requests pass private data only over stdin and confirm uses both private files", () => {
    expect(ghostgetCommand({ command: "messaging.preview", input: { text: "private" } }, "/private/artifact", "/private/binding")).toEqual(["messaging", "preview", "--input", "-", "--private-output", "/private/artifact", "--json"]);
    expect(ghostgetCommand({ command: "confirm", planDigest }, "/private/artifact", "/private/binding")).toEqual(["confirm", planDigest, "--private-output", "/private/artifact", "--receipt-binding-output", "/private/binding", "--json"]);
  });
});
