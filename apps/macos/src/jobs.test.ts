import { expect, test } from "bun:test";
import { CONTROL_PROTOCOL as protocol, disconnectedSnapshot, type ControlRequest } from "./control.ts";
import { requestWithJobs } from "./jobs.ts";
import { createDemoPort } from "./demo-port.ts";
test("owner jobs poll only their returned identity and surface the final response", async () => {
  const requests: ControlRequest[] = [];
  const result = await requestWithJobs({ async request(request) { requests.push(request); return requests.length === 1 ? { protocol, ok: true, kind: "job", jobId: "synthetic-job" } : { protocol, ok: true, kind: "snapshot", snapshot: disconnectedSnapshot() }; } }, { protocol, command: "conversations.list" }, async () => {});
  expect(result).toMatchObject({ ok: true, kind: "snapshot" });
  expect(requests).toEqual([{ protocol, command: "conversations.list" }, { protocol, command: "owner.job.read", jobId: "synthetic-job" }]);
  let count = 0;
  await expect(requestWithJobs({ async request() { return { protocol, ok: true, kind: "job", jobId: String(count++) }; } }, { protocol, command: "conversations.list" }, async () => {})).rejects.toThrow("different owner job");
});
test("synthetic enrollment is explicit and creates a disabled contact without invented history", async () => {
  const port = createDemoPort();
  expect(await port.request({ protocol, command: "conversations.list" })).toMatchObject({ kind: "conversations", candidates: [{ eligible: true }, { eligible: false }] });
  const result = await port.request({ protocol, command: "contact.enroll", candidateId: "synthetic-candidate-casey", expectedRevision: 0, initializeHistory: true });
  expect(result).toMatchObject({ kind: "enrolled", historyCount: 0, historyInitialized: true });
  if (!result.ok || result.kind !== "enrolled") throw new Error("Missing enrollment");
  expect(result.snapshot.contacts.find(contact => contact.id === result.contactId)?.settings.enabled).toBe(false);
});

test("global pause can complete during a pending owner job and a late snapshot cannot undo it", async () => {
  const { newerSnapshot } = await import("./jobs.ts");
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const current = { ...disconnectedSnapshot(), revision: 1, connection: "connected" as const, settings: { paused: false, activeContactLimit: 5 } };
  const port = { async request(request: ControlRequest) {
    if (request.command === "contact.settings.update") return { protocol, ok: true as const, kind: "job" as const, jobId: "synthetic-job" };
    if (request.command === "owner.job.read") { await pending; return { protocol, ok: true as const, kind: "snapshot" as const, snapshot: { ...current, revision: 2 } }; }
    return { protocol, ok: true as const, kind: "snapshot" as const, snapshot: { ...current, revision: 3, settings: { ...current.settings, paused: true } } };
  } };
  const { DEFAULT_CONTACT_SETTINGS } = await import("./control.ts");
  let polling = false;
  const job = requestWithJobs(port, { protocol, command: "contact.settings.update", contactId: "synthetic", expectedRevision: 1, settings: DEFAULT_CONTACT_SETTINGS }, async () => {}, () => { polling = true; });
  await Promise.resolve(); expect(polling).toBe(true);
  const paused = await port.request({ protocol, command: "global.settings.update", expectedRevision: 1, settings: { paused: true, activeContactLimit: 5 } });
  if (paused.kind !== "snapshot") throw new Error("Missing pause snapshot");
  expect(paused.snapshot.settings.paused).toBe(true);
  release(); const late = await job;
  if (!late.ok || late.kind !== "snapshot") throw new Error("Missing job snapshot");
  expect(newerSnapshot(paused.snapshot, late.snapshot)).toBe(paused.snapshot);
});

test("pause reconciles one racing settings commit, retains its desired state and uses the fresh active limit", async () => {
  const { requestPause } = await import("./jobs.ts");
  const requests: ControlRequest[] = [];
  const initial = { ...disconnectedSnapshot(), revision: 1, settings: { paused: false, activeContactLimit: 5 } };
  const fresh = { ...initial, revision: 2, settings: { paused: false, activeContactLimit: 7 } };
  const result = await requestPause({ async request(request) {
    requests.push(request);
    if (requests.length === 1) return { protocol, ok: false, code: "conflict", message: "Synthetic racing commit" };
    return { protocol, ok: true, kind: "snapshot", snapshot: request.command === "snapshot" ? fresh : { ...fresh, revision: 3, settings: { ...fresh.settings, paused: true } } };
  } }, initial, true);
  expect(result).toMatchObject({ kind: "snapshot", snapshot: { settings: { paused: true, activeContactLimit: 7 } } });
  expect(requests).toEqual([
    { protocol, command: "global.settings.update", expectedRevision: 1, settings: { paused: true, activeContactLimit: 5 } },
    { protocol, command: "snapshot" },
    { protocol, command: "global.settings.update", expectedRevision: 2, settings: { paused: true, activeContactLimit: 7 } },
  ]);
  let calls = 0;
  const alreadyPaused = await requestPause({ async request() { calls++; return calls === 1 ? { protocol, ok: false, code: "conflict", message: "changed" } : { protocol, ok: true, kind: "snapshot", snapshot: { ...fresh, settings: { ...fresh.settings, paused: true } } }; } }, initial, true);
  expect(alreadyPaused.ok).toBe(true); expect(calls).toBe(2);
});
