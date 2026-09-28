import { canonicalize, compileTask, type JsonValue } from "@hraness/algal";
import { assertEvaluatedTaskCompatible, parseEvaluatedTaskArtifact, type EvaluatedTaskArtifact } from "@hraness/algal/task-artifact";
import { verifyTaskWorkflowArchive } from "@hraness/algal/task-workflow";
import { compileHabitatTask } from "./habitat-task.ts";
import type { HabitatPlan } from "./contact-habitat.ts";

export const SHADOW_LIMITS = { artifactBytes: 65_536, archiveBytes: 786_432, denied: 16 } as const;
export type HabitatShadowEntry = { artifact: EvaluatedTaskArtifact; archiveDigest: string; ownerRevision: number };
export type HabitatTaskShadow = { mode: "shadow-only"; current: HabitatShadowEntry | null; previous: HabitatShadowEntry | null; denied: string[] };
const hash = (x: unknown): x is string => typeof x === "string" && /^sha256:[a-f0-9]{64}$/u.test(x);
function record(raw: unknown, keys: string[]) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw Error("Invalid task shadow record");
  const row = raw as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw Error("Invalid task shadow fields");
  return row;
}
export function parseHabitatTaskShadow(raw: unknown): HabitatTaskShadow {
  const state = record(raw, ["mode", "current", "previous", "denied"]);
  if (state.mode !== "shadow-only" || !Array.isArray(state.denied) || state.denied.length > SHADOW_LIMITS.denied || !state.denied.every(hash)) throw Error("Invalid task shadow state");
  const entry = (raw: unknown): HabitatShadowEntry | null => {
    if (raw === null) return null;
    const row = record(raw, ["artifact", "archiveDigest", "ownerRevision"]);
    if (Buffer.byteLength(JSON.stringify(row.artifact)) > SHADOW_LIMITS.artifactBytes || !hash(row.archiveDigest) || !Number.isSafeInteger(row.ownerRevision) || (row.ownerRevision as number) < 0) throw Error("Task shadow exceeds bounds");
    return { artifact: parseEvaluatedTaskArtifact(row.artifact), archiveDigest: row.archiveDigest, ownerRevision: row.ownerRevision as number };
  };
  return { mode: state.mode, current: entry(state.current), previous: entry(state.previous), denied: [...state.denied] as string[] };
}
/** Replay is necessary evidence, never proof that annotations are true. This
 * admission only enables explicit shadow evaluation, not live reply selection. */
export async function qualifyHabitatTaskShadow(plan: HabitatPlan, artifactInput: unknown, archiveInput: unknown) {
  if (Buffer.byteLength(JSON.stringify(artifactInput)) > SHADOW_LIMITS.artifactBytes || Buffer.byteLength(JSON.stringify(archiveInput)) > SHADOW_LIMITS.archiveBytes) throw Error("Task shadow evidence exceeds bounds");
  const artifact = parseEvaluatedTaskArtifact(artifactInput), base = compileHabitatTask("respond", plan);
  assertEvaluatedTaskCompatible(artifact, base.task);
  if (artifact.task.examples.length !== 0) throw Error("Contact shadow artifacts must not contain conversation examples");
  const { archive, report } = await verifyTaskWorkflowArchive(archiveInput);
  if (report.status !== "complete" || report.selected?.taskDigest !== artifact.taskDigest || report.digest !== artifact.evaluation.reportDigest
    || report.datasetDigest !== artifact.evaluation.datasetDigest || report.strategy !== artifact.evaluation.strategy
    || compileTask(archive.config.task).taskDigest !== base.taskDigest || canonicalize(report.selected.task as unknown as JsonValue) !== canonicalize(artifact.task as unknown as JsonValue)) throw Error("Task shadow does not bind its evaluated evidence");
  return { artifact, archiveDigest: archive.digest };
}
export function inspectHabitatTaskShadow(value: HabitatTaskShadow | undefined, plan: HabitatPlan, ownerRevision: number) {
  if (!value) return { mode: "shadow-only", status: "empty", activeForReplies: false } as const;
  const current = value.current;
  let compatible = false;
  if (current && current.ownerRevision === ownerRevision && !value.denied.includes(current.artifact.digest)) {
    try { assertEvaluatedTaskCompatible(current.artifact, compileHabitatTask("respond", plan).task); compatible = true; } catch { /* Report stale; do not select another artifact. */ }
  }
  return { mode: value.mode, status: current ? compatible ? "ready" : "stale" : "empty", activeForReplies: false,
    artifactDigest: current?.artifact.digest ?? null, archiveDigest: current?.archiveDigest ?? null, previousDigest: value.previous?.artifact.digest ?? null, denied: value.denied.length };
}
