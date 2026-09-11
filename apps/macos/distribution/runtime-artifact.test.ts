import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packagedProviderArtifact } from "../scripts/runtime-artifact.ts";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "textbutler-runtime-receipt-"))); roots.push(root);
  const entrypoint = join(root, "cli.ts"), bytes = "Synthetic compiled fixture", sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(entrypoint, bytes, { mode: 0o600 });
  const manifest = { schema: "textbutler.runtime.v1", bunVersion: "1.3.14", files: [{ path: "cli.ts", bytes: Buffer.byteLength(bytes), sha256, macho: false }] };
  const save = async () => writeFile(join(root, "runtime-manifest.json"), JSON.stringify(manifest), { mode: 0o600 }); await save();
  return { root, entrypoint, sha256, manifest, save };
}
test("fixed packaged receipt admits only exact compiled bytes", async () => {
  const f = await fixture(); expect(await packagedProviderArtifact(f.entrypoint)).toEqual({ entrypoint: f.entrypoint, sha256: f.sha256 });
  await writeFile(f.entrypoint, "changed bytes"); await expect(packagedProviderArtifact(f.entrypoint)).rejects.toThrow();
});
test("packaged receipt rejects repeated entries, path links and unsafe modes", async () => {
  const f = await fixture(); f.manifest.files.push(f.manifest.files[0]!); await f.save(); await expect(packagedProviderArtifact(f.entrypoint)).rejects.toThrow();
  f.manifest.files.pop(); await f.save(); await chmod(f.entrypoint, 0o666); await expect(packagedProviderArtifact(f.entrypoint)).rejects.toThrow();
  await chmod(f.entrypoint, 0o600); const linked = join(f.root, "linked"); await symlink(f.root, linked); await expect(packagedProviderArtifact(join(linked, "cli.ts"))).rejects.toThrow();
});
