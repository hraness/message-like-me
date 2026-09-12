import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { newContact, type Settings } from "./config.ts";
import { TextbutlerControlService, TEXTBUTLER_CONTROL_PROTOCOL as protocol, initializeOwnerState, parseControlRequest } from "./control-service.ts";
import { ContactWorkspace } from "./workspace.ts";
import { RunJournal } from "./journal.ts";
import { createProviderHost } from "./provider-host.ts";
import { parseHostConfig } from "./host-config.ts";

const roots: string[] = [], services: TextbutlerControlService[] = [];
afterEach(async () => { for (const service of services.splice(0)) await service.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup(contacts = true) {
  const dataDir = await mkdtemp(join(await realpath("/tmp"), "textbutler-control-")); roots.push(dataDir);
  const initialSettings: Settings = { schemaVersion: 1, paused: true, maxActiveContacts: 1, contacts: contacts ? [newContact("synthetic-a", "Synthetic A", "fixture-route-a"), newContact("synthetic-b", "Synthetic B", "fixture-route-b")] : [] };
  const service = await TextbutlerControlService.open({ dataDir, initialSettings }); services.push(service);
  return { service, dataDir };
}
describe("persistent owner control service", () => {
  test("provider shutdown failure still closes the private journal before custody can be released", async () => {
    const { service, dataDir } = await setup(false); await service.close(); services.splice(services.indexOf(service), 1);
    const reopened = await TextbutlerControlService.open({ dataDir, providers: leases => ({ ...createProviderHost({ dataDir, config: { schemaVersion: 1 }, leases }),
      async close() { throw new Error("Synthetic provider shutdown failure"); } }) });
    const journal = reopened.runJournal();
    await expect(reopened.close()).rejects.toThrow("Synthetic provider shutdown failure");
    expect(() => journal.claim("after-close", "contact", "event", 1)).toThrow();
  });
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
    for (const request of [{ protocol, command: "snapshot", shell: "whoami" }, { protocol, command: "send" }, { protocol, command: "contact.memory.read", contactId: "../other" }, { protocol, command: "contact.memory.write", contactId: "synthetic-a", expectedRevision: 1, content: "x" }, { protocol, command: "provider.accounts.check", accountId: "account", credential: "private" }, { protocol, command: "provider.accounts.check", accountId: "../other" }]) expect(() => parseControlRequest(request)).toThrow();
  });
  test("account selection is explicit and older settings retain their existing binding", async () => {
    const { service, dataDir } = await setup(); await service.close(); services.splice(services.indexOf(service), 1);
    const config = parseHostConfig({ schemaVersion: 1, providerAccounts: [{ id: "api-owner", label: "API owner", route: "claude-api", credentialFile: "api-owner-key", replyModel: "synthetic-model", prices: { observedAt: 1, models: [{ id: "synthetic-model", inputUsdPerMillion: 1, outputUsdPerMillion: 2, classifierEligible: true }] } }] });
    const reopened = await TextbutlerControlService.open({ dataDir, providers: leases => createProviderHost({ dataDir, config, leases }) }); services.push(reopened);
    const initial = await reopened.snapshot(), { accountId: _accountId, ...oldSettings } = initial.contacts[0]!.settings;
    const legacy = await reopened.request({ protocol, command: "contact.settings.update", contactId: "synthetic-a", expectedRevision: 1, settings: { ...oldSettings, provider: "claude" } });
    expect(legacy).toMatchObject({ ok: true, kind: "snapshot", snapshot: { contacts: [{ settings: { accountId: "default", provider: "claude" } }, {}] } });
    const selected = await reopened.request({ protocol, command: "contact.settings.update", contactId: "synthetic-a", expectedRevision: 2, settings: { ...oldSettings, provider: "claude", accountId: "api-owner" } });
    expect(selected.ok).toBe(true);
    expect(await reopened.request({ protocol, command: "contact.settings.update", contactId: "synthetic-a", expectedRevision: 3, settings: { ...oldSettings, provider: "claude" } })).toMatchObject({ ok: true });
    expect((await reopened.settings()).contacts[0]).toMatchObject({ accountId: "api-owner", provider: "claude" });
    expect(await reopened.request({ protocol, command: "contact.settings.update", contactId: "synthetic-a", expectedRevision: 4, settings: { ...oldSettings, provider: "codex", accountId: "api-owner" } })).toMatchObject({ ok: false, code: "invalid-request" });
    const snapshot = await reopened.snapshot(); expect(snapshot.revision).toBe(4);
    expect(snapshot.providerAccounts?.some(account => account.id === "api-owner" && account.route === "claude-api")).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("api-owner-key");
    expect(snapshot.settings.paused).toBe(true);
  });
  test("provider checks use bounded owner jobs without changing settings or blocking pause", async () => {
    const { service, dataDir } = await setup(); await service.close(); services.splice(services.indexOf(service), 1);
    let finish!: () => void, checked = "";
    const ready = new Promise<void>(resolve => { finish = resolve; });
    const reopened = await TextbutlerControlService.open({ dataDir, providers: leases => ({ ...createProviderHost({ dataDir, config: { schemaVersion: 1 }, leases }),
      async check(accountId, signal) { checked = accountId; await ready; signal.throwIfAborted(); },
    }) }); services.push(reopened);
    const job = await reopened.request({ protocol, command: "provider.accounts.check", accountId: "synthetic-api" });
    if (!job.ok || job.kind !== "job") throw new Error("Expected owner job");
    expect(checked).toBe("synthetic-api");
    expect(await reopened.request({ protocol, command: "provider.accounts.check", accountId: "synthetic-api" })).toMatchObject({ ok: false, code: "capacity" });
    expect(await reopened.request({ protocol, command: "global.settings.update", expectedRevision: 1, settings: { paused: true, activeContactLimit: 1 } })).toMatchObject({ ok: true });
    finish();
    let response = await reopened.request({ protocol, command: "owner.job.read", jobId: job.jobId });
    for (let i = 0; response.ok && response.kind === "job" && i < 5; i++) response = await reopened.request({ protocol, command: "owner.job.read", jobId: job.jobId });
    expect(response).toMatchObject({ ok: true, kind: "snapshot", snapshot: { revision: 2, settings: { paused: true } } });
    expect((await reopened.snapshot()).activity).toEqual([]);
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
