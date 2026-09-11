/** Synthetic CLI protocol fixture: never loads providers, credentials, or user data. */
import { chmodSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "../src/validation";

const argv = process.argv.slice(2);
const flag = (name: string): string => { const value = argv[argv.indexOf(name) + 1]; if (value === undefined) throw new Error("Missing test argument"); return value; };
const sha = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
if (argv[0] === "capabilities") {
  process.stdout.write(JSON.stringify({ ok: true, adapters: [], ambientSecretPresent: process.env.TEXTBUTLER_FIXTURE_SECRET !== undefined }));
} else if (argv[0] === "confirm") {
  const run = { schemaVersion: 1, format: "wrench.messaging-run", planDigest: argv[1], runId: "fixture-run", state: "partial", partCount: 2, provenPartCount: 1, clientIntentSha256: "a".repeat(64), turnDigest: "b".repeat(64), previewDigest: "c".repeat(64), recordedAt: "2026-09-11T12:00:00.000Z" };
  const core = { schemaVersion: 2, format: "wrench.messaging-receipt-binding", runId: run.runId, state: run.state, partCount: run.partCount, provenPartCount: run.provenPartCount, clientIntentSha256: run.clientIntentSha256, turnDigest: run.turnDigest, previewDigest: run.previewDigest, recordedAt: run.recordedAt };
  const receiptSha256 = sha(core);
  writeFileSync(flag("--private-output"), JSON.stringify(run), { mode: 0o600 });
  writeFileSync(flag("--receipt-binding-output"), JSON.stringify({ ...core, receiptSha256 }), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ ...run, schemaVersion: 2, format: "wrench.messaging-run-receipt", receiptBindingSha256: receiptSha256 }));
  process.exitCode = 3;
} else {
  const input = JSON.parse(await new Response(Bun.stdin).text()) as { fixtureMode?: string };
  const path = flag("--private-output");
  const artifact = { schemaVersion: 1, format: "wrench.messaging-context", synthetic: true, path };
  writeFileSync(path, JSON.stringify(artifact), { mode: 0o600 });
  if (input.fixtureMode === "insecure") chmodSync(path, 0o644);
  process.stdout.write(JSON.stringify({ schemaVersion: 1, format: "wrench.messaging-private-output-receipt", artifactFormat: artifact.format, artifactSha256: input.fixtureMode === "tampered" ? "0".repeat(64) : sha(artifact) }));
}
