import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const [mode, artifactArgument, manifestArgument] = process.argv.slice(2);
if ((mode !== "write" && mode !== "check") || artifactArgument === undefined || manifestArgument === undefined) {
  throw new Error("Usage: release-artifact-checksum.ts <write|check> ARTIFACT SHA256SUMS");
}

const artifact = resolve(artifactArgument);
const manifest = resolve(manifestArgument);
const digest = createHash("sha256").update(await readFile(artifact)).digest("hex");
const line = `${digest}  ${basename(artifact)}\n`;

if (mode === "write") {
  await writeFile(manifest, line, { encoding: "utf8", mode: 0o644 });
  console.log(`Wrote SHA-256 for ${basename(artifact)}.`);
} else {
  const expected = await readFile(manifest, "utf8");
  if (expected !== line) throw new Error(`SHA-256 mismatch for ${basename(artifact)}.`);
  console.log(`Verified SHA-256 for ${basename(artifact)}.`);
}
