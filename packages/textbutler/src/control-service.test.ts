import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { newContact, type Settings } from "./config.ts";
import { TextbutlerControlService, TEXTBUTLER_CONTROL_PROTOCOL as protocol, initializeOwnerState, parseControlRequest } from "./control-service.ts";
import { ContactWorkspace } from "./workspace.ts";
import { RunJournal } from "./journal.ts";

const roots: string[] = [], services: TextbutlerControlService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(contacts = true) {
  const dataDir = await mkdtemp(join(await realpath("/tmp"), "textbutler-control-")); roots.push(dataDir);
  const initialSettings: Settings = { schemaVersion: 1, paused: true, maxActiveContacts: 1, contacts: contacts ? [newContact("synthetic-a", "Synthetic A", "fixture-route-a"), newContact("synthetic-b", "Synthetic B", "fixture-route-b")] : [] };
  const service = await TextbutlerControlService.open({ dataDir, initialSettings }); services.push(service);
  return { service, dataDir };
}
describe("persistent owner control service", () => {
  test("fresh initialization is paused with no invented contacts or available provider capabilities", async () => {
    const { service } = await setup(false); const snapshot = await service.snapshot();
    expect(snapshot.connection).toBe("connected"); expect(snapshot.contacts).toEqual([]);
    expect(snapshot.settings.paused).toBe(true); expect(snapshot.capabilities.every(capability => capability.status !== "available")).toBe(true);
  });
  test("settings writes are conditional, persist to disk, and remain outside contact memory", async () => {
    const { service, dataDir } = await setup();
    const results = await Promise.all([false, true].map(paused => service.request({ protocol, command: "global.settings.update", expectedRevision: 1, settings: { paused, activeContactLimit: 2 } })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.find(result => !result.ok)).toMatchObject({ code: "conflict" });
    const stored = JSON.parse(await readFile(join(dataDir, "state", "settings.json"), "utf8"));
    expect(stored).toMatchObject({ revision: 2, settings: { paused: false, maxActiveContacts: 2 } });
    await initializeOwnerState(dataDir); expect((await service.snapshot()).revision).toBe(2);
  });
  test("capacity and explicit contact identity are enforced on real settings", async () => {
    const { service } = await setup(); const snapshot = await service.snapshot();
    const settings = { ...snapshot.contacts[0]!.settings, enabled: true };
    expect((await service.request({ protocol, command: "contact.settings.update", contactId: "synthetic-a", expectedRevision: 1, settings })).ok).toBe(true);
    expect(await service.request({ protocol, command: "contact.settings.update", contactId: "synthetic-b", expectedRevision: 2, settings })).toMatchObject({ ok: false, code: "capacity" });
    expect(await service.request({ protocol, command: "contact.memory.read", contactId: "not-configured" })).toMatchObject({ ok: false, code: "invalid-request" });
  });
  test("memory revisions detect agent changes and do not share the settings revision", async () => {
    const { service, dataDir } = await setup();
    const read = await service.request({ protocol, command: "contact.memory.read", contactId: "synthetic-a" });
    if (!read.ok || read.kind !== "memory") throw new Error("Missing memory");
    expect(read.revision).toMatch(/^[a-f0-9]{64}$/u);
    const workspace = await ContactWorkspace.create(join(dataDir, "contacts", "synthetic-a"));
    await workspace.writeVersioned("MEMORY.md", "Agent changed this synthetic memory", read.revision);
    expect(await service.request({ protocol, command: "contact.memory.write", contactId: "synthetic-a", expectedRevision: read.revision, content: "Stale owner change" })).toMatchObject({ ok: false, code: "conflict" });
    const current = await workspace.readVersioned("MEMORY.md");
    const result = await service.request({ protocol, command: "contact.memory.write", contactId: "synthetic-a", expectedRevision: current.revision, content: "Owner correction" });
    expect(result).toMatchObject({ ok: true, kind: "memory", content: "Owner correction" });
    expect((await service.snapshot()).revision).toBe(1);
  });
  test("unknown fields, direct send commands and traversal never reach a handler", () => {
    for (const request of [{ protocol, command: "snapshot", shell: "whoami" }, { protocol, command: "send" }, { protocol, command: "contact.memory.read", contactId: "../other" }, { protocol, command: "contact.memory.write", contactId: "synthetic-a", expectedRevision: 1, content: "x" }]) expect(() => parseControlRequest(request)).toThrow();
  });
  test("activity projects actual journal runs", async () => {
    const { service, dataDir } = await setup();
    await service.close(); services.splice(services.indexOf(service), 1);
    const journal = await RunJournal.open(join(dataDir, "state", "runs.sqlite"));
    expect(journal.claim("synthetic-run", "synthetic-a", "synthetic-event", 1000)).toBe(true);
    journal.transition("synthetic-run", "running", "ignored", "classifier-silent", 2000); journal.close();
    const reopened = await TextbutlerControlService.open({ dataDir }); services.push(reopened);
    const result = await reopened.request({ protocol, command: "activity.list" });
    expect(result).toMatchObject({ ok: true, kind: "snapshot", snapshot: { activity: [{ id: "synthetic-run", title: "ignored", detail: "classifier-silent" }] } });
  });
  test("unsafe owner settings and linked contact parents fail without exposing or overwriting files", async () => {
    const { service, dataDir } = await setup();
    await chmod(join(dataDir, "state", "settings.json"), 0o644);
    expect(await service.request({ protocol, command: "snapshot" })).toMatchObject({ ok: false, code: "unavailable" });
    await chmod(join(dataDir, "state", "settings.json"), 0o600);
    await rm(join(dataDir, "contacts"), { recursive: true });
    await symlink(join(dataDir, "state"), join(dataDir, "contacts"));
    expect(await service.request({ protocol, command: "contact.memory.read", contactId: "synthetic-a" })).toMatchObject({ ok: false, code: "unavailable" });
    await unlink(join(dataDir, "contacts"));
  });
});
