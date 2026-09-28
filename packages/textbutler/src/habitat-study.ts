import { Database } from "bun:sqlite";
import { lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { digestCanonical, parseRunReceipt, manifestToJson, parseOrganismManifest, type JsonValue } from "@hraness/algal";
import { parseHabitatPlan } from "./contact-habitat.ts";
import { compileHabitatTask } from "./habitat-task.ts";

export const STUDY_EXPORT_LIMITS = { cases: 128, contacts: 128, sourceBytes: 33_554_432, bytes: 16_777_216 } as const;
/** Personal observations, never labels. Only the explicit private exporter
 * reads this source; it cannot open provider state or change the live journal. */
export async function exportHabitatStudy(databasePath: string, outputPath: string) {
  if (!isAbsolute(databasePath) || !isAbsolute(outputPath)) throw Error("Use absolute private paths");
  const owner = process.getuid?.();
  for (const path of [dirname(databasePath), dirname(outputPath)]) {
    const info = await lstat(path);
    if (!info.isDirectory() || info.uid !== owner || (info.mode & 0o077) !== 0 || await realpath(path) !== path) throw Error("Study directories must be owned, physical and private");
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      const path = databasePath + suffix, info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.uid !== owner || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > STUDY_EXPORT_LIMITS.sourceBytes) throw Error("Unsafe study source");
    } catch (error) { if (suffix === "" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const db = new Database(databasePath, { readonly: true, strict: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    const states = db.query<{ contactId: string; revision: number; value: string }, []>("SELECT contactId,revision,value FROM habitat_state ORDER BY contactId LIMIT 129").all();
    if (states.length > STUDY_EXPORT_LIMITS.contacts) throw Error("Study contact limit exceeded");
    const groups = states.map(row => {
      if (Buffer.byteLength(row.value) > 524_288) throw Error("Habitat state exceeds bound");
      const state = JSON.parse(row.value) as { revision: unknown; champion: unknown };
      if (state.revision !== row.revision) throw Error("Habitat revision mismatch");
      const base = compileHabitatTask("respond", parseHabitatPlan(state.champion));
      return { sourceId: digestCanonical({ contact: row.contactId }), revision: row.revision, stateDigest: digestCanonical(JSON.parse(row.value)), baseTask: base.task };
    });
    const rows = db.query<{ contactId: string; digest: string; value: string; at: number }, []>("SELECT contactId,digest,value,at FROM habitat_evidence ORDER BY at,digest LIMIT 4097").all();
    if (rows.length > 4096) throw Error("Study evidence limit exceeded");
    const cases = [];
    let eligible = 0;
    for (const row of rows) {
      if (Buffer.byteLength(row.value) > 262_144) throw Error("Inference evidence exceeds bound");
      const value = JSON.parse(row.value) as { manifest: unknown; receipt: unknown; output: JsonValue };
      const manifest = parseOrganismManifest(value.manifest);
      if (manifest.key !== "organism:textbutler-respond") continue;
      const receipt = parseRunReceipt(value.receipt);
      if (receipt.digest !== row.digest || receipt.manifestDigest !== digestCanonical(manifestToJson(manifest))) throw Error("Inference provenance mismatch");
      const sourceId = digestCanonical({ contact: row.contactId });
      eligible++;
      // Historical evidence may outlive a contact's current habitat. Keep the
      // omission explicit; never invent a current host task for that source.
      if (!groups.some(group => group.sourceId === sourceId)) continue;
      if (cases.length < STUDY_EXPORT_LIMITS.cases) cases.push({ id: receipt.digest, sourceId, capturedAt: row.at,
        sourceDigest: digestCanonical(JSON.parse(row.value)), observed: { manifest: manifestToJson(manifest), receipt, output: value.output } });
    }
    const body = { contract: "textbutler.observed-task-cases.v1", origin: "private-local-journal", labels: "absent", groups, cases, omitted: eligible - cases.length };
    const archive = { ...body, digest: digestCanonical(body as unknown as JsonValue) }, encoded = JSON.stringify(archive);
    if (Buffer.byteLength(encoded) > STUDY_EXPORT_LIMITS.bytes) throw Error("Study export byte limit exceeded");
    const file = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
    return { contract: body.contract, digest: archive.digest, groups: groups.length, cases: cases.length, omitted: body.omitted, labels: "absent", bytes: Buffer.byteLength(encoded) };
  } finally { db.close(); }
}
