import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_NATIVE_SHA256, codexMacSandbox, createCodexProcessLauncher, inspectCodexExecutable, parseCodexCustodyJournal } from "../src/codex-process.ts";

test("custody preserves the last complete identity after a partial append and rejects broken or drifting records", () => {
  const snapshot = { schema: "agentrouter.codex-process.v2", nativeVersion: "0.153.4", executableSha256: CODEX_NATIVE_SHA256,
    runtimeSnapshotSha256: CODEX_NATIVE_SHA256, configSha256: "a".repeat(64), profileSha256: "b".repeat(64),
    parentRuntimeSha256: "c".repeat(64), scratchContentSha256: "d".repeat(64), scratchIdentitySha256: "e".repeat(64),
    custodyPath: "/owned/run/custody.jsonl", runId: "run-one", accountId: "account-one", workspaceId: "contact-one",
    pid: null as number | null, pgid: null as number | null, rootExited: false, groupAbsent: false, stdioJoined: false,
    scratchRetained: true, nativeExitCode: null, nativeExitSignal: null, runtimeErrors: [], cleanupErrors: [] };
  const first = JSON.stringify({ sequence: 0, previousSha256: null, snapshot }) + "\n";
  const digest = createHash("sha256").update(first).digest("hex");
  const second = (change: Record<string, unknown> = {}) => JSON.stringify({ sequence: 1, previousSha256: digest, snapshot: { ...snapshot, pid: 123, ...change } }) + "\n";
  expect(parseCodexCustodyJournal(first + second())).toMatchObject({ snapshot: { pid: 123, pgid: null }, incompleteTail: false });
  expect(parseCodexCustodyJournal(first + second() + '{"sequence":2')).toMatchObject({ snapshot: { pid: 123 }, incompleteTail: true });
  expect(() => parseCodexCustodyJournal('{"sequence":0')).toThrow("CODEX_CUSTODY_JOURNAL_INCOMPLETE");
  expect(() => parseCodexCustodyJournal(first + second({ accountId: "other-account" }))).toThrow("CODEX_CUSTODY_BINDING_CHANGED");
  for (const key of ["parentRuntimeSha256", "scratchContentSha256", "scratchIdentitySha256"] as const) {
    expect(() => parseCodexCustodyJournal(first + second({ [key]: "f".repeat(64) }))).toThrow("CODEX_CUSTODY_BINDING_CHANGED");
    expect(() => parseCodexCustodyJournal(first + second({ [key]: undefined }))).toThrow("CODEX_CUSTODY_DIGEST_INVALID");
    expect(() => parseCodexCustodyJournal(first + second({ [key]: "invalid" }))).toThrow("CODEX_CUSTODY_DIGEST_INVALID");
  }
  expect(() => parseCodexCustodyJournal(first.replace("agentrouter.codex-process.v2", "agentrouter.codex-process.v1"))).toThrow("CODEX_CUSTODY_IDENTITY_INVALID");
  expect(() => parseCodexCustodyJournal(first + second({ groupAbsent: true }))).toThrow("CODEX_CUSTODY_ORDER_INVALID");
  expect(() => parseCodexCustodyJournal(first + second().replace(digest, "c".repeat(64)))).toThrow("CODEX_CUSTODY_CHAIN_INVALID");
  expect(() => parseCodexCustodyJournal(first + second().replace('"sequence":1', '"sequence":2'))).toThrow("CODEX_CUSTODY_CHAIN_INVALID");
  expect(parseCodexCustodyJournal(first + second({ runtimeErrors: ["startup"], cleanupErrors: ["signal-sigterm", "signal-sigkill"] })).snapshot.cleanupErrors)
    .toEqual(["signal-sigterm", "signal-sigkill"]);
  expect(parseCodexCustodyJournal(first + second({ runtimeErrors: ["parent-runtime-drift"], rootExited: true, groupAbsent: true, stdioJoined: true })).snapshot)
    .toMatchObject({ rootExited: true, groupAbsent: true, stdioJoined: true, scratchRetained: true, runtimeErrors: ["parent-runtime-drift"] });
});

test("native artifact admission rejects unreviewed bytes, links, writable files and oversized metadata before execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentrouter-codex-file-"));
  try {
    const binary = join(root, "binary"); await writeFile(binary, "synthetic executable", { mode: 0o500 });
    await expect(inspectCodexExecutable(binary)).rejects.toThrow("CODEX_EXECUTABLE_CHANGED_OR_UNREVIEWED");
    const symbolic = join(root, "symbolic"); await symlink(binary, symbolic);
    await expect(inspectCodexExecutable(symbolic)).rejects.toThrow();
    const hard = join(root, "hard"); await link(binary, hard);
    await expect(inspectCodexExecutable(binary)).rejects.toThrow("CODEX_EXECUTABLE_IDENTITY_INVALID");
    await rm(hard); await chmod(binary, 0o700); await truncate(binary, 256 * 1024 * 1024 + 1);
    await expect(inspectCodexExecutable(binary)).rejects.toThrow("CODEX_EXECUTABLE_IDENTITY_INVALID");
    await truncate(binary, 1); await chmod(binary, 0o722);
    await expect(inspectCodexExecutable(binary)).rejects.toThrow("CODEX_EXECUTABLE_IDENTITY_INVALID");
    await chmod(binary, 0o600);
    await expect(inspectCodexExecutable(binary)).rejects.toThrow("CODEX_EXECUTABLE_IDENTITY_INVALID");
    await expect(inspectCodexExecutable("relative")).rejects.toThrow("CODEX_ABSOLUTE_EXECUTABLE_REQUIRED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile input cannot add a policy rule, execute a mutable snapshot, or open a second network destination", () => {
  const valid = { executable: "/owned/run/runtime/codex", scratch: "/owned/run/child", relayPort: 43210 };
  const profile = codexMacSandbox(valid);
  expect(profile).toContain('(allow file-read* file-write* (subpath "/owned/run/child"))');
  expect(profile).not.toContain('(subpath "/owned/run")');
  expect(profile).not.toContain('(subpath "/owned/run/runtime")');
  expect(profile.match(/\(allow network-outbound/g)).toHaveLength(1);
  expect(profile).toContain('localhost:43210');
  expect(profile).not.toContain("process-fork");
  expect(profile).toContain('"/etc/codex/requirements.toml"');
  for (const changed of [
    { executable: "/owned/run/child/codex" }, { executable: "/owned/run/child" },
    { executable: '/owned/escape"\n(allow default)' }, { scratch: "/owned/line\nbreak" },
    { scratch: "relative" }, { relayPort: 0 }, { relayPort: 65536 }, { relayPort: 1.5 },
  ]) expect(() => codexMacSandbox({ ...valid, ...changed })).toThrow();
});

test("prelaunch requires private physical host state and honors cancellation without a native process", async () => {
  if (process.platform !== "darwin" || process.arch !== "arm64") return;
  const root = await mkdtemp(join(tmpdir(), "agentrouter-codex-launch-"));
  try {
    const state = join(root, "state"); await mkdir(state, { mode: 0o755 });
    const input = { runId: "run-one", accountId: "account-one", workspaceId: "contact-one", configuration: "synthetic", relayPort: 43210, signal: new AbortController().signal };
    await expect(createCodexProcessLauncher({ executablePath: join(root, "absent"), stateRoot: state, parentRuntime: { expectedSha256: "0".repeat(64) } }).launch(input)).rejects.toThrow("CODEX_PRIVATE_STATE_REQUIRED");
    await chmod(state, 0o700); const alias = join(root, "alias"); await symlink(state, alias);
    await expect(createCodexProcessLauncher({ executablePath: join(root, "absent"), stateRoot: alias, parentRuntime: { expectedSha256: "0".repeat(64) } }).launch(input)).rejects.toThrow("CODEX_PRIVATE_STATE_REQUIRED");
    const abort = new AbortController(); abort.abort(new Error("synthetic cancellation"));
    await expect(createCodexProcessLauncher({ executablePath: join(root, "absent"), stateRoot: state, parentRuntime: { expectedSha256: "0".repeat(64) } }).launch({ ...input, signal: abort.signal })).rejects.toThrow("synthetic cancellation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("constructor validates a closed admitted parent binding without reading the actual executable", () => {
  const options = { executablePath: "/synthetic/absent-native", stateRoot: "/synthetic/absent-state" };
  let getterReads = 0;
  const accessor = Object.defineProperty({}, "expectedSha256", { get() { getterReads++; return "0".repeat(64); } });
  for (const parentRuntime of [undefined, null, {}, [], accessor, { expectedSha256: "0".repeat(64), executablePath: "/override" }]) {
    expect(() => createCodexProcessLauncher({ ...options, parentRuntime } as Parameters<typeof createCodexProcessLauncher>[0])).toThrow("CODEX_HOST_BINDING_INVALID");
  }
  expect(getterReads).toBe(0);
  for (const expectedSha256 of ["", "0".repeat(63), "G".repeat(64), "A".repeat(64), "0".repeat(64) + "\n"]) {
    expect(() => createCodexProcessLauncher({ ...options, parentRuntime: { expectedSha256 } })).toThrow("CODEX_HOST_PIN_INVALID");
  }
  const binding = { expectedSha256: "0".repeat(64) };
  expect(() => createCodexProcessLauncher({ ...options, parentRuntime: binding })).not.toThrow();
});
