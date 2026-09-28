import { expect, test } from "bun:test";
import { MemoryStore, optimizeTask } from "@hraness/algal";
import { buildEvaluatedTaskArtifact } from "@hraness/algal/task-artifact";
import { buildTaskWorkflowArchive, parseTaskWorkflowConfig } from "@hraness/algal/task-workflow";
import { ContactHabitat, DEFAULT_HABITAT_PLAN } from "./contact-habitat.ts";
import { RunJournal } from "./journal.ts";
import { compileHabitatTask } from "./habitat-task.ts";
import { executeHabitatProgram, executeHabitatShadow } from "./habitat-program.ts";
import { inspectHabitatTaskShadow } from "./habitat-task-shadow.ts";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextbutlerControlService, TEXTBUTLER_CONTROL_PROTOCOL as protocol } from "./control-service.ts";
import { newContact } from "./config.ts";
import { handleOwnerCommand } from "./owner-cli.ts";
import type { ControlRequest } from "../../control/src/index.ts";

export async function syntheticShadowEvidence(variant = "one", selectExamples = false) {
  const base = compileHabitatTask("respond", DEFAULT_HABITAT_PLAN).task;
  const config = parseTaskWorkflowConfig({ contract: "algal.task-workflow.v1", task: base, strategy: selectExamples ? "labeled" : "fixed",
    limits: { maxRounds: 0, maxCandidates: 2, maxExamples: 1, portfolioSize: 2, budget: { work: 4_000_000, attempts: 20, runs: 20 } },
    cases: ["train", "validation", "holdout"].map(split => ({ id: split, sourceId: `synthetic-${split}`, split,
      args: { context: { evidence: `Synthetic ${variant} ${split}`, preferences: DEFAULT_HABITAT_PLAN } }, expect: { result: { respond: true } } })) });
  const store = new MemoryStore(), report = await optimizeTask({ ...config, store, executors: [{ id: "synthetic", async execute(request) { return { respond: !selectExamples || request.prompt.includes("Labeled examples") }; } }] });
  return { artifact: await buildEvaluatedTaskArtifact({ baseTask: base, report, store }), archive: await buildTaskWorkflowArchive({ config, report, store }) };
}

test("shadow adoption replays evidence, is revision-bound and leaves the live champion unchanged", async () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-contact");
  try {
    const evidence = await syntheticShadowEvidence();
    await habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive);
    expect(habitat.snapshot().champion).toEqual(DEFAULT_HABITAT_PLAN);
    expect(inspectHabitatTaskShadow(habitat.snapshot().taskShadow, DEFAULT_HABITAT_PLAN, 0)).toMatchObject({ status: "ready", activeForReplies: false });
    await habitat.stageTaskArtifact(1, evidence.artifact, evidence.archive); expect(habitat.snapshot().revision).toBe(1);
    await expect(habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive)).rejects.toThrow("conflict");
    const second = await syntheticShadowEvidence("two"); await habitat.stageTaskArtifact(1, second.artifact, second.archive);
    habitat.rollbackTaskArtifact(2);
    expect(habitat.snapshot().taskShadow?.current?.artifact.digest).toBe(evidence.artifact.digest);
    await expect(habitat.stageTaskArtifact(3, second.artifact, second.archive)).rejects.toThrow("rolled back");
    habitat.configure(3, DEFAULT_HABITAT_PLAN);
    expect(inspectHabitatTaskShadow(habitat.snapshot().taskShadow, DEFAULT_HABITAT_PLAN, habitat.snapshot().ownerRevision ?? 0).status).toBe("stale");
  } finally { journal.close(); }
});

test("invalid, mismatched and tampered shadow evidence cannot change habitat state", async () => {
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "synthetic-contact");
  try {
    const a = await syntheticShadowEvidence(), b = await syntheticShadowEvidence("different");
    await expect(habitat.stageTaskArtifact(0, a.artifact, b.archive)).rejects.toThrow();
    const tampered = structuredClone(a.archive); tampered.report.datasetDigest = `sha256:${"a".repeat(64)}`;
    await expect(habitat.stageTaskArtifact(0, a.artifact, tampered)).rejects.toThrow();
    expect(habitat.snapshot().revision).toBe(0);
    habitat.configure(0, { ...DEFAULT_HABITAT_PLAN, guidance: "Synthetic owner edit" });
    await expect(habitat.stageTaskArtifact(1, a.artifact, a.archive)).rejects.toThrow();
    expect(habitat.snapshot().taskShadow).toBeUndefined();
  } finally { journal.close(); }
});

test("explicit shadow execution returns receipts while ordinary replies retain their host task", async () => {
  const evidence = await syntheticShadowEvidence(); let calls = 0;
  const options = { plan: DEFAULT_HABITAT_PLAN, context: { message: "Synthetic request" }, signal: new AbortController().signal,
    executor: { id: "synthetic", async execute() { calls++; return { respond: false }; } } };
  const shadow = await executeHabitatShadow({ ...options, artifact: evidence.artifact });
  expect(shadow.mode).toBe("shadow-only"); expect(shadow.receipt.manifestDigest).toBe(evidence.artifact.manifestDigest);
  const normal = await executeHabitatProgram({ ...options, phase: "respond" });
  expect(normal.receipt.manifestDigest).toBe(compileHabitatTask("respond", DEFAULT_HABITAT_PLAN).manifestDigest);
  expect(calls).toBe(2);
});

test("owner shadow commands resolve one contact, require pause and expose metadata without activation", async () => {
  const dir = await mkdtemp(join(await realpath("/tmp"), "textbutler-shadow-owner-"));
  const service = await TextbutlerControlService.open({ dataDir: dir, initialSettings: { schemaVersion: 1, paused: true, maxActiveContacts: 1,
    contacts: [newContact("synthetic-a", "Synthetic A", "synthetic-route-a"), newContact("synthetic-b", "Synthetic B", "synthetic-route-b")] } });
  try {
    const evidence = await syntheticShadowEvidence(), file = join(dir, "evidence.json");
    await writeFile(file, JSON.stringify(evidence), { mode: 0o600, flag: "wx" });
    const calls: string[] = [], results: unknown[] = [];
    const cli = { request: async (request: ControlRequest) => { calls.push(request.command); return service.request(request); }, print: (value: unknown) => { results.push(value); } };
    const before = await service.snapshot();
    expect(await service.request({ protocol, command: "habitat.task.stage", contactId: "synthetic-a", expectedRevision: 0, artifact: null, archive: null })).toMatchObject({ ok: false, code: "invalid-request" });
    expect(await service.request({ protocol, command: "habitat.task.stage", contactId: "synthetic-a", expectedRevision: 0, ...evidence, extra: true })).toMatchObject({ ok: false, code: "invalid-request" });
    expect(await handleOwnerCommand(["habitats", "task-stage", "synthetic-a", "0", file], cli)).toBe(0);
    expect(calls).toEqual(["snapshot", "habitat.task.stage"]);
    const read = results.at(-1) as { content: string };
    expect(JSON.parse(read.content).taskShadow).toMatchObject({ status: "ready", activeForReplies: false, artifactDigest: evidence.artifact.digest });
    expect(read.content).not.toContain("Labeled examples");
    expect(await service.snapshot()).toEqual(before);
    const other = await service.request({ protocol, command: "habitat.read", contactId: "synthetic-b" });
    if (!other.ok || other.kind !== "habitat") throw Error("Missing synthetic habitat");
    expect(JSON.parse(other.content).taskShadow.status).toBe("empty");
    expect(await handleOwnerCommand(["habitats", "task-rollback", "synthetic-a", "1"], cli)).toBe(0);
    const snapshot = await service.snapshot();
    await service.request({ protocol, command: "global.settings.update", expectedRevision: snapshot.revision, settings: { ...snapshot.settings, paused: false } });
    expect(await service.request({ protocol, command: "habitat.task.stage", contactId: "synthetic-a", expectedRevision: 2, ...evidence })).toMatchObject({ ok: false, code: "conflict" });
  } finally { await service.close(); await rm(dir, { recursive: true, force: true }); }
});


test("contact adoption and explicit shadow calls reject private examples from another conversation", async () => {
  const evidence = await syntheticShadowEvidence("private-conversation-b", true);
  expect(evidence.artifact.task.examples).toHaveLength(1);
  const journal = RunJournal.memory(), habitat = new ContactHabitat(journal, "contact-a");
  let calls = 0;
  try {
    await expect(habitat.stageTaskArtifact(0, evidence.artifact, evidence.archive)).rejects.toThrow("must not contain conversation examples");
    expect(habitat.snapshot().revision).toBe(0);
    await expect(executeHabitatShadow({ plan: DEFAULT_HABITAT_PLAN, context: { message: "Contact A question" }, artifact: evidence.artifact,
      signal: new AbortController().signal, executor: { id: "must-not-see-contact-b", async execute() { calls++; return { respond: false }; } } })).rejects.toThrow("must not contain conversation examples");
    expect(calls).toBe(0);
  } finally { journal.close(); }
});
