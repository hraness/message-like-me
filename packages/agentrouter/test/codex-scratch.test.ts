import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, realpath, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectCodexScratch } from "../src/codex-scratch.ts";

const configuration = "provider = 'synthetic-native'\n";
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-scratch-"))); await chmod(root, 0o700);
  const scratch = join(root, "child"); await mkdir(scratch, { mode: 0o700 });
  for (const name of ["home", "state", "tmp", "work"]) await mkdir(join(scratch, name), { mode: 0o700 });
  const config = join(scratch, "state", "config.toml"), outside = join(root, "outside.toml");
  for (const path of [config, outside]) await writeFile(path, configuration, { mode: 0o600, flag: "wx" });
  return { root, scratch, config, outside, inspect: () => inspectCodexScratch({ scratch, configuration }), close: () => rm(root, { recursive: true, force: true }) };
}

test("fresh physical scratch has immutable content and identity receipts with no configuration contents", async () => {
  const first = await fixture(), second = await fixture();
  try {
    const receipt = await first.inspect(), repeated = await first.inspect(), independent = await second.inspect();
    expect(receipt.entries.map(entry => entry.path)).toEqual(["", "home", "state", "tmp", "work", "state/config.toml"]);
    expect(receipt.configurationSha256).toBe(createHash("sha256").update(configuration).digest("hex"));
    expect(receipt.configurationBytes).toBe(Buffer.byteLength(configuration));
    expect(receipt.contentSha256).toBe(independent.contentSha256);
    expect(receipt.identitySha256).toBe(repeated.identitySha256);
    expect(receipt.identitySha256).not.toBe(independent.identitySha256);
    expect(receipt.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.identitySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.entries)).toBe(true);
    expect(receipt.entries.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain(configuration);
    expect(JSON.stringify(receipt)).not.toContain(first.root);
  } finally { await first.close(); await second.close(); }
});

test("expected configuration bytes are snapshotted before asynchronous inspection", async () => {
  const state = await fixture();
  try {
    const bytes = Buffer.from(configuration), pending = inspectCodexScratch({ scratch: state.scratch, configuration: bytes });
    bytes.fill(0);
    expect((await pending).configurationSha256).toBe(createHash("sha256").update(configuration).digest("hex"));
  } finally { await state.close(); }
});

test("root, child-directory and configuration symlinks cannot enter the admitted tree", async () => {
  const state = await fixture();
  try {
    const alias = join(state.root, "alias"); await symlink(state.scratch, alias);
    await expect(inspectCodexScratch({ scratch: alias, configuration })).rejects.toThrow("CODEX_SCRATCH_ABSOLUTE_PHYSICAL_PATH_REQUIRED");
    await unlink(state.config); await symlink(state.outside, state.config);
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_INSPECTION_FAILED");
    await unlink(state.config); await writeFile(state.config, configuration, { mode: 0o600, flag: "wx" });
    await rmdir(join(state.scratch, "home")); await symlink(state.root, join(state.scratch, "home"));
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_ABSOLUTE_PHYSICAL_PATH_REQUIRED");
  } finally { await state.close(); }
});

test("inbound outside hardlinks and external aliases of the expected config are both rejected", async () => {
  const state = await fixture();
  try {
    await unlink(state.config); await link(state.outside, state.config);
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_ENTRY_UNSAFE");
    await unlink(state.config); await writeFile(state.config, configuration, { mode: 0o600, flag: "wx" });
    const outbound = join(state.root, "outbound.toml"); await link(state.config, outbound);
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_ENTRY_UNSAFE");
    await unlink(outbound); expect((await state.inspect()).entries.at(-1)?.links).toBe(1);
  } finally { await state.close(); }
});

test("unexpected entries and missing required directories fail the closed layout", async () => {
  const state = await fixture();
  try {
    for (const path of [join(state.scratch, "unexpected"), join(state.scratch, "work", "unexpected"), join(state.scratch, "state", "unexpected")]) {
      await writeFile(path, "synthetic only", { mode: 0o600, flag: "wx" });
      await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_UNEXPECTED_ENTRY"); await unlink(path);
    }
    await rmdir(join(state.scratch, "tmp"));
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_LAYOUT_INVALID");
  } finally { await state.close(); }
});

test("same-size content drift and oversized config cannot receive an inspection receipt", async () => {
  const state = await fixture();
  try {
    await writeFile(state.config, configuration.replace("native", "broken"));
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_CONFIGURATION_MISMATCH");
    await writeFile(state.config, Buffer.alloc(256 * 1024 + 1, 65));
    await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_CONFIGURATION_MISMATCH");
    await expect(inspectCodexScratch({ scratch: state.scratch, configuration: Buffer.alloc(256 * 1024 + 1) })).rejects.toThrow("CODEX_SCRATCH_CONFIGURATION_BOUND");
    await expect(inspectCodexScratch({ scratch: state.scratch, configuration: "" })).rejects.toThrow("CODEX_SCRATCH_CONFIGURATION_BOUND");
  } finally { await state.close(); }
});

test("group-readable, world-readable and executable modes fail before launch", async () => {
  const state = await fixture();
  try {
    for (const path of [state.scratch, join(state.scratch, "home"), join(state.scratch, "state")]) {
      await chmod(path, 0o750); await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_ENTRY_UNSAFE"); await chmod(path, 0o700);
    }
    for (const mode of [0o640, 0o604, 0o700]) {
      await chmod(state.config, mode); await expect(state.inspect()).rejects.toThrow("CODEX_SCRATCH_ENTRY_UNSAFE"); await chmod(state.config, 0o600);
    }
    expect((await state.inspect()).entries.at(-1)?.mode).toBe(0o600);
  } finally { await state.close(); }
});

test("relative and normalized-alias path arguments are rejected before filesystem access", async () => {
  await expect(inspectCodexScratch({ scratch: "relative", configuration })).rejects.toThrow("CODEX_SCRATCH_ABSOLUTE_PHYSICAL_PATH_REQUIRED");
  await expect(inspectCodexScratch({ scratch: "/synthetic/../alias", configuration })).rejects.toThrow("CODEX_SCRATCH_ABSOLUTE_PHYSICAL_PATH_REQUIRED");
});
