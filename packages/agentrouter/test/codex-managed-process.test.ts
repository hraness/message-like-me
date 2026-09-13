import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { constants, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createCapabilityProfile } from "../src/capabilities.ts";
import { codexManagedAccountConfiguration } from "../src/codex-managed-baseline.ts";
import { createCodexManagedProcessLauncher, codexManagedOfflineSandbox, type CodexManagedOwnedProcess, type CodexManagedProcessOptions, type CodexManagedProcessSystem, type CodexManagedSpawn } from "../src/codex-managed-process.ts";
import type { CodexHostRuntime } from "../src/codex-host.ts";
import type { AgentTaskExecutionRequest } from "../src/task-runtime.ts";
import { withTaskLease } from "./task-lease-test-fixture.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const executableBytes = "synthetic executable bytes; never run", parentSha = sha("parent"), schemaSha = sha("schema"), runtimeDigest = sha("explicit composite adapter runtime identity");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

/** Real private scratch filesystem and actual stream closure events, with a
 * synthetic child only. Runtime lease authority comes solely from runAgentTask. */
async function fixture(input: { parent?: Promise<CodexHostRuntime>; onInspect?: () => void; onSpawn?: (request: CodexManagedSpawn) => void;
  stop?: "hold" | "exit-only" | "root-and-close"; pgid?: number; spawnFails?: boolean; maxCleanupMs?: number; maxRunMs?: number } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-managed-process-test-"))); await chmod(root, 0o700);
  const stateRoot = join(root, "state"), accountRoot = join(stateRoot, "accounts", "synthetic-account"), accountHome = join(accountRoot, "codex-home");
  for (const path of [stateRoot, join(stateRoot, "accounts"), accountRoot, accountHome, join(stateRoot, "runs")]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(accountRoot, "owner.json"), JSON.stringify({ schema: "agentrouter.codex-account-home.v1", accountId: "synthetic-account" }) + "\n", { mode: 0o600 });
  await writeFile(join(accountHome, "config.toml"), codexManagedAccountConfiguration(), { mode: 0o600 });
  await writeFile(join(accountHome, "synthetic-preserved-state"), "opaque synthetic persistent bytes", { mode: 0o600 });
  const executablePath = join(root, "synthetic-executable"); await writeFile(executablePath, executableBytes, { mode: 0o500 });
  const parent: CodexHostRuntime = { executablePath: "/synthetic-parent", version: "1.3.14", platform: "darwin", arch: "arm64", sha256: parentSha };
  const options: CodexManagedProcessOptions = { stateRoot, runtime: { executablePath, version: "synthetic-native", sha256: sha(executableBytes), schemaSha256: schemaSha, parentRuntime: { expectedSha256: parentSha } },
    admission: { profile: "managed-task-offline-candidate-v1", taskRuntimeVersion: "synthetic-adapter", taskRuntimeDigest: runtimeDigest, nativeSha256: sha(executableBytes), schemaSha256: schemaSha, parentSha256: parentSha } };
  const native = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough(), writes: string[] = [];
  const stdin = new Writable({ write(chunk, _encoding, done) { writes.push(chunk.toString()); done(); } });
  const closedStreams = Promise.all([stdin, stdout, stderr].map(stream => new Promise<void>(done => stream.once("close", done))));
  let groupPresent = true, rootExited = false, closed = false, inspections = 0;
  const pid = input.spawnFails ? undefined : 41001;
  const signals: ("SIGTERM" | "SIGKILL" | 0)[] = [], spawns: CodexManagedSpawn[] = [], handles: CodexManagedOwnedProcess[] = [];
  function exitRoot() { if (!rootExited) { rootExited = true; native.emit("exit", 0, null); } }
  function closeStreams() { stdin.destroy(); stdout.destroy(); stderr.destroy(); }
  function emitClose() { if (!closed) { closed = true; native.emit("close", 0, null); } }
  function finish() { groupPresent = false; exitRoot(); closeStreams(); emitClose(); }
  const child = Object.assign(native, { pid, stdin, stdout, stderr, kill(signal: "SIGTERM" | "SIGKILL") { signals.push(signal); finish(); return true; } }) as unknown as ChildProcessWithoutNullStreams;
  const system: CodexManagedProcessSystem = {
    inspectParent() { inspections++; input.onInspect?.(); return input.parent ?? Promise.resolve(parent); },
    spawn(request) { spawns.push(request); input.onSpawn?.(request); queueMicrotask(() => { if (input.spawnFails) { native.emit("error", new Error("synthetic no-pid failure")); closeStreams(); emitClose(); } else native.emit("spawn"); }); return child; },
    processGroup: () => input.pgid ?? pid ?? null,
    signalGroup(_group, signal) { signals.push(signal); if (signal === 0) return groupPresent;
      if (input.stop === "exit-only") exitRoot(); else if (input.stop === "root-and-close") { groupPresent = false; exitRoot(); emitClose(); }
      else if (input.stop !== "hold") finish(); return true; },
  };
  const launcher = createCodexManagedProcessLauncher(options, system), profile = createCapabilityProfile({ id: "synthetic-process", version: 1, tools: [] });
  const began = Date.now(), maxRunMs = input.maxRunMs ?? 10_000, maxCleanupMs = input.maxCleanupMs ?? 1000;
  const request: AgentTaskExecutionRequest = { runId: "synthetic-run", accountId: "synthetic-account", workspaceId: "synthetic-workspace", route: { id: "synthetic-route", provider: "codex", authentication: "subscription" },
    profile: { id: profile.id, version: profile.version, digest: profile.digest }, model: { id: "synthetic-model", reasoningEffort: null, serviceTier: null },
    purpose: "synthetic", prompt: "fixture prompt never journaled", signal: new AbortController().signal, limits: { maxRunMs, maxCleanupMs, maxOutputBytes: 128 },
    runtime: { runtimeVersion: "synthetic-adapter", runtimeDigest, evidenceDigest: sha("synthetic qualification only"), qualificationExpiresAt: began + 100_000 },
    accountLease: { provider: "codex", accountId: "synthetic-account", owner: "synthetic-run", generation: 1, expiresAt: began + maxRunMs + maxCleanupMs },
    admittedAtUnixMs: began, executionDeadlineUnixMs: began + maxRunMs, cleanupDeadlineUnixMs: began + maxRunMs + maxCleanupMs };
  function launchInput(request: AgentTaskExecutionRequest, cancellationSignal = new AbortController().signal) { return { request, runId: request.runId, accountId: request.accountId, workspaceId: request.workspaceId, configuration: codexManagedAccountConfiguration(), accountLease: request.accountLease, cancellationSignal }; }
  async function launch(request: AgentTaskExecutionRequest, cancellationSignal?: AbortSignal, selected = launcher) { const handle = await selected.launch(launchInput(request, cancellationSignal)) as CodexManagedOwnedProcess; handles.push(handle); return handle; }
  const owned = <T>(action: (request: AgentTaskExecutionRequest) => Promise<T>) => withTaskLease(request, profile, action);
  cleanup.push(async () => { finish(); for (const handle of handles) await handle.stopAndJoin(); await rm(root, { recursive: true, force: true }); });
  return { root, stateRoot, accountRoot, accountHome, parent, options, system, request, launchInput, launch, launcher, owned, spawns, signals, writes, native, stdin, stdout, stderr,
    inspections: () => inspections, finish, exitRoot, closeStreams, closedStreams, emitClose, setGroupPresent(value: boolean) { groupPresent = value; } };
}
function joined(receipt: ReturnType<CodexManagedOwnedProcess["receipt"]>) {
  expect(receipt).toMatchObject({ phase: "closed", rootExited: true, groupAbsent: true, stdioJoined: true, lockReleased: true, scratchRetained: false, cleanupErrors: [], productionQualified: false, network: "denied" });
}
async function unavailable(handle: CodexManagedOwnedProcess) { await expect(handle.ready).rejects.toThrow("CODEX_MANAGED_PROCESS_UNAVAILABLE"); return handle.stopAndJoin(); }

test("launches only an immutable snapshot with fixed offline argv/environment and preserves persistent account state", async () => {
  const f = await fixture(); await f.owned(async request => {
    const handle = await f.launch(request); await handle.ready; const spawn = f.spawns[0]!, snapshot = spawn.args[2]!;
    expect(spawn.executable).toBe("/usr/bin/sandbox-exec"); expect(spawn.args.slice(3)).toEqual(["app-server", "--strict-config", "--listen", "stdio://"]);
    expect(spawn.detached).toBe(true); expect(spawn.stdio).toEqual(["pipe", "pipe", "pipe"]);
    expect(Object.keys(spawn.env).sort()).toEqual(["CODEX_HOME", "CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED", "HOME", "NO_COLOR", "PATH", "TMPDIR"]);
    expect(spawn.env.CODEX_HOME).toBe(f.accountHome); expect(spawn.cwd).toBe(handle.cwd); expect(await readdir(spawn.cwd)).toEqual([]); expect(await readdir(spawn.env.HOME!)).toEqual([]);
    expect(snapshot.startsWith(dirname(handle.cwd) + "/")).toBe(false); expect(snapshot.startsWith(f.accountHome + "/")).toBe(false);
    expect(await readFile(snapshot, "utf8")).toBe(executableBytes); expect((await lstat(snapshot)).mode & 0o777).toBe(0o500);
    expect(handle.receipt().binding.accountLease).toBe(request.accountLease); expect(handle.receipt().binding.runtime.runtimeDigest).toBe(runtimeDigest);
    expect(handle.receipt().runtimeSnapshotSha256).toBe(sha(executableBytes)); expect(handle.receipt().scratchContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    const profile = await readFile(spawn.args[1]!, "utf8"); expect(profile).toContain("(deny default)"); expect(profile).not.toMatch(/\(allow (?:network|mach|process-fork)/u); expect(profile).not.toContain(f.options.runtime.executablePath);
    expect(handle.receipt().profileSha256).toBe(sha(profile));
    await new Promise<void>((done, reject) => handle.stdin.write("synthetic frame\n", error => error ? reject(error) : done())); expect(f.writes).toEqual(["synthetic frame\n"]);
    joined(await handle.stopAndJoin()); expect(await readFile(join(f.accountHome, "synthetic-preserved-state"), "utf8")).toBe("opaque synthetic persistent bytes");
    expect(await readFile(join(f.accountHome, "config.toml"), "utf8")).toBe(codexManagedAccountConfiguration()); expect((await readdir(f.accountRoot)).sort()).toEqual(["codex-home", "owner.json"]);
    const journal = await readFile(handle.receipt().custodyPath, "utf8"); expect(journal).not.toContain(request.prompt); expect(journal).not.toContain("opaque synthetic persistent bytes");
    let previous: string | null = null, sequence = 0; for (const line of journal.trimEnd().split("\n")) { const row = JSON.parse(line); expect(row.sequence).toBe(sequence++); expect(row.previousSha256).toBe(previous); previous = sha(line + "\n"); }
  });
});

test("durable launch-pending record precedes spawn and lock removal follows terminal process proof", async () => {
  let pending: any;
  const f = await fixture({ onSpawn(request) { const lock = JSON.parse(readFileSync(join(dirname(request.env.CODEX_HOME!), "active.json"), "utf8")); pending = JSON.parse(readFileSync(lock.journalPath, "utf8").trimEnd().split("\n").at(-1)!); } });
  await f.owned(async request => { const handle = await f.launch(request); await handle.ready;
    expect(pending.snapshot).toMatchObject({ phase: "launch-pending", launchAttempted: true, pid: null, pgid: null, lockReleased: false });
    expect(pending.snapshot.binding.accountLease).toEqual(request.accountLease); joined(await handle.stopAndJoin());
    const final = JSON.parse((await readFile(handle.receipt().custodyPath, "utf8")).trimEnd().split("\n").at(-1)!);
    expect(final.snapshot).toMatchObject({ phase: "closed", rootExited: true, groupAbsent: true, stdioJoined: true, lockReleased: true });
    expect(await readdir(f.accountRoot)).not.toContain("active.json");
  });
});

test("requires real runtime lease authority and exact convenience bindings before any host effects", async () => {
  const f = await fixture(); expect(() => f.launcher.launch(f.launchInput(f.request))).toThrow("TASK_ACCOUNT_LEASE_UNTRUSTED");
  await f.owned(async request => {
    for (const changes of [{ accountId: "foreign" }, { runId: "foreign" }, { workspaceId: "foreign" }, { accountLease: { ...request.accountLease } }]) {
      expect(() => f.launcher.launch({ ...f.launchInput(request), ...changes })).toThrow("CODEX_MANAGED_PROCESS_BINDING_MISMATCH");
    }
    expect(() => f.launcher.launch(f.launchInput({ ...request, accountLease: { ...request.accountLease } }))).toThrow("TASK_ACCOUNT_LEASE_UNTRUSTED");
    expect(() => f.launcher.launch(f.launchInput({ ...request, signal: new AbortController().signal }))).toThrow("TASK_ACCOUNT_LEASE_BINDING_MISMATCH");
  }); expect(f.inspections()).toBe(0); expect(await readdir(join(f.stateRoot, "runs"))).toEqual([]);
});

test("closed descriptor admission rejects accessors and extra policy/network options without evaluating them", async () => {
  const f = await fixture(); let getters = 0;
  const runtime = Object.defineProperty({ ...f.options.runtime }, "executablePath", { enumerable: true, get() { getters++; return f.options.runtime.executablePath; } });
  expect(() => createCodexManagedProcessLauncher({ ...f.options, runtime }, f.system)).toThrow("ACCESSOR_DENIED");
  expect(() => createCodexManagedProcessLauncher({ ...f.options, network: "enabled" } as CodexManagedProcessOptions, f.system)).toThrow("UNKNOWN_FIELD");
  await f.owned(async request => { const input = Object.defineProperty(f.launchInput(request), "request", { enumerable: true, get() { getters++; return request; } }); expect(() => f.launcher.launch(input)).toThrow("ACCESSOR_DENIED"); });
  expect(getters).toBe(0); expect(f.inspections()).toBe(0);
});

test.each(["nativeSha256", "schemaSha256", "parentSha256", "profile"] as const)("rejects mismatched trusted admission %s", async field => {
  const f = await fixture(); const admission = { ...f.options.admission, [field]: field === "profile" ? "device-code" : sha("foreign") };
  expect(() => createCodexManagedProcessLauncher({ ...f.options, admission } as CodexManagedProcessOptions, f.system)).toThrow("ADMISSION_MISMATCH"); expect(f.inspections()).toBe(0);
});

test("adapter runtime digest is explicitly mapped, not inferred from the native executable SHA", async () => {
  const f = await fixture(), launcher = createCodexManagedProcessLauncher({ ...f.options, admission: { ...f.options.admission, taskRuntimeDigest: f.options.runtime.sha256 } }, f.system);
  await f.owned(async request => { expect(() => launcher.launch(f.launchInput(request))).toThrow("RUNTIME_MAPPING_MISMATCH"); }); expect(f.inspections()).toBe(0);
});

test("configuration drift fails before effects instead of replacing persistent configuration", async () => {
  const f = await fixture(); await f.owned(async request => { expect(() => f.launcher.launch({ ...f.launchInput(request), configuration: codexManagedAccountConfiguration() + "\nmodel=\"other\"\n" })).toThrow("CONFIGURATION_MISMATCH"); }); expect(f.inspections()).toBe(0);
});

test("runtime admission is copied before asynchronous preparation", async () => {
  const gate = deferred<CodexHostRuntime>(), inspected = deferred<void>(), f = await fixture({ parent: gate.promise, onInspect: () => inspected.resolve() });
  await f.owned(async request => { const handle = await f.launch(request); await inspected.promise;
    (f.options.runtime as { sha256: string }).sha256 = sha("changed"); (f.options.admission as { taskRuntimeDigest: string }).taskRuntimeDigest = sha("changed");
    gate.resolve(f.parent); await handle.ready; expect(handle.receipt().executableSha256).toBe(sha(executableBytes)); joined(await handle.stopAndJoin());
  });
});

test("request mutations during preparation are revalidated before any native launch", async () => {
  const gate = deferred<CodexHostRuntime>(), inspected = deferred<void>(), f = await fixture({ parent: gate.promise, onInspect: () => inspected.resolve() });
  await f.owned(async request => { const copy = { ...request, model: { ...request.model } }, handle = await f.launch(copy); await inspected.promise;
    copy.model.id = "changed-after-admission"; gate.resolve(f.parent); joined(await unavailable(handle)); expect(f.spawns).toHaveLength(0);
  });
});

test("same admitted run cannot launch twice or overwrite its first process", async () => {
  const f = await fixture(); await f.owned(async request => { const first = await f.launch(request); await first.ready;
    expect(() => f.launcher.launch(f.launchInput({ ...request }))).toThrow("DUPLICATE_RUN"); expect(f.signals).toEqual([]); expect(f.spawns).toHaveLength(1); joined(await first.stopAndJoin());
  });
});

test("another launcher instance conflicts with the account lock without aborting the first process", async () => {
  const f = await fixture(); await f.owned(async request => { const first = await f.launch(request); await first.ready;
    const before = await readFile(join(f.accountRoot, "active.json"), "utf8"), other = createCodexManagedProcessLauncher(f.options, f.system), contender = await f.launch(request, undefined, other);
    joined(await unavailable(contender)); expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toBe(before); expect(f.spawns).toHaveLength(1); expect(f.signals).toEqual([]); joined(await first.stopAndJoin());
  });
});

test("an existing account-helper lock prevents all account-home writes even when configuration is missing", async () => {
  const f = await fixture(), lock = JSON.stringify({ schema: "agentrouter.codex-account-lock.v1", binding: { accountId: "synthetic-account", owner: "account-helper", leaseGeneration: 1, processGeneration: 1 }, journalPath: "/synthetic-existing-journal" }) + "\n";
  await writeFile(join(f.accountRoot, "active.json"), lock, { mode: 0o600 }); await rm(join(f.accountHome, "config.toml"));
  await f.owned(async request => { joined(await unavailable(await f.launch(request))); });
  expect(await readdir(f.accountHome)).toEqual(["synthetic-preserved-state"]); expect(await readFile(join(f.accountRoot, "active.json"), "utf8")).toBe(lock); expect(f.spawns).toHaveLength(0);
});

test.each(["missing-account", "wrong-owner", "drifted-config", "symlink-config", "symlink-executable"])("preflight %s stays joinable and preserves account state", async mode => {
  const f = await fixture();
  if (mode === "missing-account") await rename(f.accountRoot, f.accountRoot + "-retained");
  if (mode === "wrong-owner") await writeFile(join(f.accountRoot, "owner.json"), "foreign-owner\n");
  if (mode === "drifted-config") await writeFile(join(f.accountHome, "config.toml"), "preserve this drift\n");
  if (mode === "symlink-config") { await rename(join(f.accountHome, "config.toml"), join(f.accountHome, "saved-config")); await symlink("saved-config", join(f.accountHome, "config.toml")); }
  if (mode === "symlink-executable") { await rename(f.options.runtime.executablePath, f.options.runtime.executablePath + "-saved"); await symlink(f.options.runtime.executablePath + "-saved", f.options.runtime.executablePath); }
  await f.owned(async request => { joined(await unavailable(await f.launch(request))); }); expect(f.spawns).toHaveLength(0);
  if (mode === "missing-account") expect(await readdir(join(f.stateRoot, "accounts"))).toEqual(["synthetic-account-retained"]);
  if (mode === "drifted-config") expect(await readFile(join(f.accountHome, "config.toml"), "utf8")).toBe("preserve this drift\n");
});

test("cancellation immediately after launch returns a joinable handle and prevents deferred native effects", async () => {
  const f = await fixture(); await f.owned(async request => { const cancel = new AbortController(), launched = f.launch(request, cancel.signal); cancel.abort(); const handle = await launched;
    joined(await unavailable(handle)); expect(f.spawns).toHaveLength(0); expect(f.inspections()).toBe(0);
  });
});

test("cancellation independently closes native custody and makes input unavailable", async () => {
  const f = await fixture(); await f.owned(async request => { const cancel = new AbortController(), handle = await f.launch(request, cancel.signal); await handle.ready; cancel.abort();
    const error = await new Promise<Error | null | undefined>(done => handle.stdin.write("must not reach native", done)); expect(error?.message).toContain("STDIN_UNAVAILABLE");
    joined(await handle.stopAndJoin()); expect(f.writes).toEqual([]);
  });
});

test("stop retains authority after runtime request registration retires", async () => {
  const f = await fixture(); let handle!: CodexManagedOwnedProcess;
  await f.owned(async request => { handle = await f.launch(request); await handle.ready; });
  joined(await handle.stopAndJoin()); expect(f.signals).toContain("SIGTERM");
});

test("uncertain spawn throw preserves pending journal and lock instead of claiming no launch", async () => {
  const f = await fixture({ onSpawn() { throw new Error("uncertain trusted spawn failure"); } }); await f.owned(async request => {
    const handle = await f.launch(request), stopped = await unavailable(handle); expect(stopped).toMatchObject({ phase: "recovery-required", launchAttempted: true, lockReleased: false, rootExited: false, stdioJoined: false });
    expect(stopped.cleanupErrors).toEqual(["cleanup-unproven"]); expect(await readdir(f.accountRoot)).toContain("active.json"); expect(f.signals).toEqual([]);
  });
});

test("actual no-PID spawn error plus child and descriptor close can prove cleanup", async () => {
  const f = await fixture({ spawnFails: true }); await f.owned(async request => { joined(await unavailable(await f.launch(request))); }); expect(f.signals).toEqual([]);
});

test("root exit with a still-present group never sends destructive signals and retains the lock", async () => {
  const f = await fixture({ stop: "hold" }); await f.owned(async request => { const handle = await f.launch(request); await handle.ready; f.exitRoot(); f.closeStreams(); f.emitClose();
    const stopped = await handle.stopAndJoin(); expect(stopped).toMatchObject({ rootExited: true, groupAbsent: false, lockReleased: false, phase: "recovery-required" }); expect(f.signals.every(signal => signal === 0)).toBe(true);
    f.setGroupPresent(false); joined(await handle.stopAndJoin()); expect(f.signals.every(signal => signal === 0)).toBe(true);
  });
});

test("native child close without all three descriptor close events retains custody until they actually join", async () => {
  const f = await fixture({ stop: "root-and-close", maxCleanupMs: 30 }); await f.owned(async request => {
    const handle = await f.launch(request); await handle.ready;
    const publicClosed = Promise.all([new Promise<void>(done => handle.stdin.once("close", done)), new Promise<void>(done => handle.stdout.once("end", done))]);
    const first = await handle.stopAndJoin(); expect(first).toMatchObject({ rootExited: true, groupAbsent: true, stdioJoined: false, lockReleased: false });
    f.closeStreams(); await f.closedStreams;
    // Late observation may finish cleanup, without restarting a native wait budget.
    const retry = await handle.stopAndJoin(); if (retry.phase !== "closed") { await publicClosed; joined(await handle.stopAndJoin()); } else joined(retry);
  });
});

test("cleanup reentry shares one promise before any trusted signal callback", async () => {
  const f = await fixture(); let handle!: CodexManagedOwnedProcess, reentered: Promise<unknown> | undefined;
  const host = { ...f.system, signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL" | 0) { if (signal === "SIGTERM") reentered = handle.stopAndJoin(); return f.system.signalGroup(pgid, signal); } };
  const launcher = createCodexManagedProcessLauncher(f.options, host); await f.owned(async request => { handle = await f.launch(request, undefined, launcher); await handle.ready;
    const stop = handle.stopAndJoin(); joined(await stop); expect(reentered).toBe(stop); expect(f.signals.filter(signal => signal === "SIGTERM")).toHaveLength(1);
  });
});

test("release-directory sync retry preserves a replacement lock and persists truthful final release evidence", async () => {
  const f = await fixture(); let releaseSyncs = 0;
  const launcher = createCodexManagedProcessLauncher(f.options, { ...f.system, async syncDirectory(path) {
    expect(path).toBe(f.accountRoot); if (++releaseSyncs === 1) throw Error("synthetic directory fsync failure");
    const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await fd.sync(); } finally { await fd.close(); }
  } });
  await f.owned(async request => { const handle = await f.launch(request, undefined, launcher); await handle.ready;
    const first = await handle.stopAndJoin(); expect(first).toMatchObject({ phase: "recovery-required", lockReleased: false, rootExited: true, groupAbsent: true, stdioJoined: true, cleanupErrors: ["cleanup-unproven"] });
    const replacement = "replacement owner's lock; must be preserved\n", lockPath = join(f.accountRoot, "active.json"); await writeFile(lockPath, replacement, { mode: 0o600 }); const before = await lstat(lockPath);
    joined(await handle.stopAndJoin()); expect(releaseSyncs).toBe(2); expect(await readFile(lockPath, "utf8")).toBe(replacement); expect((await lstat(lockPath)).ino).toBe(before.ino);
    expect(f.spawns).toHaveLength(1); expect(f.signals.filter(signal => signal !== 0)).toEqual(["SIGTERM"]);
    const final = JSON.parse((await readFile(handle.receipt().custodyPath, "utf8")).trimEnd().split("\n").at(-1)!); expect(final.snapshot).toMatchObject({ phase: "closed", lockReleased: true, cleanupErrors: [] });
  });
});

test("no-launch cleanup joins the forwarded input close even after public output has ended", async () => {
  const gate = deferred<CodexHostRuntime>(), inspected = deferred<void>(), f = await fixture({ parent: gate.promise, onInspect: () => inspected.resolve() });
  await f.owned(async request => { const handle = await f.launch(request); await inspected.promise;
    const entered = deferred<void>(); let finishDestroy!: (error?: Error | null) => void;
    handle.stdin._destroy = (_error, done) => { finishDestroy = done; entered.resolve(); };
    (handle.stdout as PassThrough).end(); handle.stdout.resume(); await new Promise<void>(done => handle.stdout.readableEnded ? done() : handle.stdout.once("end", done));
    gate.resolve({ ...f.parent, sha256: sha("mismatched-parent") }); await expect(handle.ready).rejects.toThrow("UNAVAILABLE");
    let settled = false; const stopped = handle.stopAndJoin().then(receipt => { settled = true; return receipt; }); await entered.promise; await Promise.resolve();
    expect(settled).toBe(false); expect(handle.stdin.closed).toBe(false); finishDestroy(); joined(await stopped); expect(handle.stdin.closed).toBe(true); expect(f.spawns).toHaveLength(0);
  });
});

test("a native input callback that has not settled cannot authorize joined custody", async () => {
  const f = await fixture({ maxCleanupMs: 30 }); let finishWrite!: (error?: Error | null) => void;
  f.stdin._write = (_chunk, _encoding, done) => { finishWrite = done; };
  await f.owned(async request => { const handle = await f.launch(request); await handle.ready;
    const writeResult = new Promise<Error | null | undefined>(done => handle.stdin.write("pending synthetic input", done));
    const stopped = await handle.stopAndJoin(); expect(stopped).toMatchObject({ phase: "recovery-required", stdioJoined: false, lockReleased: false });
    finishWrite(); await writeResult;
    const retry = await handle.stopAndJoin(); if (retry.phase !== "closed") { await new Promise<void>(done => handle.stdout.readableEnded ? done() : handle.stdout.once("end", done)); joined(await handle.stopAndJoin()); } else joined(retry);
  });
});

test("overflowing native stderr triggers joined cleanup without exposing its contents", async () => {
  const f = await fixture(); await f.owned(async request => { const handle = await f.launch(request); await handle.ready;
    f.stderr.write(Buffer.alloc(256 * 1024 + 1, 120)); joined(await handle.stopAndJoin()); expect(handle.receipt().runtimeErrors).toContain("stderr-bound"); expect(JSON.stringify(handle.receipt())).not.toContain("xxxx");
  });
});

test("process execution deadline initiates cleanup without a session stop call", async () => {
  const f = await fixture({ maxRunMs: 1000, maxCleanupMs: 500 });
  // The fixture keeps runtime's admission clock fixed so only this process
  // owner's original wall-clock deadline, not runtime's outer timer, fires.
  const began = Date.now(); await withTaskLease(f.request, createCapabilityProfile({ id: "synthetic-process", version: 1, tools: [] }), async request => {
    const handle = await f.launch(request); await handle.ready; await handle.exited; joined(await handle.stopAndJoin()); expect(Date.now()).toBeGreaterThanOrEqual(request.executionDeadlineUnixMs);
  }, () => began);
});

test("policy rejects overlapping writable roots and any injected path syntax", () => {
  expect(() => codexManagedOfflineSandbox({ executable: "/safe/runtime/codex", scratch: "/safe/state", accountHome: "/safe/state/account" })).toThrow("LAYOUT_INVALID");
  expect(() => codexManagedOfflineSandbox({ executable: "/safe/runtime/codex", scratch: "/safe/scratch\"", accountHome: "/safe/account" })).toThrow("PATH_INVALID");
});
