import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { type BigIntStats } from "node:fs";
import { chmod, link, lstat, mkdtemp, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCodexHostFileStable, assertCodexHostRuntimeFacts, inspectCodexHostExecutable,
  inspectCodexHostRuntime, type CodexParentRuntimeBinding } from "../src/codex-host.ts";

const bytes = Buffer.from("synthetic parent runtime artifact\n"), sha256 = createHash("sha256").update(bytes).digest("hex");
async function fixture(run: (path: string, root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-host-file-")));
  try {
    await chmod(root, 0o700);
    const path = join(root, "bun"); await writeFile(path, bytes, { mode: 0o500 });
    await run(path, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("the file verifier matches independently supplied bytes and returns immutable file evidence only", async () => {
  await fixture(async path => {
    const value = await inspectCodexHostExecutable(path, sha256);
    expect(value).toEqual({ executablePath: path, sha256 });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.keys(value).sort()).toEqual(["executablePath", "sha256"]);
    await chmod(path, 0o755);
    expect((await inspectCodexHostExecutable(path, sha256)).sha256).toBe(sha256);
    await expect(inspectCodexHostExecutable(path, "a".repeat(64))).rejects.toThrow("CODEX_HOST_PIN_MISMATCH");
  });
});

test("actual host entry rejects malformed bindings and never invokes binding getters or accepts identity overrides", async () => {
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "expectedSha256", { enumerable: true, get() { getterReads++; return sha256; } });
  for (const value of [undefined, null, [], {}, { expectedSha256: sha256, executablePath: "/synthetic/bun" },
    { expectedSha256: sha256, version: "1.3.14" }, { expectedSha256: sha256, platform: "darwin" },
    { expectedSha256: sha256, arch: "arm64" }, { expectedSha256: sha256, [Symbol("extra")]: true },
    Object.create({ expectedSha256: sha256 }), accessor]) {
    await expect(inspectCodexHostRuntime(value as CodexParentRuntimeBinding)).rejects.toThrow("CODEX_HOST_BINDING_INVALID");
  }
  expect(getterReads).toBe(0);
  for (const expectedSha256 of [undefined, null, 1, "", "a".repeat(63), "g".repeat(64), "A".repeat(64), sha256 + "\n"]) {
    await expect(inspectCodexHostRuntime({ expectedSha256 } as CodexParentRuntimeBinding)).rejects.toThrow("CODEX_HOST_PIN_INVALID");
  }
});

test("runtime fact admission requires exact Bun identity and the supported platform without UID elevation", () => {
  const facts = { version: "1.3.14", reportedVersion: "1.3.14", platform: "darwin", arch: "arm64", uid: 501, effectiveUid: 501 };
  expect(() => assertCodexHostRuntimeFacts(facts)).not.toThrow();
  expect(() => assertCodexHostRuntimeFacts({ ...facts, uid: 0, effectiveUid: 0 })).not.toThrow();
  for (const change of [{ version: undefined }, { version: "1.3.15" }, { version: "1.3.14-debug" },
    { reportedVersion: undefined }, { reportedVersion: "1.3.13" }, { platform: "linux" }, { arch: "x64" },
    { uid: undefined }, { uid: -1 }, { uid: 1.5 }, { uid: Number.NaN }, { uid: Number.MAX_SAFE_INTEGER + 1 },
    { effectiveUid: undefined }, { effectiveUid: 0 }]) {
    expect(() => assertCodexHostRuntimeFacts({ ...facts, ...change })).toThrow("CODEX_HOST_RUNTIME_UNSUPPORTED");
  }
});

test("file admission refuses leaf and ancestor symlinks, noncanonical paths, hard links and directories", async () => {
  await fixture(async (path, root) => {
    const symbolic = join(root, "symbolic"), alias = join(root, "alias"), hard = join(root, "hard");
    await symlink(path, symbolic); await symlink(root, alias);
    for (const value of [symbolic, join(alias, "bun"), "relative", root + "/./bun", root + "/nested/../bun", path + "\0", "/" + "a".repeat(4096)]) {
      await expect(inspectCodexHostExecutable(value, sha256)).rejects.toThrow("CODEX_HOST_PATH_INVALID");
    }
    await expect(inspectCodexHostExecutable(root, sha256)).rejects.toThrow("CODEX_HOST_EXECUTABLE_INVALID");
    await link(path, hard);
    await expect(inspectCodexHostExecutable(path, sha256)).rejects.toThrow("CODEX_HOST_EXECUTABLE_INVALID");
    await rm(hard);
    expect((await inspectCodexHostExecutable(path, sha256)).sha256).toBe(sha256);
  });
});

test("file admission rejects writable, nonexecutable, empty and oversized metadata before hashing", async () => {
  await fixture(async path => {
    // This filesystem strips chmod's setuid/setgid bits; do not claim those modes were exercised here.
    for (const mode of [0o720, 0o702, 0o777, 0o600, 0o400]) {
      await chmod(path, mode);
      await expect(inspectCodexHostExecutable(path, sha256)).rejects.toThrow("CODEX_HOST_EXECUTABLE_INVALID");
    }
    await chmod(path, 0o700); await truncate(path, 0);
    await expect(inspectCodexHostExecutable(path, sha256)).rejects.toThrow("CODEX_HOST_EXECUTABLE_INVALID");
    await truncate(path, 256 * 1024 * 1024 + 1);
    await expect(inspectCodexHostExecutable(path, sha256)).rejects.toThrow("CODEX_HOST_EXECUTABLE_INVALID");
  });
});

test("stable file identity rejects every authority-bearing metadata drift and an identical-byte inode replacement", async () => {
  await fixture(async (path, root) => {
    const before = await lstat(path, { bigint: true });
    expect(() => assertCodexHostFileStable(before, before, before)).not.toThrow();
    for (const key of ["dev", "ino", "size", "mode", "uid", "gid", "nlink", "mtimeNs", "ctimeNs"] as const) {
      const changed = Object.assign(Object.create(Object.getPrototypeOf(before)), before, { [key]: before[key] + 1n }) as BigIntStats;
      expect(() => assertCodexHostFileStable(before, before, changed)).toThrow("CODEX_HOST_EXECUTABLE_CHANGED");
    }
    const replacement = join(root, "replacement"); await writeFile(replacement, bytes, { mode: 0o500 }); await rename(replacement, path);
    const after = await lstat(path, { bigint: true });
    expect(() => assertCodexHostFileStable(before, after)).toThrow("CODEX_HOST_EXECUTABLE_CHANGED");
  });
});

test("platform I/O errors do not disclose local paths in custody diagnostics", async () => {
  await fixture(async (_path, root) => {
    try { await inspectCodexHostExecutable(join(root, "absent"), sha256); throw new Error("unexpected success"); }
    catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("CODEX_HOST_FILE_IO_FAILED");
      expect((error as Error).message).not.toContain(root);
    }
  });
});
