import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyHostLifecycle } from "@hraness/algal";
import { newContact, type ContactSettings } from "./config.ts";
import { ContactHabitat, DEFAULT_HABITAT_PLAN } from "./contact-habitat.ts";
import { CONTACT_STATUS_CONTRACT, projectContactStatus } from "./contact-status.ts";
import { TextbutlerControlService } from "./control-service.ts";
import { RunJournal } from "./journal.ts";
import { handleOwnerCommand } from "./owner-cli.ts";
import { syntheticShadowEvidence } from "./habitat-task-shadow.test.ts";
import type { ControlRequest } from "../../control/src/index.ts";

const enabledContact = (id = "synthetic-a"): ContactSettings => ({ ...newContact(id, "Synthetic A", "synthetic-route-a"), enabled: true });

/** A read journal stub: only the two methods the projection may call exist. */
function readOnlyJournal(journal: RunJournal, calls: string[]) {
  return {
    uncertainRuns: (contactId: string) => { calls.push("uncertainRuns"); return journal.uncertainRuns(contactId); },
    recent: (contactId: string, limit?: number) => { calls.push("recent"); return journal.recent(contactId, limit); },
  };
}

function verifiedLifecycle(projection: ReturnType<typeof projectContactStatus>) {
  // The record must survive a foreign-value round trip through the shared parser.
  return verifyHostLifecycle(JSON.parse(JSON.stringify(projection.lifecycle)));
}

test("a paused lane with a ready shadow artifact projects suspended with rollback retained", async () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-a");
  try {
    const evidence = await syntheticShadowEvidence();
    await habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive);
    const calls: string[] = [];
    const projection = projectContactStatus(enabledContact(), habitat.snapshot(), readOnlyJournal(journal, calls), { paused: true, scopedGrant: true, now: 1_000 });
    expect(calls.sort()).toEqual(["recent", "uncertainRuns"]);
    expect(projection.contract).toBe(CONTACT_STATUS_CONTRACT);
    expect(projection.lifecycle.state).toBe("suspended");
    expect(projection.lifecycle.pendingIntent).toBeNull();
    expect(projection.lifecycle.receipt).toBe(evidence.artifact.digest);
    expect(projection.lifecycle.heldAuthority).toEqual(["scoped-messaging-grant"]);
    expect(projection.lifecycle.permittedOperatorActions).toEqual(["inspect", "resume", "rollback", "stop"]);
    expect(projection.shadow).toMatchObject({ status: "ready", stale: false, stagedOwnerRevision: 0, ownerRevision: 0, activeForReplies: false });
    expect(verifiedLifecycle(projection).digest).toBe(projection.lifecycle.digest);
  } finally { journal.close(); }
});

test("an indeterminate journaled send projects uncertain and retains the recorded send intent", async () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-a");
  try {
    const evidence = await syntheticShadowEvidence();
    await habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive);
    const planDigest = "a".repeat(64);
    expect(journal.claim("run-1", "synthetic-a", "event-1", 500)).toBe(true);
    journal.transition("run-1", "running", "dispatching", "intent-recorded", 600, planDigest);
    journal.transition("run-1", "dispatching", "indeterminate", "send-outcome-unknown", 700);
    const projection = projectContactStatus(enabledContact(), habitat.snapshot(), journal, { paused: true, scopedGrant: true, now: 1_000 });
    expect(projection.lifecycle.state).toBe("uncertain");
    expect(projection.lifecycle.pendingIntent).toBe(`sha256:${planDigest}`);
    expect(projection.lifecycle.permittedOperatorActions).toContain("reconcile");
    expect(projection.lifecycle.permittedOperatorActions).not.toContain("suspend");
    expect(verifiedLifecycle(projection).digest).toBe(projection.lifecycle.digest);
  } finally { journal.close(); }
});

test("an open intent without a recorded plan still retains a deterministic pending intent", () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-a");
  try {
    expect(journal.claim("run-2", "synthetic-a", "event-2", 500)).toBe(true);
    journal.transition("run-2", "running", "dispatching", "intent-recorded", 600);
    journal.transition("run-2", "dispatching", "partial", "dispatch-result-unknown", 700);
    const projection = projectContactStatus(enabledContact(), habitat.snapshot(), journal, { paused: false, scopedGrant: false, now: 1_000 });
    expect(projection.lifecycle.state).toBe("uncertain");
    expect(projection.lifecycle.pendingIntent).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const again = projectContactStatus(enabledContact(), habitat.snapshot(), journal, { paused: false, scopedGrant: false, now: 1_000 });
    expect(again.lifecycle.pendingIntent).toBe(projection.lifecycle.pendingIntent);
    expect(verifiedLifecycle(projection).digest).toBe(projection.lifecycle.digest);
  } finally { journal.close(); }
});

test("a stale shadow artifact is reported beside the record, not hidden in the state", async () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-a");
  try {
    const evidence = await syntheticShadowEvidence();
    await habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive);
    habitat.configure(1, { ...DEFAULT_HABITAT_PLAN, guidance: "Synthetic owner edit" });
    const state = habitat.snapshot();
    expect(state.ownerRevision).toBe(1);
    const projection = projectContactStatus(enabledContact(), state, journal, { paused: false, scopedGrant: false, now: 1_000 });
    expect(projection.lifecycle.state).toBe("settled");
    expect(projection.lifecycle.generation).toBe(1);
    expect(projection.lifecycle.receipt).toBe(evidence.artifact.digest);
    expect(projection.shadow).toMatchObject({ status: "stale", stale: true, stagedOwnerRevision: 0, ownerRevision: 1, artifactDigest: evidence.artifact.digest });
    expect(projection.lifecycle.permittedOperatorActions).toContain("rollback");
    expect(verifiedLifecycle(projection).digest).toBe(projection.lifecycle.digest);
  } finally { journal.close(); }
});

test("submitted, failed and in-flight runs project settled, failed and running", () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-a");
  try {
    const contact = enabledContact();
    expect(journal.claim("run-a", contact.id, "event-a", 100)).toBe(true);
    journal.transition("run-a", "running", "submitted", "submitted", 200);
    expect(projectContactStatus(contact, habitat.snapshot(), journal, { paused: false, scopedGrant: false, now: 1_000 }).lifecycle.state).toBe("settled");
    expect(journal.claim("run-b", contact.id, "event-b", 300)).toBe(true);
    journal.transition("run-b", "running", "failed", "run-failed", 400);
    expect(projectContactStatus(contact, habitat.snapshot(), journal, { paused: false, scopedGrant: false, now: 1_000 }).lifecycle.state).toBe("failed");
    expect(journal.claim("run-c", contact.id, "event-c", 500)).toBe(true);
    const running = projectContactStatus(contact, habitat.snapshot(), journal, { paused: false, scopedGrant: false, now: 1_000 });
    expect(running.lifecycle.state).toBe("running");
    expect(running.lifecycle.backlog).toEqual({ queued: 0, active: 1 });
    expect(verifiedLifecycle(running).digest).toBe(running.lifecycle.digest);
  } finally { journal.close(); }
});

test("the projection never mutates retained state and reaches no send path", async () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-a");
  try {
    const evidence = await syntheticShadowEvidence();
    await habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive);
    expect(journal.claim("run-1", "synthetic-a", "event-1", 500)).toBe(true);
    journal.transition("run-1", "running", "dispatching", "intent-recorded", 600, "b".repeat(64));
    journal.transition("run-1", "dispatching", "indeterminate", "send-outcome-unknown", 700);
    const before = { habitat: JSON.stringify(habitat.snapshot()), runs: JSON.stringify(journal.recent("synthetic-a", 200)) };
    const snapshot = habitat.snapshot();
    const frozen = Object.freeze(snapshot);
    const projection = projectContactStatus(enabledContact(), frozen, journal, { paused: true, scopedGrant: true, now: 1_000 });
    expect(JSON.stringify(habitat.snapshot())).toBe(before.habitat);
    expect(JSON.stringify(journal.recent("synthetic-a", 200))).toBe(before.runs);
    // An uncertain record resolves only through reconcile; nothing here retries.
    expect(projection.lifecycle.state).toBe("uncertain");
    const source = await readFile(join(import.meta.dir, "contact-status.ts"), "utf8");
    expect(source).not.toMatch(/owner-replies|reply-loop|runtime\.ts|transport\.|replies\.send|\.submit\(/u);
    expect(source).not.toMatch(/\.claim\(|\.transition\(|\.reconcile\(|recordSentMessages|recordGrantIntent/u);
  } finally { journal.close(); }
});

test("habitats show returns the status projection inside the owner habitat view", async () => {
  const dir = await mkdtemp(join(await realpath("/tmp"), "textbutler-status-"));
  const service = await TextbutlerControlService.open({ dataDir: dir, initialSettings: { schemaVersion: 1, paused: true, maxActiveContacts: 1, contacts: [newContact("synthetic-a", "Synthetic A", "synthetic-route-a")] } });
  try {
    const evidence = await syntheticShadowEvidence(), file = join(dir, "evidence.json");
    await writeFile(file, JSON.stringify(evidence), { mode: 0o600, flag: "wx" });
    const results: unknown[] = [];
    const cli = { request: async (request: ControlRequest) => service.request(request), print: (value: unknown) => { results.push(value); } };
    expect(await handleOwnerCommand(["habitats", "task-stage", "synthetic-a", "0", file], cli)).toBe(0);
    results.length = 0;
    expect(await handleOwnerCommand(["habitats", "show", "synthetic-a"], cli)).toBe(0);
    const view = JSON.parse((results.at(-1) as { content: string }).content) as Record<string, unknown>;
    const status = view.status as ReturnType<typeof projectContactStatus>;
    expect(status.contract).toBe(CONTACT_STATUS_CONTRACT);
    expect(status.contactId).toBe("synthetic-a");
    expect(status.lifecycle.state).toBe("suspended");
    expect(status.shadow.status).toBe("ready");
    expect(verifyHostLifecycle(status.lifecycle).digest).toBe(status.lifecycle.digest);
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});
