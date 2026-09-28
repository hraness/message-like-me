import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunJournal } from "./journal.ts";
import { ContactHabitat, DEFAULT_HABITAT_PLAN } from "./contact-habitat.ts";
import { executeHabitatProgram } from "./habitat-program.ts";
import { exportHabitatStudy } from "./habitat-study.ts";

test("private capture exports observed evidence without labeling, mutating or overwriting", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "textbutler-study-"))), path = join(dir, "runs.sqlite"), out = join(dir, "capture.json");
  const journal = await RunJournal.open(path);
  try {
    const habitat = new ContactHabitat(journal, "synthetic-contact"); habitat.configure(0, DEFAULT_HABITAT_PLAN);
    const run = await executeHabitatProgram({ phase: "respond", plan: DEFAULT_HABITAT_PLAN, context: { message: "Synthetic question" }, signal: new AbortController().signal,
      executor: { id: "synthetic", async execute() { return { respond: true, confidence: 0.9, actions: [] }; } } });
    journal.recordHabitatEvidence("synthetic-contact", run.receipt.digest, JSON.stringify(run), 123);
    const before = habitat.snapshot(), summary = await exportHabitatStudy(path, out);
    expect(summary).toMatchObject({ cases: 1, groups: 1, labels: "absent", omitted: 0 });
    expect(habitat.snapshot()).toEqual(before);
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    const value = JSON.parse(await readFile(out, "utf8"));
    expect(value.cases[0].observed.receipt).toEqual(run.receipt);
    expect(value.cases[0]).not.toHaveProperty("expected");
    expect(JSON.stringify(value)).not.toContain("synthetic-contact");
    await expect(exportHabitatStudy(path, out)).rejects.toThrow();
    await symlink(path, join(dir, "linked.sqlite"));
    await expect(exportHabitatStudy(join(dir, "linked.sqlite"), join(dir, "bad.json"))).rejects.toThrow("Unsafe");
  } finally { journal.close(); await rm(dir, { recursive: true, force: true }); }
});
