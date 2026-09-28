import { afterEach, expect, test } from "bun:test";
import { TRANSPORT_PROTOCOL, type ActionIntent, type PrepareRequest, type TextbutlerTransport } from "../../transport/src/index.ts";
import { newContact, parseSettings, type Settings } from "./config.ts";
import { Hooks } from "./hooks.ts";
import { DriverFault } from "./fast-driver.ts";
import { RunJournal } from "./journal.ts";
import { ButlerRuntime, type ConversationSnapshot, type RuntimePorts } from "./runtime.ts";
import type { MessageEvent } from "./decision.ts";

const now = 1_800_000_000_000;
const event: MessageEvent = { id: "m1", contactId: "c1", routeId: "r1", revision: "v1", occurredAt: now - 10_000, observedAt: now - 10_000, author: "contact", kind: "message", text: "butler help", historical: false, group: false };
const journals: RunJournal[] = [];
afterEach(() => { for (const journal of journals.splice(0)) journal.close(); });
function setup(overrides: Partial<RuntimePorts> = {}) {
  const journal = RunJournal.memory(); journals.push(journal);
  const contact = { ...newContact("c1", "Example", "r1"), enabled: true, mode: "smart" as const };
  let settings: Settings = parseSettings({ schemaVersion: 1, paused: false, maxActiveContacts: 5, contacts: [contact] });
  let snapshot: ConversationSnapshot = { contextId: "ctx1", messageIds: ["m1"], relatedMessageIds: new Map(), state: { latestRevision: "v1", lastOwnerAt: null, ownerTyping: false, synchronizedAt: now, repliesInLastHour: 0 } };
  const submitted: ActionIntent[][] = [], acks: ActionIntent[][] = [];
  const transport: TextbutlerTransport = {
    capabilities: async () => ({ ok: true, value: { protocol: TRANSPORT_PROTOCOL, provider: "synthetic", capabilities: ["text", "attachment", "reaction", "sticker", "link", "autonomous-send"].map(capability => ({ capability: capability as "text", available: true, reason: null })) } }),
    conversations: async () => ({ ok: true, value: [] }), contacts: async () => ({ ok: true, value: [] }),
    history: async () => { throw new Error("not used"); }, events: async () => { throw new Error("not used"); },
    prepare: async (request: PrepareRequest) => ({ ok: true, value: { protocol: TRANSPORT_PROTOCOL, id: "p1", intentId: request.intentId, conversationId: request.conversationId, contextId: request.contextId, digest: "a".repeat(64), expiresAt: new Date(now + 1000).toISOString(), actions: request.actions } }),
    submit: async plan => {
      (plan.intentId.endsWith(":ack") ? acks : submitted).push([...plan.actions]);
      return { ok: true, value: { planId: plan.id, runId: "receipt1", state: "submitted", submittedCount: plan.actions.length, totalCount: plan.actions.length, acceptedMessageIds: plan.actions.map((_action, index) => `accepted:${plan.id}:${index}`), recordedAt: new Date(now).toISOString(), delivery: "unknown", retryable: false } };
    },
  };
  const ports: RuntimePorts = {
    settings: () => settings, refresh: async () => snapshot, journal, hooks: new Hooks(), transport,
    agent: { qualified: async () => true, classify: async () => ({ respond: true, confidence: 0.95, reason: "requested" }), compose: async () => ({ summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] }) },
    delegatedGrant: async () => "contact-bound-grant", validateFile: async () => {}, clock: () => now, ...overrides,
  };
  const runtime = new ButlerRuntime(ports);
  return { runtime, ports, transport, submitted, acks, journal, setSettings: (next: Settings) => { settings = next; }, getSettings: () => settings, setSnapshot: (next: ConversationSnapshot) => { snapshot = next; }, getSnapshot: () => snapshot };
}
test("wraps every text response and never replays one event", async () => {
  const fixture = setup();
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);
  expect((await fixture.runtime.process(event)).status).toBe("duplicate-or-busy");
  expect(fixture.submitted.length).toBe(1);
});
test("a disclosed ack lands first while the reply composes", async () => {
  const fixture = setup();
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.acks).toEqual([[{ kind: "text", text: "🤖{ … }" }]]);
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);
  // The journaled ack send attributes its own history echo to the butler.
  expect(fixture.journal.knownSentMessage("accepted:p1:0")).toBe(true);
  fixture.setSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(c => ({ ...c, disclosure: { character: "", begin: "", end: "" } })) });
  fixture.setSnapshot({ ...fixture.getSnapshot(), messageIds: ["m1", "m2"] });
  expect((await fixture.runtime.process({ ...event, id: "m2", text: "butler again" })).status).toBe("submitted");
  expect(fixture.acks[1]).toEqual([{ kind: "text", text: "…" }]);
});
test("an unproven ack wedges the run; a proven failure only skips it", async () => {
  const fixture = setup();
  const defaultSubmit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) throw new Error("dispatch lost");
    return defaultSubmit(plan, options, signal);
  };
  // A thrown submit is an unknown dispatch result: the run goes indeterminate
  // instead of replying into unproven conversation state.
  expect((await fixture.runtime.process(event)).status).toBe("indeterminate");
  expect(fixture.submitted).toEqual([]);
  const recovered = setup();
  const recoveredSubmit = recovered.transport.submit;
  recovered.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) return { ok: true, value: { planId: plan.id, runId: "receipt-failed", state: "failed" as const, submittedCount: 0, totalCount: plan.actions.length, acceptedMessageIds: null, recordedAt: new Date(now).toISOString(), delivery: "unknown" as const, retryable: false as const } };
    return recoveredSubmit(plan, options, signal);
  };
  expect((await recovered.runtime.process(event)).status).toBe("submitted");
  expect(recovered.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);
});
function gate() { let open!: () => void; const opened = new Promise<void>(resolve => { open = resolve; }); return { open, opened }; }
test("composition runs while the ack dispatches and the reply waits for the ack", async () => {
  const fixture = setup(); const ackHeld = gate(), composeStarted = gate(); const order: string[] = [];
  const submit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) { order.push("ack-start"); await ackHeld.opened; order.push("ack-done"); }
    else order.push("reply");
    return submit(plan, options, signal);
  };
  fixture.ports.agent.compose = async () => { order.push("compose"); composeStarted.open(); return { summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] }; };
  const run = fixture.runtime.process(event);
  await composeStarted.opened;
  expect(fixture.runtime.submitInFlight()).toBe(true);
  ackHeld.open();
  expect((await run).status).toBe("submitted");
  expect(order).toEqual(["ack-start", "compose", "ack-done", "reply"]);
  expect(fixture.runtime.submitInFlight()).toBe(false);
});
test("a run never finishes while its ack may still be dispatching", async () => {
  const fixture = setup(); const ackHeld = gate(); let settled = false;
  const submit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => { if (plan.intentId.endsWith(":ack")) await ackHeld.opened; return submit(plan, options, signal); };
  fixture.ports.agent.compose = async () => { throw new Error("compose failed"); };
  const run = fixture.runtime.process(event).then(outcome => { settled = true; return outcome; });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(settled).toBe(false);
  ackHeld.open();
  expect((await run).status).toBe("failed");
  // The ack that did land is still journaled so its echo attributes to the butler.
  expect(fixture.journal.knownSentMessage("accepted:p1:0")).toBe(true);
});
test("owner activity during the ack cancels composition, never the ack send", async () => {
  const fixture = setup(); const ackHeld = gate(), composing = gate(); let ackSignal: AbortSignal | undefined, composeSignal: AbortSignal | undefined;
  const submit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => { if (plan.intentId.endsWith(":ack")) { ackSignal = signal; await ackHeld.opened; } return submit(plan, options, signal); };
  fixture.ports.agent.compose = async request => { composeSignal = request.signal; composing.open(); await new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); return {}; };
  const run = fixture.runtime.process(event);
  await composing.opened;
  fixture.runtime.cancelContact("c1");
  expect(composeSignal?.aborted).toBe(true); expect(ackSignal?.aborted).toBe(false);
  ackHeld.open();
  expect((await run).status).toBe("cancelled");
  expect(fixture.acks).toHaveLength(1); expect(fixture.submitted).toEqual([]);
  expect(fixture.journal.knownSentMessage("accepted:p1:0")).toBe(true);
});
test("an unknown ack outcome stops composition and wedges the run", async () => {
  const fixture = setup(); const composing = gate(); let composeSignal: AbortSignal | undefined;
  const submit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => { if (plan.intentId.endsWith(":ack")) { await composing.opened; throw new Error("dispatch lost"); } return submit(plan, options, signal); };
  fixture.ports.agent.compose = async request => { composeSignal = request.signal; composing.open(); await new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); return {}; };
  expect(await fixture.runtime.process(event)).toMatchObject({ status: "indeterminate", reason: "ack-dispatch-unknown" });
  expect(composeSignal?.aborted).toBe(true); expect(fixture.submitted).toEqual([]);
});
test("a global pause aborts an in-flight ack send", async () => {
  const fixture = setup(); const reached = gate(); let ackSignal: AbortSignal | undefined;
  const submit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) { ackSignal = signal; reached.open(); await new Promise(resolve => signal?.addEventListener("abort", resolve, { once: true })); throw new Error("aborted mid-dispatch"); }
    return submit(plan, options, signal);
  };
  const run = fixture.runtime.process(event);
  await reached.opened; fixture.runtime.pause();
  expect(ackSignal?.aborted).toBe(true);
  expect((await run).status).toBe("indeterminate");
});
test("the ack's own history echo does not cancel the reply it precedes", async () => {
  const fixture = setup();
  // The ack send bumps the enrollment revision before the post-compose
  // recheck. Only the echo's journaled id may explain the drift; a foreign id
  // still cancels as conversation-changed.
  fixture.ports.agent.compose = async () => {
    fixture.setSnapshot({ contextId: "ctx2", messageIds: ["m1", "accepted:p1:0"], relatedMessageIds: new Map(), state: { latestRevision: "v2", lastOwnerAt: null, ownerTyping: false, synchronizedAt: now, repliesInLastHour: 0 } });
    return { summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] };
  };
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  const raced = setup();
  raced.ports.agent.compose = async () => {
    raced.setSnapshot({ contextId: "ctx2", messageIds: ["m1", "m9"], relatedMessageIds: new Map(), state: { latestRevision: "v2", lastOwnerAt: null, ownerTyping: false, synchronizedAt: now, repliesInLastHour: 0 } });
    return { summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] };
  };
  expect((await raced.runtime.process(event)).status).toBe("cancelled");
  expect(raced.submitted).toEqual([]);
});
test("a self-chat ack echo under a fresh id does not cancel the reply", async () => {
  const fixture = setup();
  // In a self-chat the butler's own ack lands again as an incoming row whose id
  // differs from the accepted outgoing id; only relatedMessageId ties them.
  fixture.ports.agent.compose = async () => {
    fixture.setSnapshot({ contextId: "ctx2", messageIds: ["m1", "echo-of-ack"], relatedMessageIds: new Map([["echo-of-ack", "accepted:p1:0"]]), state: { latestRevision: "v2", lastOwnerAt: null, ownerTyping: false, synchronizedAt: now, repliesInLastHour: 0 } });
    return { summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] };
  };
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);
  const raced = setup();
  // A new id related to a foreign message — not this run's ack — still cancels.
  raced.ports.agent.compose = async () => {
    raced.setSnapshot({ contextId: "ctx2", messageIds: ["m1", "echo-foreign"], relatedMessageIds: new Map([["echo-foreign", "someone-elses"]]), state: { latestRevision: "v2", lastOwnerAt: null, ownerTyping: false, synchronizedAt: now, repliesInLastHour: 0 } });
    return { summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] };
  };
  expect((await raced.runtime.process(event)).status).toBe("cancelled");
});
test("a fast self-chat reply waits for its ack's echo before preparing, and still cancels on anything else", async () => {
  const state = (latestRevision: string) => ({ latestRevision, lastOwnerAt: null, ownerTyping: false, synchronizedAt: now, repliesInLastHour: 0 });
  const selfChat = (fixture: ReturnType<typeof setup>) => fixture.setSettings(parseSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(value => ({ ...value, selfChat: true })) }));
  // The echo lands on the third re-read; the reply is prepared against that context.
  let reads = 0, sleeps = 0; const contexts: string[] = [];
  const echoing = setup({ sleep: async () => { sleeps++; }, refresh: async () => { reads++; return reads >= 4 ? { contextId: "ctx-echo", messageIds: ["m1", "echo-of-ack"], relatedMessageIds: new Map([["echo-of-ack", "accepted:p1:0"]]), state: state("v3") } : { contextId: "ctx1", messageIds: ["m1"], relatedMessageIds: new Map(), state: state("v1") }; } });
  selfChat(echoing);
  const prepare = echoing.transport.prepare; echoing.transport.prepare = async request => { if (!request.intentId.endsWith(":ack")) contexts.push(request.contextId); return prepare(request); };
  expect((await echoing.runtime.process(event)).status).toBe("submitted");
  expect(contexts).toEqual(["ctx-echo"]); expect(sleeps).toBe(2);
  // A missing echo is bounded and the reply still proceeds.
  let waited = 0;
  const silent = setup({ sleep: async () => { waited++; } }); selfChat(silent);
  expect((await silent.runtime.process(event)).status).toBe("submitted"); expect(waited).toBe(24);
  // Another message arriving while waiting still cancels the reply.
  let raceReads = 0;
  const raced = setup({ sleep: async () => {}, refresh: async () => (++raceReads >= 4 ? { contextId: "ctx2", messageIds: ["m1", "m9"], relatedMessageIds: new Map(), state: state("v2") } : { contextId: "ctx1", messageIds: ["m1"], relatedMessageIds: new Map(), state: state("v1") }) }); selfChat(raced);
  expect((await raced.runtime.process(event)).status).toBe("cancelled"); expect(raced.submitted).toHaveLength(0);
  // An ordinary contact never waits for an echo.
  let ordinarySleeps = 0;
  const ordinary = setup({ sleep: async () => { ordinarySleeps++; } });
  expect((await ordinary.runtime.process(event)).status).toBe("submitted"); expect(ordinarySleeps).toBe(0);
});
test("the composer learns whether the butler was invoked by keyword or admitted by smart mode", async () => {
  const seen: (string | undefined)[] = [];
  const compose = async (request: { invocation?: string }) => { seen.push(request.invocation); return { summary: "I can help.", actions: [{ kind: "text", text: "Hello there." }] }; };
  const keyword = setup(); keyword.ports.agent.compose = compose;
  expect((await keyword.runtime.process(event)).status).toBe("submitted");
  const smart = setup(); smart.ports.agent.compose = compose;
  expect((await smart.runtime.process({ ...event, id: "m2", text: "can you help with this" })).status).toBe("submitted");
  expect(seen).toEqual(["keyword", "inferred"]);
});
test("nontext intent gets a disclosed companion before the action", async () => {
  const fixture = setup();
  fixture.ports.agent.compose = async () => ({ summary: "I like that idea.", actions: [{ kind: "reaction", messageId: "m1", emoji: "👍", action: "add" }] });
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.submitted[0]?.[0]).toEqual({ kind: "text", text: "🤖{ I like that idea. }" });
});
test("an admitted event does not go stale while a slow reply is drafted", async () => {
  let clockNow = now;
  const fixture = setup({ clock: () => clockNow });
  const aged = { ...event, occurredAt: now - 100_000, observedAt: now - 100_000 };
  fixture.ports.agent.compose = async () => {
    clockNow += 150_000;
    fixture.setSnapshot({ ...fixture.getSnapshot(), state: { ...fixture.getSnapshot().state, synchronizedAt: clockNow } });
    return { summary: "I can help.", actions: [{ kind: "text" as const, text: "Hello there." }] };
  };
  expect((await fixture.runtime.process(aged)).status).toBe("submitted");
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);
});
test("an event delayed past the old drain window still replies, while a truly stale one is ignored and journaled", async () => {
  const fixture = setup();
  // Five-minute delivery lag used to read as staleness; it is ordinary
  // congestion now. The revision check, not the clock, rejects real replays.
  expect((await fixture.runtime.process({ ...event, occurredAt: now - 300_000, observedAt: now - 60_000 })).status).toBe("submitted");
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);

  expect((await fixture.runtime.process({ ...event, id: "m2", occurredAt: now - 16 * 60_000, observedAt: now - 60_000 })).reason).toBe("stale-event");
  // Pipeline-trouble drops leave evidence under a namespaced event id that can
  // never collide with the event's real claim.
  expect(fixture.journal.recent("c1").map(run => [run.eventId, run.state, run.reason]))
    .toContainEqual(["drop:m2", "ignored", "intake:stale-event"]);
});
test("a proven non-send fails the run cleanly and never blocks the contact", async () => {
  const fixture = setup();
  const defaultSubmit = fixture.transport.submit;
  let refused = false;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack") || refused) return defaultSubmit(plan, options, signal);
    refused = true;
    return { ok: false as const, error: { code: "dispatch-failed" as const, message: "Provider proved the send never started.", retryable: false as const } };
  };
  expect((await fixture.runtime.process(event)).status).toBe("failed");
  expect(fixture.journal.hasUncertainSend("c1")).toBe(false);
  expect(fixture.journal.recent("c1")[0]?.reason).toBe("dispatch-failed");
  // A proven failure leaves the contact free: the next event sends normally.
  expect((await fixture.runtime.process({ ...event, id: "m2" })).status).toBe("submitted");
});
test("a provably unsent ack is skipped while the reply still dispatches", async () => {
  const fixture = setup();
  const defaultSubmit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) return { ok: false as const, error: { code: "dispatch-failed" as const, message: "Provider proved the send never started.", retryable: false as const } };
    return defaultSubmit(plan, options, signal);
  };
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.acks).toEqual([]);
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "🤖{ Hello there. }" }]]);
});
test("owner takeover while composing cancels the send", async () => {
  const fixture = setup();
  fixture.ports.agent.compose = async () => {
    fixture.setSnapshot({ ...fixture.getSnapshot(), state: { ...fixture.getSnapshot().state, lastOwnerAt: now } });
    return { summary: "Help", actions: [{ kind: "text", text: "Should remain unsent" }] };
  };
  expect((await fixture.runtime.process(event)).status).toBe("cancelled");
  expect(fixture.submitted).toEqual([]);
});
test("cancellation during final grant lookup cannot dispatch", async () => {
  let lookups = 0;
  const fixture = setup({ delegatedGrant: async () => {
    if (++lookups === 2) fixture.runtime.cancelContact("c1");
    return "contact-bound-grant";
  } });
  expect((await fixture.runtime.process(event)).reason).toBe("cancelled-at-dispatch");
  expect(fixture.submitted).toEqual([]);
});
test("disabling contact during composition prevents sending", async () => {
  const fixture = setup();
  fixture.ports.agent.compose = async () => {
    fixture.setSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(c => ({ ...c, enabled: false, revision: c.revision + 1 })) });
    return { summary: "Hello", actions: [{ kind: "text", text: "Unsent" }] };
  };
  expect((await fixture.runtime.process(event)).status).toBe("cancelled");
  expect(fixture.submitted).toEqual([]);
});
test("uncertain effect is journaled and blocks subsequent replies", async () => {
  const fixture = setup();
  const defaultSubmit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) return defaultSubmit(plan, options, signal);
    throw new Error("connection lost after send");
  };
  expect((await fixture.runtime.process(event)).status).toBe("indeterminate");
  expect((await fixture.runtime.process({ ...event, id: "m2" })).reason).toBe("reconcile-previous-send");
  expect(fixture.journal.recent("c1")[0]?.planDigest).toBe("a".repeat(64));
});
test.each(["partial", "indeterminate"] as const)("a concurrent event cannot claim after a pending send settles %s", async state => {
  const fixture = setup();
  const sendEntered = Promise.withResolvers<void>();
  const settleSend = Promise.withResolvers<void>();
  const secondReadinessEntered = Promise.withResolvers<void>();
  const finishSecondReadiness = Promise.withResolvers<void>();
  const originalCapabilities = fixture.transport.capabilities;
  let capabilityCalls = 0, sendCalls = 0, composeCalls = 0;
  fixture.transport.capabilities = async () => {
    if (++capabilityCalls === 2) { secondReadinessEntered.resolve(); await finishSecondReadiness.promise; }
    return originalCapabilities();
  };
  fixture.ports.agent.compose = async () => {
    composeCalls++;
    return { summary: "Synthetic response", actions: Array.from({ length: state === "partial" ? 2 : 1 }, (_, index) => ({ kind: "text", text: `Synthetic response ${index + 1}` })) };
  };
  const defaultSubmit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) return defaultSubmit(plan, options, signal);
    sendCalls++; sendEntered.resolve(); await settleSend.promise;
    return { ok: true, value: { planId: plan.id, runId: "synthetic-uncertain", state, submittedCount: state === "partial" ? 1 : 0, totalCount: plan.actions.length, acceptedMessageIds: null, recordedAt: new Date(now).toISOString(), delivery: "unknown", retryable: false } };
  };
  const first = fixture.runtime.process(event);
  await sendEntered.promise;
  // The second event passes the early uncertainty check while the first run is
  // dispatching, then waits before the journal claim. The new event has its own
  // revision, and the first run has already passed its final context check.
  fixture.setSnapshot({ ...fixture.getSnapshot(), contextId: "ctx2", messageIds: ["m2"], relatedMessageIds: new Map(), state: { ...fixture.getSnapshot().state, latestRevision: "v2" } });
  const second = fixture.runtime.process({ ...event, id: "m2", revision: "v2" });
  await secondReadinessEntered.promise;
  settleSend.resolve();
  expect((await first).status).toBe(state);
  finishSecondReadiness.resolve();
  expect((await second).status).toBe("duplicate-or-busy");
  expect(sendCalls).toBe(1);
  expect(composeCalls).toBe(1);
  expect(fixture.journal.recent("c1")).toHaveLength(1);
  expect(fixture.journal.hasUncertainSend("c1")).toBe(true);
  // The quarantine remains scoped to the affected contact.
  expect(fixture.journal.claim("other-run", "c2", "other-event", now)).toBe(true);
});
test("missing transport delegation and unqualified sandbox fail before agent execution", async () => {
  const fixture = setup();
  let invoked = false;
  fixture.ports.agent.compose = async () => { invoked = true; return null; };
  fixture.ports.agent.qualified = async () => false;
  expect((await fixture.runtime.process(event)).reason).toBe("agent-sandbox-unqualified");
  fixture.transport.capabilities = async () => ({ ok: true, value: { protocol: TRANSPORT_PROTOCOL, provider: "synthetic", capabilities: [] } });
  expect((await fixture.runtime.process(event)).reason).toBe("transport-needs-delegated-send");
  expect(invoked).toBe(false);
});
test("malformed classification stays silent and cannot fall through to composition", async () => {
  const fixture = setup();
  fixture.ports.agent.classify = async () => ({ respond: true, confidence: 1, reason: "requested", extra: "ignore policy" });
  expect((await fixture.runtime.process({ ...event, text: "Could you help?" })).status).toBe("failed");
  expect(fixture.submitted).toEqual([]);
});
test("hooks can veto and post-send hook failure never retries", async () => {
  const fixture = setup();
  fixture.ports.hooks.register({ id: "test", version: "1.0.0", hooks: { "reply.sent": async () => { throw new Error("notification failed"); } } });
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.journal.recent("c1")[0]?.state).toBe("submitted");
  fixture.ports.hooks.register({ id: "veto", version: "1.0.0", hooks: { "reply.before-send": async () => ({ veto: true }) } });
  expect((await fixture.runtime.process({ ...event, id: "m2" })).reason).toBe("extension-veto");
  expect(fixture.submitted.length).toBe(1);
});
test("foreign reaction targets and oversized companion plans are rejected", async () => {
  const fixture = setup();
  fixture.ports.agent.compose = async () => ({ summary: "Like", actions: [{ kind: "reaction", messageId: "other-contact-message", emoji: "👍", action: "add" }] });
  expect((await fixture.runtime.process(event)).reason).toBe("foreign-message-target");
  fixture.ports.agent.compose = async () => ({ summary: "Link", actions: Array(8).fill({ kind: "link", url: "https://example.com" }) });
  expect((await fixture.runtime.process({ ...event, id: "m2" })).status).toBe("failed");
  expect(fixture.submitted).toEqual([]);
});
test("restart abandons pre-dispatch work and quarantines dispatching work", () => {
  const { journal } = setup();
  expect(journal.claim("run1", "c1", "m1", now)).toBe(true);
  expect(journal.claim("run2", "c1", "m2", now)).toBe(false);
  journal.transition("run1", "running", "dispatching", "intent", now, "b".repeat(64));
  expect(journal.claim("run3", "c2", "m3", now)).toBe(true);
  journal.recover(now + 1);
  expect(journal.recent("c1")[0]?.state).toBe("indeterminate");
  expect(journal.recent("c2")[0]?.state).toBe("abandoned");
});
test("persisted sends enforce the cap even when transport history undercounts", async () => {
  const fixture = setup();
  fixture.setSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(c => ({ ...c, maxRepliesPerHour: 1 })) });
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect((await fixture.runtime.process({ ...event, id: "m2" })).reason).toBe("rate-limit");
  expect(fixture.submitted.length).toBe(1);
});
test("cleared disclosure sends bare text and the journal still proves authorship", async () => {
  const fixture = setup();
  fixture.setSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(c => ({ ...c, disclosure: { character: "", begin: "", end: "" } })) });
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.submitted).toEqual([[{ kind: "text", text: "Hello there." }]]);
  expect(fixture.journal.isButlerMessage("c1", "accepted:p1:0")).toBe(true);
});
test("cleared disclosure adds no companion before a nontext response", async () => {
  const fixture = setup();
  fixture.setSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(c => ({ ...c, disclosure: { character: "", begin: "", end: "" } })) });
  fixture.ports.agent.compose = async () => ({ summary: "I like that idea.", actions: [{ kind: "reaction", messageId: "m1", emoji: "👍", action: "add" }] });
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  expect(fixture.submitted).toEqual([[{ kind: "reaction", messageId: "m1", emoji: "👍", action: "add" }]]);
});
test("accepted message ids attribute disclosure-free sends to the butler", async () => {
  const fixture = setup();
  fixture.setSettings({ ...fixture.getSettings(), contacts: fixture.getSettings().contacts.map(c => ({ ...c, disclosure: { character: "", begin: "", end: "" } })) });
  expect((await fixture.runtime.process(event)).status).toBe("submitted");
  // History classifies this outgoing bare text through journal provenance, not the visible wrap.
  expect(fixture.journal.knownSentMessage("accepted:p1:0")).toBe(true);
});

test("a late cancel cannot abort a send already in dispatch", async () => {
  const fixture = setup();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const defaultSubmit = fixture.transport.submit;
  fixture.transport.submit = async (plan, options, signal) => {
    if (plan.intentId.endsWith(":ack")) return defaultSubmit(plan, options, signal);
    entered.resolve(); await release.promise;
    // A real transport races this signal and would report the send as unknown;
    // the dispatch guard must keep it from firing after the intent is journaled.
    if (signal?.aborted) throw new Error("synthetic mid-dispatch abort");
    return { ok: true, value: { planId: plan.id, runId: "receipt1", state: "submitted", submittedCount: plan.actions.length, totalCount: plan.actions.length, acceptedMessageIds: [], recordedAt: new Date(now).toISOString(), delivery: "unknown", retryable: false } };
  };
  const pending = fixture.runtime.process(event);
  await entered.promise;
  fixture.runtime.cancelContact("c1");
  release.resolve();
  expect((await pending).status).toBe("submitted");
  expect(fixture.journal.recent("c1")[0]?.state).toBe("submitted");
});

test("driver faults surface a stable failure class instead of an opaque run-failed", async () => {
  const fixture = setup();
  fixture.ports.agent.compose = async () => { throw new DriverFault("budget", "Daily API budget exhausted"); };
  const result = await fixture.runtime.process(event);
  expect(result.status).toBe("failed");
  expect(result.reason).toBe("run-failed:driver-budget");
  expect(fixture.journal.recent("c1")[0]?.reason).toBe("run-failed:driver-budget");
  fixture.ports.agent.compose = async () => { throw new DriverFault("output", "Driver output exceeded the contract"); };
  expect((await fixture.runtime.process({ ...event, id: "m2" })).reason).toBe("run-failed:driver-output");
});
