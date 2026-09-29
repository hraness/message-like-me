import { expect, test } from "bun:test";
import type { AutomationGrant } from "../../transport/src/automation.ts";
import { RunJournal } from "./journal.ts";

const grant = (id: string, enrollmentId: string, bindingDigest: string): AutomationGrant =>
  ({ id, enrollmentId, expectedBindingDigest: bindingDigest, actions: ["text"], expiresAt: new Date(100_000_000).toISOString(), maximumActions: 10, minimumIntervalMs: 0, revoked: false, consumedActions: 0 });

test("uncertain runs reconcile once and release the contact", () => {
  const journal = RunJournal.memory();
  journal.claim("run-1", "contact-1", "event-1", 1000);
  journal.transition("run-1", "running", "dispatching", "intent-recorded", 1000);
  journal.recover(2000);
  expect(journal.hasUncertainSend("contact-1")).toBe(true);
  expect(journal.uncertainRuns("contact-1").map(run => run.id)).toEqual(["run-1"]);
  expect(journal.recent("contact-1")[0]?.state).toBe("indeterminate");
  journal.reconcile("run-1", "submitted", "reconciled: observed in history", 3000);
  expect(journal.hasUncertainSend("contact-1")).toBe(false);
  expect(journal.uncertainRuns("contact-1")).toHaveLength(0);
  expect(journal.recent("contact-1")[0]).toMatchObject({ state: "submitted", reason: "reconciled: observed in history" });
  // Reconciliation is single-shot: a settled run cannot be moved again.
  expect(() => journal.reconcile("run-1", "failed", "second attempt", 4000)).toThrow("Run state changed");
  journal.close();
});

test("retention prunes old settled runs but never uncertain ones", () => {
  const journal = RunJournal.memory();
  journal.claim("old-settled", "contact-1", "event-1", 1000);
  journal.transition("old-settled", "running", "submitted", "done", 1000);
  journal.claim("old-uncertain", "contact-2", "event-2", 1000);
  journal.transition("old-uncertain", "running", "dispatching", "intent-recorded", 1000);
  journal.recover(2000);
  // The next claim carries the retention sweep (90 days of settled runs kept).
  const later = 2000 + 90 * 86_400_000 + 1000;
  expect(journal.claim("new-run", "contact-3", "event-3", later)).toBe(true);
  expect(journal.recent("contact-1")).toHaveLength(0);
  expect(journal.recent("contact-2")[0]?.state).toBe("indeterminate");
  expect(journal.hasUncertainSend("contact-2")).toBe(true);
  journal.close();
});

test("contact-scoped grant queries never cross contacts", () => {
  const journal = RunJournal.memory();
  const digest = "a".repeat(64);
  journal.recordGrantIntent({ id: "intent-1", contactId: "contact-1", enrollmentId: "enr-1", bindingDigest: digest });
  journal.recordGrantIntent({ id: "intent-2", contactId: "contact-2", enrollmentId: "enr-2", bindingDigest: digest });
  expect(journal.grantIntents("contact-1").map(row => row.id)).toEqual(["intent-1"]);
  expect(journal.grantIntents()).toHaveLength(2);
  journal.recordPendingGrant("contact-1", grant("grant-1", "enr-1", digest));
  journal.recordPendingGrant("contact-2", grant("grant-2", "enr-2", digest));
  expect(journal.pendingGrants("contact-1").map(row => row.grant.id)).toEqual(["grant-1"]);
  expect(journal.pendingGrants()).toHaveLength(2);
  journal.close();
});

test("send provenance separates butler and operator sends and migrates older journals", async () => {
  const { mkdtemp, realpath, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { Database } = await import("bun:sqlite");
  const root = await realpath(await mkdtemp(join(tmpdir(), "journal-origin-")));
  try {
    const path = join(root, "journal.sqlite");
    // A journal written before provenance existed: sent_messages has four columns.
    const legacy = new Database(path, { create: true });
    legacy.exec("CREATE TABLE sent_messages (messageId TEXT NOT NULL, contactId TEXT NOT NULL, runId TEXT NOT NULL, sentAt INTEGER NOT NULL, PRIMARY KEY(messageId, contactId))");
    legacy.query("INSERT INTO sent_messages VALUES(?,?,?,?)").run("old-1", "contact-1", "run-old", 1);
    legacy.close();
    const { chmod } = await import("node:fs/promises");
    await chmod(path, 0o600);
    const journal = await RunJournal.open(path);
    try {
      expect(journal.messageOrigin("contact-1", "old-1")).toBe("butler");
      journal.recordSentMessages("contact-1", "run-op", ["op-1"], 2, "operator");
      journal.recordSentMessages("contact-1", "run-b", ["b-1"], 3);
      expect(journal.messageOrigin("contact-1", "op-1")).toBe("operator");
      expect(journal.isButlerMessage("contact-1", "op-1")).toBe(false);
      expect(journal.sentMessageOrigin("b-1")).toBe("butler");
      expect(journal.messageOrigin("contact-2", "op-1")).toBeNull();
      expect(() => journal.recordSentMessages("contact-1", "run-x", ["x"], 4, "robot" as never)).toThrow();
    } finally { journal.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator runs never count against the butler reply budget", () => {
  const journal = RunJournal.memory();
  journal.claim("butler-1", "contact-1", "event-1", 10);
  journal.transition("butler-1", "running", "dispatching", "intent", 11);
  journal.transition("butler-1", "dispatching", "submitted", "sent", 11);
  journal.claim("operator-1", "contact-1", "operator:campaign-key-0000000001", 12);
  journal.transition("operator-1", "running", "dispatching", "intent", 13);
  expect(journal.repliesSince("contact-1", 0)).toBe(1);
  expect(journal.operatorRuns("contact-1", "campaign-key-0000000001").map(run => run.id)).toEqual(["operator-1"]);
  expect(journal.operatorRuns("contact-2", "campaign-key-0000000001")).toEqual([]);
  // Operator sends never stand in for butler send recency.
  journal.recordSentMessages("contact-1", "operator-1", ["op-1"], 14, "operator");
  expect(journal.lastButlerSendAt("contact-1")).toBeNull();
  journal.recordSentMessages("contact-1", "butler-1", ["b-1"], 11);
  expect(journal.lastButlerSendAt("contact-1")).toBe(11);
  journal.close();
});

test("operator runs outlive ordinary run retention so their keys stay exactly-once", () => {
  const journal = RunJournal.memory(), day = 86_400_000;
  journal.claim("butler-1", "contact-1", "event-1", 0);
  journal.transition("butler-1", "running", "failed", "done", 0);
  journal.claim("operator-1", "contact-1", "operator:campaign-key-0000000002", 1);
  journal.transition("operator-1", "running", "dispatching", "intent", 1, "a".repeat(64));
  journal.transition("operator-1", "dispatching", "submitted", "sent", 1);
  journal.claim("later", "contact-2", "event-2", 200 * day);
  expect(journal.recent("contact-1").map(run => run.id)).toEqual(["operator-1"]);
  journal.claim("much-later", "contact-2", "event-3", 402 * day);
  expect(journal.recent("contact-1")).toEqual([]);
});

test("operator pacing counts claimed, dispatched and provider-failed operator runs across contacts", () => {
  const journal = RunJournal.memory();
  expect(journal.lastOperatorSendAt()).toBeNull();
  journal.claim("butler-1", "contact-1", "event-1", 10);
  expect(journal.lastOperatorSendAt()).toBeNull();
  journal.claim("op-1", "contact-2", "operator:campaign-key-0000000001", 20);
  expect(journal.lastOperatorSendAt()).toBe(20);
  journal.transition("op-1", "running", "abandoned", "daemon restarted", 25);
  expect(journal.lastOperatorSendAt()).toBeNull();
  journal.claim("op-2", "contact-3", "operator:campaign-key-0000000002", 30);
  journal.transition("op-2", "running", "dispatching", "intent", 31, "b".repeat(64));
  journal.transition("op-2", "dispatching", "failed", "provider refused", 32);
  expect(journal.lastOperatorSendAt()).toBe(32);
  journal.close();
});
