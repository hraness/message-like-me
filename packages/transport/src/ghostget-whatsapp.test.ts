import { expect, test } from "bun:test";
import { createGhostgetWhatsAppTransport } from "./ghostget-whatsapp";
import { ghostgetCommand } from "./cli";
import type { GhostgetInvocation } from "./ghostget";

const candidate = `wmroute_${"a".repeat(22)}`, resolved = `wmroute_${"b".repeat(22)}`;
function fixture(change?: (request: GhostgetInvocation, value: Record<string, unknown>) => unknown) {
  let now = Date.parse("2026-09-11T12:00:00Z");
  const calls: GhostgetInvocation[] = [];
  const route = (id: string, ready: string) => ({ schemaVersion: 2, format: "wrench.messaging-route", network: "whatsapp", routeRef: id,
    conversation: { kind: "single", title: "Synthetic WhatsApp contact", participantCount: 0 },
    readiness: { context: ready, turn: "unavailable", reply: "unsupported", reason: "Read-only projection" }, expiresAt: "2026-09-11T12:15:00Z" });
  const transport = createGhostgetWhatsAppTransport({ authId: "whatsapp-fixture", clock: () => new Date(now), invoke: async request => {
    calls.push(request); let value: Record<string, unknown>;
    switch (request.command) {
      case "capabilities": value = { ok: true, adapters: [{ id: "whatsapp-web", surfaceId: "whatsapp", operations: ["messaging.list", "messaging.read", "messaging.send"].map(id => ({ id, state: "observed", transport: "web-session-api", site: "whatsapp", webSessionAction: id, webSessionContractVersion: 1 })) }] }; break;
      case "messaging.routes": value = { schemaVersion: 2, format: "wrench.messaging-routes", routes: [route(candidate, "resolution-required")] }; break;
      case "messaging.resolve": value = route(resolved, "historical-readable"); break;
      case "messaging.context": value = { schemaVersion: 1, format: "wrench.messaging-context", network: "whatsapp", binding: null,
        liveness: "freshness-unproven", truncated: false, completeness: { kind: "bounded-local", reason: "local-store-coverage-unknown" }, messages: [{
          messageRef: "wmmessage_fixture", direction: "incoming", time: "2026-09-11T11:00:00Z", body: "Synthetic context", bodyTruncated: false, untrustedData: true,
        }] }; break;
      default: throw new Error("Unexpected outward operation");
    }
    return change ? change(request, value) : value;
  } });
  return { transport, calls, advance: () => { now += 16 * 60_000; } };
}

test("WhatsApp reads use Ghostget's exact adapter/account and return bounded untrusted context without send authority", async () => {
  const { transport, calls } = fixture();
  expect(calls).toHaveLength(0);
  const caps = await transport.capabilities();
  expect(caps.ok && caps.value.capabilities.filter(item => item.available).map(item => item.capability)).toEqual(["history"]);
  expect(await transport.conversations()).toMatchObject({ ok: true, value: [{ id: candidate }] });
  expect(calls.find(call => call.command === "messaging.routes")).toMatchObject({ input: { source: { adapterId: "whatsapp-web", authId: "whatsapp-fixture", listInput: { limit: 100 } } } });
  expect(await transport.history({ conversationId: candidate, limit: 20 })).toMatchObject({ ok: true, value: { conversationId: resolved,
    contextId: null, revision: null, complete: false, nextCursor: null, messages: [{ untrusted: true, text: "Synthetic context" }] } });
  expect(calls.find(call => call.command === "messaging.context")).toMatchObject({ input: { routeRef: resolved, limit: 20 } });
  expect(await transport.history({ conversationId: candidate })).toMatchObject({ ok: false, error: { code: "stale-context" } });
  expect(await transport.history({ conversationId: resolved })).toMatchObject({ ok: true });
  expect(calls.filter(call => call.command === "messaging.resolve")).toHaveLength(1);
});

test("WhatsApp never prepares, confirms, synchronizes or pairs, even when a catalog advertises sends", async () => {
  const { transport, calls } = fixture();
  expect(await transport.prepare({ intentId: "x", conversationId: candidate, contextId: "x", actions: [{ kind: "text", text: "unsent" }] })).toMatchObject({ ok: false, error: { code: "unsupported" } });
  // Runtime JSON cannot smuggle a prepared plan into this read-only adapter.
  expect(await transport.submit({} as never, { mode: "delegated", grantId: "untrusted" })).toMatchObject({ ok: false, error: { capability: "autonomous-send" } });
  expect(await transport.events({ conversationIds: [candidate], cursor: null })).toMatchObject({ ok: false, error: { capability: "events" } });
  expect(await transport.contacts()).toMatchObject({ ok: false });
  expect(calls).toHaveLength(0);
  expect(ghostgetCommand({ command: "capabilities", adapterId: "whatsapp-web" }, "unused", "unused")).toEqual(["capabilities", "whatsapp-web", "--json"]);
  expect(() => ghostgetCommand({ command: "capabilities", adapterId: "arbitrary" } as never, "unused", "unused")).toThrow();
});

test("foreign, expired, malformed and paginated routes launch no provider read", async () => {
  const { transport, calls, advance } = fixture();
  expect(await transport.history({ conversationId: candidate })).toMatchObject({ ok: false, error: { code: "stale-context" } });
  expect(await transport.history({ conversationId: "phone-number" })).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  expect(await transport.history({ conversationId: candidate, cursor: "invented" })).toMatchObject({ ok: false, error: { code: "unsupported" } });
  expect(calls).toHaveLength(0);
  await transport.conversations(); const count = calls.length; advance();
  expect(await transport.history({ conversationId: candidate })).toMatchObject({ ok: false, error: { code: "stale-context" } });
  expect(calls).toHaveLength(count);
});

test.each(["network", "binding", "liveness", "completeness", "duplicate-message"])("unreviewed %s in WhatsApp context invalidates routes", async kind => {
  const { transport } = fixture((request, value) => {
    if (request.command === "messaging.context") {
      if (kind === "network") value.network = "imessage";
      if (kind === "binding") value.binding = { contextRef: "invented-authority" };
      if (kind === "liveness") value.liveness = "fresh-as-of-live-preflight";
      if (kind === "completeness") value.completeness = { kind: "complete" };
      if (kind === "duplicate-message") value.messages = [...value.messages as unknown[], ...value.messages as unknown[]];
    }
    return value;
  });
  await transport.conversations();
  expect(await transport.history({ conversationId: candidate })).toMatchObject({ ok: false, error: { code: "contract-mismatch" } });
  expect(await transport.history({ conversationId: resolved })).toMatchObject({ ok: false, error: { code: "stale-context" } });
});

test("changed read contract and cross-network discovery fail closed", async () => {
  const drifted = fixture((request, value) => {
    if (request.command === "capabilities") (value.adapters as { operations: { webSessionContractVersion: number }[] }[])[0]!.operations[0]!.webSessionContractVersion = 2;
    return value;
  });
  expect(await drifted.transport.conversations()).toMatchObject({ ok: false });
  expect(drifted.calls.every(call => call.command === "capabilities")).toBe(true);
  const foreign = fixture((request, value) => {
    if (request.command === "messaging.routes") (value.routes as { network: string }[])[0]!.network = "imessage";
    return value;
  });
  expect(await foreign.transport.conversations()).toMatchObject({ ok: false, error: { code: "contract-mismatch" } });
});
