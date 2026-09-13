import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexAccountBinding } from "../src/codex-account.ts";
import type { CodexHostRuntime } from "../src/codex-host.ts";
import { codexAccountOfflineConfiguration, codexAccountOfflineSandbox, createCodexAccountProcess, type CodexAccountOwnedProcessPort, type CodexAccountProcessOptions, type CodexAccountProcessSystem, type CodexAccountSpawn } from "../src/codex-account-process.ts";

const sha = (input: string) => createHash("sha256").update(input).digest("hex");
const binding: CodexAccountBinding = { accountId: "synthetic-account", owner: "synthetic-owner", leaseGeneration: 2, processGeneration: 3 };
const parentSha = sha("synthetic-parent"), schemaSha = sha("synthetic-schema");
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Real private filesystem boundary, synthetic detached process. No executable,
 * provider, account credential, network, or shell is used by these fixtures. */
async function fixture(input: {
  parent?: Promise<CodexHostRuntime>; onSpawn?: (request: CodexAccountSpawn) => void;
  stop?: "hold" | "exit-only" | "root-and-close"; pgid?: number | null; pid?: number | null;
  spawnFailsBeforePid?: boolean;
} = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-account-process-test-")));
  await chmod(root, 0o700); const stateRoot = join(root, "state"); await mkdir(stateRoot, { mode: 0o700 });
  const executablePath = join(root, "synthetic-executable");
  await writeFile(executablePath, "synthetic executable bytes; never run", { mode: 0o500 });
  const native = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough(), writes: string[] = [];
  const stdin = new Writable({ write(chunk, _encoding, done) { writes.push(chunk.toString()); done(); } });
  let groupPresent = true, rootExited = false, closed = false;
  const pid = input.spawnFailsBeforePid || input.pid === null ? undefined : input.pid ?? 41001;
  const signals: ("SIGTERM" | "SIGKILL" | 0)[] = [], spawns: CodexAccountSpawn[] = [], ports: CodexAccountOwnedProcessPort[] = [];
  function exitRoot() { if (!rootExited) { rootExited = true; native.emit("exit", 0, null); } }
  function closeStreams() { stdin.destroy(); stdout.destroy(); stderr.destroy(); }
  function emitClose() { if (!closed) { closed = true; native.emit("close", 0, null); } }
  function finish() { groupPresent = false; exitRoot(); closeStreams(); emitClose(); }
  const child = Object.assign(native, { pid, stdin, stdout, stderr, kill(signal: "SIGTERM" | "SIGKILL") { signals.push(signal); finish(); return true; } }) as unknown as ChildProcessWithoutNullStreams;
  const parent: CodexHostRuntime = { executablePath: "/synthetic-parent", version: "1.3.14", platform: "darwin", arch: "arm64", sha256: parentSha };
  const host: CodexAccountProcessSystem = {
    inspectParent: () => input.parent ?? Promise.resolve(parent),
    spawn(request) { spawns.push(request); input.onSpawn?.(request); queueMicrotask(() => {
      if (input.spawnFailsBeforePid) { native.emit("error", new Error("synthetic spawn rejection")); closeStreams(); emitClose(); }
      else native.emit("spawn");
    }); return child; },
    processGroup: () => input.pgid === undefined ? pid ?? null : input.pgid,
    signalGroup(_group, signal) { signals.push(signal); if (signal === 0) return groupPresent;
      if (input.stop === "exit-only") exitRoot();
      else if (input.stop === "root-and-close") { groupPresent = false; exitRoot(); emitClose(); }
      else if (input.stop !== "hold") finish();
      return true;
    },
  };
  const options: CodexAccountProcessOptions = { binding, stateRoot, mode: "offline", runtime: { executablePath, version: "synthetic-1", sha256: sha("synthetic executable bytes; never run"), schemaSha256: schemaSha, parentRuntime: { expectedSha256: parentSha } } };
  const create = (overrides: Partial<CodexAccountProcessOptions> = {}, system = host) => { const port = createCodexAccountProcess({ ...options, ...overrides }, system); ports.push(port); return port; };
  const stop = (port: CodexAccountOwnedProcessPort, milliseconds = 1000) => port.stopAndJoin({ binding: port.binding, deadlineMs: Date.now() + milliseconds });
  cleanups.push(async () => { finish(); for (const port of ports) await stop(port, 1000); await rm(root, { recursive: true, force: true }); });
  return { root, stateRoot, options, parent, create, host, spawns, signals, writes, native, stdin, stdout, stderr, stop, finish, exitRoot, closeStreams, emitClose,
    accountRoot: join(stateRoot, "accounts", binding.accountId), setGroupPresent(value: boolean) { groupPresent = value; } };
}
function expectJoined(result: Awaited<ReturnType<CodexAccountOwnedProcessPort["stopAndJoin"]>>, expected = binding) {
  expect(result).toEqual({ binding: expected, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true });
}

test("launches only the immutable offline snapshot with a closed environment and preserves persistent account files", async () => {
  const f = await fixture(), port = f.create(); await port.ready;
  const request = f.spawns[0]!;
  expect(request.executable).toBe("/usr/bin/sandbox-exec");
  expect(request.args.slice(3)).toEqual(["app-server", "--strict-config", "--listen", "stdio://"]);
  expect(request.detached).toBe(true); expect(request.stdio).toEqual(["pipe", "pipe", "pipe"]);
  expect(Object.keys(request.env).sort()).toEqual(["CODEX_HOME", "CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED", "HOME", "NO_COLOR", "PATH", "TMPDIR"]);
  const snapshot = request.args[2]!, home = request.env.CODEX_HOME!, scratch = dirname(request.cwd);
  expect(snapshot.startsWith(scratch + "/")).toBe(false); expect(snapshot.startsWith(home + "/")).toBe(false);
  expect(await readFile(snapshot, "utf8")).toBe("synthetic executable bytes; never run");
  expect(Number((await lstat(snapshot)).mode) & 0o777).toBe(0o500);
  expect(await readdir(request.env.HOME!)).toEqual([]);
  const profile = await readFile(request.args[1]!, "utf8");
  expect(profile).toContain("(deny default)"); expect(profile).not.toMatch(/\(allow (?:network|mach|process-fork)/u);
  expect(profile).not.toContain(f.options.runtime.executablePath);
  expect(await readFile(join(home, "config.toml"), "utf8")).toBe(codexAccountOfflineConfiguration());
  await writeFile(join(home, "synthetic-preserved-state"), "opaque synthetic account state", { mode: 0o600 });
  expect(port.receipt()).toMatchObject({ productionQualified: false, network: "denied", schemaSha256: schemaSha, nativeSha256: f.options.runtime.sha256, parentSha256: parentSha, phase: "running" });
  expectJoined(await f.stop(port));
  expect(await readFile(join(home, "synthetic-preserved-state"), "utf8")).toBe("opaque synthetic account state");
  expect((await readdir(f.accountRoot)).sort()).toEqual(["codex-home", "owner.json"]);
  expect((await readdir(dirname(port.receipt().journalPath!))).sort()).toEqual(["custody.jsonl", "sandbox.sb"]);
  expect(port.receipt()).toMatchObject({ phase: "closed", scratchRetained: false, lockReleased: true });
});

test("the durable pre-spawn journal records uncertainty with no PID and terminal proof precedes lock release", async () => {
  let pending: any;
  const f = await fixture({ onSpawn(request) { const lock = JSON.parse(readFileSync(join(dirname(request.env.CODEX_HOME!), "active.json"), "utf8"));
    pending = JSON.parse(readFileSync(lock.journalPath, "utf8").trim().split("\n").at(-1)!); } });
  const port = f.create(); await port.ready;
  expect(pending.snapshot).toMatchObject({ phase: "launch-pending", launchAttempted: true, pid: null, pgid: null, lockReleased: false, binding });
  expectJoined(await f.stop(port));
  const lines = (await readFile(port.receipt().journalPath!, "utf8")).trim().split("\n");
  let previous: string | null = null;
  for (let index = 0; index < lines.length; index++) { const record = JSON.parse(lines[index]!); expect(record.sequence).toBe(index); expect(record.previousSha256).toBe(previous); previous = sha(lines[index]! + "\n"); }
  expect(JSON.parse(lines.at(-1)!).snapshot).toMatchObject({ phase: "closed", rootExited: true, groupAbsent: true, stdoutJoined: true, stderrJoined: true, lockReleased: false, scratchRetained: false });
});

test("snapshots admitted identity before asynchronous work and rejects unexpected parent identity", async () => {
  const gate = deferred<CodexHostRuntime>(), f = await fixture({ parent: gate.promise });
  const options = { ...f.options, runtime: { ...f.options.runtime, parentRuntime: { ...f.options.runtime.parentRuntime } }, binding: { ...binding } };
  const port = f.create(options); options.binding.accountId = "different"; options.runtime.executablePath = "/wrong"; options.runtime.sha256 = sha("wrong"); options.runtime.parentRuntime.expectedSha256 = sha("wrong");
  gate.resolve(f.parent); await port.ready; expect(port.binding).toEqual(binding); expect(port.receipt().nativeSha256).toBe(f.options.runtime.sha256); expectJoined(await f.stop(port));
  const other = await fixture({ parent: Promise.resolve({ ...f.parent, sha256: sha("other-parent") }) }), rejected = other.create();
  await expect(rejected.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await other.stop(rejected)); expect(other.spawns).toHaveLength(0);
});

test.each(["oauth", "online", "managed"])("rejects %s activation synchronously", async mode => {
  const f = await fixture(); expect(() => f.create({ mode } as any)).toThrow("OFFLINE_REQUIRED"); expect(f.spawns).toHaveLength(0);
});

test("rejects arbitrary argv, environment, token fields, accessors, invalid pins and widened stop requests", async () => {
  const f = await fixture();
  for (const key of ["argv", "env", "accessToken", "contactPath"]) expect(() => f.create({ [key]: "denied" } as any)).toThrow("UNKNOWN_FIELD");
  let called = false; const options = { ...f.options }; Object.defineProperty(options, "runtime", { get() { called = true; return f.options.runtime; } });
  expect(() => createCodexAccountProcess(options, f.host)).toThrow("ACCESSOR_DENIED"); expect(called).toBe(false);
  expect(() => f.create({ runtime: { ...f.options.runtime, schemaSha256: "not-a-pin" } })).toThrow("PIN_INVALID");
  const port = f.create(); await port.ready;
  expect(() => port.stopAndJoin({ binding, deadlineMs: Date.now() + 1000, force: true } as any)).toThrow("UNKNOWN_FIELD");
  for (const changed of [{ accountId: "other" }, { owner: "other" }, { leaseGeneration: 4 }, { processGeneration: 9 }]) expect(() => port.stopAndJoin({ binding: { ...binding, ...changed }, deadlineMs: Date.now() + 1000 })).toThrow("BINDING_MISMATCH");
  for (const deadlineMs of [Date.now() - 1, Date.now() + 121000, 1.5, Infinity]) expect(() => port.stopAndJoin({ binding, deadlineMs })).toThrow();
  expect(f.signals).toHaveLength(0); expect(port.receipt().phase).toBe("running"); expectJoined(await f.stop(port));
});

test.each(["pin", "executable-symlink", "state-symlink", "state-mode"])("rejects %s before native launch", async kind => {
  const f = await fixture(); let options: Partial<CodexAccountProcessOptions> = {};
  if (kind === "pin") options = { runtime: { ...f.options.runtime, sha256: sha("wrong") } };
  else if (kind === "executable-symlink") { const link = join(f.root, "executable-link"); await symlink(f.options.runtime.executablePath, link); options = { runtime: { ...f.options.runtime, executablePath: link } }; }
  else if (kind === "state-symlink") { const link = join(f.root, "state-link"); await symlink(f.stateRoot, link); options = { stateRoot: link }; }
  else await chmod(f.stateRoot, 0o755);
  const port = f.create(options); await expect(port.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(port)); expect(f.spawns).toHaveLength(0);
});

test("a preexisting unowned account directory is never adopted or changed", async () => {
  const f = await fixture(); await mkdir(dirname(f.accountRoot), { mode: 0o700 }); await mkdir(f.accountRoot, { mode: 0o700 });
  await writeFile(join(f.accountRoot, "sentinel"), "untouched", { mode: 0o600 });
  const port = f.create(); await expect(port.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(port));
  expect(await readdir(f.accountRoot)).toEqual(["sentinel"]); expect(f.spawns).toHaveLength(0);
});

test("a concurrent same-account owner cannot replace or release the first durable lock", async () => {
  const f = await fixture(), first = f.create(); await first.ready;
  const original = await readFile(join(f.accountRoot, "active.json"), "utf8");
  const next = f.create({ binding: { ...binding, owner: "next", leaseGeneration: 3, processGeneration: 4 } });
  await expect(next.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(next), next.binding);
  expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toBe(original); expect(f.signals).toHaveLength(0); expect(f.spawns).toHaveLength(1);
  expectJoined(await f.stop(first));
});

test.each(["config", "home"])("a locked contender cannot recreate missing native %s before lock refusal", async missing => {
  const f = await fixture(), first = f.create(); await first.ready;
  const home = join(f.accountRoot, "codex-home"), removed = missing === "home" ? home : join(home, "config.toml");
  await rm(removed, { recursive: true }); const lock = await readFile(join(f.accountRoot, "active.json"), "utf8");
  const contender = f.create({ binding: { ...binding, owner: "contender", leaseGeneration: 4, processGeneration: 5 } });
  await expect(contender.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(contender), contender.binding);
  await expect(lstat(removed)).rejects.toThrow(); expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toBe(lock);
  expect(f.spawns).toHaveLength(1); expect(f.signals).toHaveLength(0); expectJoined(await f.stop(first));
});

test("an uncertain spawn retains the PID-unknown lock and cannot authorize a new generation", async () => {
  const f = await fixture({ onSpawn() { throw new Error("private native error detail"); } }), port = f.create();
  await expect(port.ready).rejects.toThrow("UNAVAILABLE");
  expect((await f.stop(port)).processGroupStopped).toBe(false);
  expect(port.receipt()).toMatchObject({ phase: "recovery-required", launchAttempted: true, pid: null, lockReleased: false, scratchRetained: true });
  expect(JSON.stringify(port.receipt())).not.toContain("private native error detail");
  const before = await readFile(join(f.accountRoot, "active.json"), "utf8");
  const next = f.create({ binding: { ...binding, leaseGeneration: 99, processGeneration: 99 } });
  await expect(next.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(next), next.binding);
  expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toBe(before); expect(f.spawns).toHaveLength(1);
});

test("a native spawn error with no PID proves no process only after child and actual streams close", async () => {
  const f = await fixture({ spawnFailsBeforePid: true }), port = f.create();
  await expect(port.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(port));
  expect(port.receipt()).toMatchObject({ launchAttempted: true, pid: null, groupAbsent: true, lockReleased: true, phase: "closed" });
  expect(f.signals).toHaveLength(0);
});

test("immediate close prevents launch and shares one joined result", async () => {
  const f = await fixture(), port = f.create(), first = f.stop(port), second = f.stop(port);
  expect(first).toBe(second); expectJoined(await first); await expect(port.ready).rejects.toThrow("UNAVAILABLE"); expect(f.spawns).toHaveLength(0);
});

test("a timed-out preparation keeps custody until preparation actually settles and never launches late", async () => {
  const parent = deferred<CodexHostRuntime>(), f = await fixture({ parent: parent.promise }), port = f.create();
  // Enter the deferred parent inspection deterministically without timers.
  let inspecting!: () => void; const inspected = new Promise<void>(resolve => { inspecting = resolve; });
  const other = f.create({ binding: { ...binding, accountId: "other" } }, { ...f.host, inspectParent() { inspecting(); return parent.promise; } });
  await inspected; expect((await f.stop(other, 20)).processGroupStopped).toBe(false);
  parent.resolve(f.parent); await expect(other.ready).rejects.toThrow("UNAVAILABLE"); expectJoined(await f.stop(other), other.binding);
  await port.ready; expect(f.spawns).toHaveLength(1); expectJoined(await f.stop(port));
});

test("root exit and a claimed process close cannot release custody while native streams remain open", async () => {
  const f = await fixture({ stop: "root-and-close" }), port = f.create(); await port.ready;
  expect((await f.stop(port, 20)).processGroupStopped).toBe(false);
  expect(port.receipt()).toMatchObject({ rootExited: true, groupAbsent: true, stdoutJoined: false, lockReleased: false, scratchRetained: true });
  expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toContain("synthetic-account");
  f.closeStreams(); expectJoined(await f.stop(port));
});

test("a group present after root exit is never signaled by stale ID and retains custody until absent", async () => {
  const f = await fixture({ stop: "exit-only" }), port = f.create(); await port.ready;
  expect((await f.stop(port, 20)).processGroupStopped).toBe(false);
  expect(f.signals).toContain("SIGTERM"); expect(f.signals).not.toContain("SIGKILL"); expect(port.receipt().lockReleased).toBe(false);
  const destructiveSignals = f.signals.filter(signal => signal !== 0).length;
  expect((await f.stop(port, 20)).processGroupStopped).toBe(false); expect(f.signals.filter(signal => signal !== 0)).toHaveLength(destructiveSignals);
  f.finish(); expectJoined(await f.stop(port));
});

test("an unproven detached group cannot be replaced with root-only kill proof", async () => {
  const f = await fixture({ pgid: 999 }), port = f.create(); await expect(port.ready).rejects.toThrow("UNAVAILABLE");
  const result = await f.stop(port); expect(result.processExited).toBe(true); expect(result.processGroupStopped).toBe(false);
  expect(port.receipt().lockReleased).toBe(false); expect(f.signals).toContain("SIGTERM");
});

test.each(["scratch", "runtime"])("replaced %s directories are retained and never recursively deleted", async name => {
  const f = await fixture(), port = f.create(); await port.ready;
  const target = join(dirname(port.receipt().journalPath!), name); await rename(target, target + "-original"); await mkdir(target, { mode: 0o700 }); await writeFile(join(target, "sentinel"), "retain", { mode: 0o600 });
  expect((await f.stop(port)).processGroupStopped).toBe(false); expect(await readFile(join(target, "sentinel"), "utf8")).toBe("retain"); expect(port.receipt().lockReleased).toBe(false);
});

test("native-modified config and changed lock bytes are never silently repaired", async () => {
  const f = await fixture(), port = f.create(); await port.ready;
  await writeFile(join(f.accountRoot, "active.json"), "changed lock", { mode: 0o600 });
  expect((await f.stop(port)).processGroupStopped).toBe(false); expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toBe("changed lock");
  await writeFile(join(f.accountRoot, "codex-home", "config.toml"), "modified config", { mode: 0o600 });
  const next = f.create({ binding: { ...binding, processGeneration: 4 } }); await expect(next.ready).rejects.toThrow("UNAVAILABLE");
  expectJoined(await f.stop(next), next.binding); expect(f.spawns).toHaveLength(1); expect(await readFile(join(f.accountRoot, "codex-home", "config.toml"), "utf8")).toBe("modified config");
});

test("synchronous stop reentry during launch shares cleanup and cannot expose a running port", async () => {
  let port!: CodexAccountOwnedProcessPort, first: Promise<unknown> | undefined, second: Promise<unknown> | undefined;
  const f = await fixture({ onSpawn() { first = f.stop(port); second = f.stop(port); } });
  port = f.create(); await expect(port.ready).rejects.toThrow("UNAVAILABLE"); expect(first).toBe(second); expectJoined(await f.stop(port)); expect(f.spawns).toHaveLength(1);
});

test("bounded stderr overflow stops the process without journaling native bytes", async () => {
  const f = await fixture(), port = f.create(); await port.ready;
  f.stderr.write(Buffer.alloc(256 * 1024 + 1, "s")); expectJoined(await f.stop(port));
  expect(port.receipt().failures).toContain("stderr-bound"); expect((await readFile(port.receipt().journalPath!, "utf8")).length).toBeLessThan(64 * 1024);
});

test("the sandbox rejects writable executable placement and never infers broader native privileges", () => {
  for (const executable of ["/private/account/codex", "/private/scratch/codex"]) expect(() => codexAccountOfflineSandbox({ executable, scratch: "/private/scratch", accountHome: "/private/account" })).toThrow("LAYOUT_INVALID");
  const configuration = codexAccountOfflineConfiguration(); expect(configuration).toContain('forced_login_method = "chatgpt"'); expect(configuration).toContain('cli_auth_credentials_store = "file"');
  expect(configuration).not.toContain("api_key"); expect(configuration).not.toContain("base_url");
});
