import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fsyncSync, openSync, writeSync, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, realpath, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { CodexAccountBinding } from "./codex-account.ts";
import type { CodexAccountProcessCloseReceipt, CodexAccountProcessPort } from "./codex-account-transport.ts";
import { inspectCodexHostExecutable, inspectCodexHostRuntime, type CodexHostRuntime, type CodexParentRuntimeBinding } from "./codex-host.ts";
import { identifier, safeInteger } from "./validation.ts";
import { codexManagedAccountConfiguration as codexAccountOfflineConfiguration } from "./codex-managed-baseline.ts";
export { codexManagedAccountConfiguration as codexAccountOfflineConfiguration } from "./codex-managed-baseline.ts";

/** Trusted distribution inputs. A supplied hash is checked, never self-admitted
 * as provenance, configuration/schema compatibility, or OAuth qualification. */
export type CodexAccountRuntimeAdmission = Readonly<{
  executablePath: string; version: string; sha256: string; schemaSha256: string;
  parentRuntime: CodexParentRuntimeBinding;
}>;
/** Supplied only by the trusted host after reviewing this candidate profile for
 * these distribution pins. JSON shape/pin matching is not provenance, a native
 * network proof, or permission for model execution. Never load from owner JSON. */
export type CodexAccountDeviceCodeAdmission = Readonly<{
  profile: "codex-account-device-code-tcp443-dns-v1";
  nativeSha256: string; schemaSha256: string; parentSha256: string;
}>;
export type CodexAccountProcessOptions = Readonly<{
  binding: CodexAccountBinding; stateRoot: string; runtime: CodexAccountRuntimeAdmission;
  startupTimeoutMs?: number;
} & ({ mode: "offline"; deviceCodeAdmission?: never }
  | { mode: "device-code"; deviceCodeAdmission: CodexAccountDeviceCodeAdmission })>;
export type CodexAccountSpawn = Readonly<{
  executable: "/usr/bin/sandbox-exec"; args: readonly string[]; cwd: string;
  env: Readonly<Record<string, string>>; detached: true; stdio: readonly ["pipe", "pipe", "pipe"];
}>;
/** Trusted system seam for synthetic process tests. This is not a plugin, agent
 * tool, configuration input, or substitute for native runtime qualification. */
export interface CodexAccountProcessSystem {
  inspectParent(binding: CodexParentRuntimeBinding): Promise<CodexHostRuntime>;
  spawn(request: CodexAccountSpawn): ChildProcessWithoutNullStreams;
  processGroup(pid: number): number | null;
  signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL" | 0): boolean;
}
export type CodexAccountProcessReceipt = Readonly<{
  schema: "agentrouter.codex-account-process.v1"; binding: CodexAccountBinding;
  productionQualified: false; network: "denied" | "tcp443-system-resolver-candidate"; nativeVersion: string;
  nativeSha256: string; schemaSha256: string; parentSha256: string;
  configurationSha256: string; profileSha256: string | null;
  journalPath: string | null; launchAttempted: boolean; pid: number | null; pgid: number | null;
  rootExited: boolean; groupAbsent: boolean; stdoutJoined: boolean; stderrJoined: boolean;
  lockReleased: boolean; scratchRetained: boolean; phase: "preparing" | "launch-pending" | "running" | "recovery-required" | "closed";
  failures: readonly string[];
}>;
export interface CodexAccountOwnedProcessPort extends CodexAccountProcessPort { receipt(): CodexAccountProcessReceipt }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fail = (code: string): never => { throw new Error(code); };
const assert = (value: unknown, code: string): void => { if (!value) fail(code); };
const digest = (value: unknown): string => { assert(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "CODEX_ACCOUNT_PROCESS_PIN_INVALID"); return value as string; };
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "CODEX_ACCOUNT_PROCESS_OBJECT_INVALID");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value as object)) {
    assert(typeof key === "string" && keys.includes(key), "CODEX_ACCOUNT_PROCESS_UNKNOWN_FIELD");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    assert("value" in descriptor, "CODEX_ACCOUNT_PROCESS_ACCESSOR_DENIED"); result[key as string] = descriptor.value;
  }
  return result;
}
function path(value: unknown): string {
  assert(typeof value === "string" && isAbsolute(value) && resolve(value) === value && value.length <= 4096 && !/[\x00-\x1f\x7f"\\]/u.test(value), "CODEX_ACCOUNT_PROCESS_PATH_INVALID");
  return value as string;
}
function binding(value: CodexAccountBinding): CodexAccountBinding {
  const raw = object(value, ["accountId", "owner", "leaseGeneration", "processGeneration"]);
  return Object.freeze({ accountId: identifier(raw.accountId), owner: identifier(raw.owner), leaseGeneration: safeInteger(raw.leaseGeneration, 1, Number.MAX_SAFE_INTEGER), processGeneration: safeInteger(raw.processGeneration, 1, Number.MAX_SAFE_INTEGER) });
}
const same = (a: CodexAccountBinding, b: CodexAccountBinding) => a.accountId === b.accountId && a.owner === b.owner && a.leaseGeneration === b.leaseGeneration && a.processGeneration === b.processGeneration;
const system: CodexAccountProcessSystem = {
  inspectParent: inspectCodexHostRuntime,
  spawn: request => spawn(request.executable, [...request.args], { cwd: request.cwd, env: { ...request.env }, detached: true, stdio: ["pipe", "pipe", "pipe"] }),
  processGroup(pid) {
    const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], { encoding: "utf8", timeout: 1_000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin" } });
    return !result.error && result.status === 0 && /^[1-9][0-9]*$/u.test(result.stdout.trim()) ? Number(result.stdout.trim()) : null;
  },
  signalGroup(pgid, signal) { try { process.kill(-pgid, signal); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } },
};

/** No network, Mach exceptions, fork, helper commands, or contact paths. This
 * candidate profile is deliberately insufficient for a real OAuth flow. */
export function codexAccountOfflineSandbox(input: { executable: string; scratch: string; accountHome: string }): string {
  const executable = path(input.executable), scratch = path(input.scratch), accountHome = path(input.accountHome);
  assert(executable !== scratch && !executable.startsWith(scratch + "/") && executable !== accountHome && !executable.startsWith(accountHome + "/") && scratch !== accountHome && !scratch.startsWith(accountHome + "/") && !accountHome.startsWith(scratch + "/"), "CODEX_ACCOUNT_PROCESS_LAYOUT_INVALID");
  const q = JSON.stringify;
  return `(version 1)\n(deny default)\n(allow process-exec (literal ${q(executable)}))
(allow file-read* (literal ${q(executable)}) (subpath "/System/Library") (subpath "/usr/lib") (subpath "/Library/Apple/System/Library") (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (literal "/dev/null"))
(allow file-read-data file-write-data (literal "/dev/fd/0") (literal "/dev/fd/1") (literal "/dev/fd/2"))
(allow file-map-executable (literal ${q(executable)}) (subpath "/System/Library") (subpath "/usr/lib") (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read* (literal "/") (path-ancestors "/System/Cryptexes/OS") (path-ancestors "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read-metadata (path-ancestors ${q(executable)}) (path-ancestors ${q(scratch)}) (path-ancestors ${q(accountHome)}))
(allow file-read* file-write* (subpath ${q(scratch)}) (subpath ${q(accountHome)}))
(allow file-read-data file-read-metadata (literal "/etc/codex/requirements.toml") (literal "/private/etc/codex/requirements.toml"))
(allow file-read-metadata (path-ancestors "/etc/codex/requirements.toml") (path-ancestors "/private/etc/codex/requirements.toml"))
(allow sysctl-read)\n(allow process-info* (target self))\n(allow signal (target self))\n`;
}
/** Candidate for a trusted account-only device-code helper, never an agent.
 * Apple ships this resolver socket/TCP port syntax in cloudpaird.sb. Port 443
 * is not HTTPS or hostname confinement: native Codex owns TLS and destinations.
 * No new Mach access, direct DNS sockets, inbound listeners, forks or files.
 * Generating this string does not admit its use by the process owner. */
export function codexAccountDeviceCodeSandbox(input: { executable: string; scratch: string; accountHome: string }): string {
  return codexAccountOfflineSandbox(input)
    + '(allow network-outbound (literal "/private/var/run/mDNSResponder") (remote tcp "*:443"))\n';
}
async function directory(value: string): Promise<BigIntStats> {
  const metadata = await lstat(value, { bigint: true });
  assert(await realpath(value) === value && metadata.isDirectory() && metadata.uid === BigInt(process.getuid!()) && (metadata.mode & 0o7777n) === 0o700n, "CODEX_ACCOUNT_PROCESS_PRIVATE_DIRECTORY_REQUIRED");
  return metadata;
}
async function syncDirectory(value: string): Promise<void> {
  const fd = await open(value, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function ensureDirectory(value: string): Promise<void> { try { await mkdir(value, { mode: 0o700 }); await syncDirectory(dirname(value)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } await directory(value); }
async function durableFile(value: string, contents: string): Promise<void> {
  const fd = await open(value, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(contents); await fd.sync(); } finally { await fd.close(); }
  await syncDirectory(dirname(value));
}
async function fixedFile(value: string, contents: string, create: boolean): Promise<void> {
  if (create) try { await durableFile(value, contents); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const fd = await open(value, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    assert(before.isFile() && before.uid === BigInt(process.getuid!()) && before.nlink === 1n && (before.mode & 0o7777n) === 0o600n && before.size === BigInt(Buffer.byteLength(contents)), "CODEX_ACCOUNT_PROCESS_CONFIG_INVALID");
    const read = Buffer.alloc(Buffer.byteLength(contents) + 1), result = await fd.read(read, 0, read.length, 0);
    const after = await fd.stat({ bigint: true }), named = await lstat(value, { bigint: true });
    assert(result.bytesRead === read.length - 1 && read.subarray(0, result.bytesRead).equals(Buffer.from(contents)) && sameFile(before, after) && sameFile(before, named), "CODEX_ACCOUNT_PROCESS_CONFIG_CHANGED");
  } finally { await fd.close(); }
}
function sameFile(a: BigIntStats, b: BigIntStats): boolean { return ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"].every(key => a[key as keyof BigIntStats] === b[key as keyof BigIntStats]); }
async function bounded<T>(promise: Promise<T>, deadlineMs: number): Promise<T> {
  const remaining = deadlineMs - Date.now(); if (remaining <= 0) return fail("CODEX_ACCOUNT_PROCESS_DEADLINE");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CODEX_ACCOUNT_PROCESS_DEADLINE")), remaining); })]); }
  finally { clearTimeout(timer); }
}

/** Synchronous custody handle, deferred native launch. Offline is the existing
 * mode; device-code networking requires separate explicit trusted admission.
 * Pair only with the account-only transport, never a thread/turn client. Callers must
 * already own the matching account lease. No provider credentials are inspected.
 * A stale lock is a recovery requirement, never permission to take over. */
export function createCodexAccountProcess(options: CodexAccountProcessOptions, trustedSystem: CodexAccountProcessSystem = system): CodexAccountOwnedProcessPort {
  const raw = object(options, ["binding", "stateRoot", "runtime", "mode", "startupTimeoutMs", "deviceCodeAdmission"]), owned = binding(raw.binding as CodexAccountBinding);
  assert(raw.mode === "offline" || raw.mode === "device-code", "CODEX_ACCOUNT_PROCESS_OFFLINE_REQUIRED");
  const stateRoot = path(raw.stateRoot), admission = object(raw.runtime, ["executablePath", "version", "sha256", "schemaSha256", "parentRuntime"]);
  const parentRaw = object(admission.parentRuntime, ["expectedSha256"]), parentRuntime = Object.freeze({ expectedSha256: digest(parentRaw.expectedSha256) });
  const runtime = Object.freeze({ executablePath: path(admission.executablePath), version: identifier(admission.version), sha256: digest(admission.sha256), schemaSha256: digest(admission.schemaSha256), parentRuntime });
  const deviceCode = raw.mode === "device-code";
  if (deviceCode) {
    const network = object(raw.deviceCodeAdmission, ["profile", "nativeSha256", "schemaSha256", "parentSha256"]);
    assert(network.profile === "codex-account-device-code-tcp443-dns-v1" && digest(network.nativeSha256) === runtime.sha256
      && digest(network.schemaSha256) === runtime.schemaSha256 && digest(network.parentSha256) === runtime.parentRuntime.expectedSha256, "CODEX_ACCOUNT_PROCESS_NETWORK_ADMISSION_MISMATCH");
  } else assert(!Object.hasOwn(raw, "deviceCodeAdmission"), "CODEX_ACCOUNT_PROCESS_NETWORK_ADMISSION_UNEXPECTED");
  const startupMs = safeInteger(raw.startupTimeoutMs ?? 10_000, 1, 120_000), startupDeadline = Date.now() + startupMs;
  const host = Object.freeze({ inspectParent: trustedSystem.inspectParent.bind(trustedSystem), spawn: trustedSystem.spawn.bind(trustedSystem), processGroup: trustedSystem.processGroup.bind(trustedSystem), signalGroup: trustedSystem.signalGroup.bind(trustedSystem) });
  const configuration = codexAccountOfflineConfiguration();
  const failures = new Set<string>();
  const state = { phase: "preparing" as CodexAccountProcessReceipt["phase"], launchAttempted: false, pid: null as number | null, pgid: null as number | null, rootExited: false, groupAbsent: false, stdoutJoined: false, stderrJoined: false, lockReleased: false, scratchRetained: false, profileSha256: null as string | null, journalPath: null as string | null };
  let child: ChildProcessWithoutNullStreams | undefined, root: string | undefined, scratch: string | undefined, runtimeRoot: string | undefined, lockPath: string | undefined, lockContents = "", scratchIdentity: BigIntStats | undefined, runtimeIdentity: BigIntStats | undefined;
  let lockOwned = false, journalFd: number | undefined, journalFailed = false, previous: string | null = null, sequence = 0;
  let closedEvent = false, nativeStdoutClosed = false, nativeStderrClosed = false, nativeStdinClosed = false, spawnEvent = false, spawnError = false, closing = false, stopTask: Promise<CodexAccountProcessCloseReceipt> | undefined;
  let resolveExit!: () => void, resolveClosed!: () => void;
  const exited = new Promise<void>(done => { resolveExit = done; }), nativeClosed = new Promise<void>(done => { resolveClosed = done; });
  const nativeStreamClosures: Promise<void>[] = [];
  const stdout = new PassThrough(), stderr = new PassThrough(); stdout.on("error", () => {}); stderr.on("error", () => {});
  const stdin = new Writable({ write(chunk: Buffer, _encoding, done) {
    if (!child || closing || state.phase !== "running") { done(new Error("CODEX_ACCOUNT_PROCESS_STDIN_UNAVAILABLE")); return; }
    try { child.stdin.write(chunk, done); } catch { done(new Error("CODEX_ACCOUNT_PROCESS_STDIN_FAILED")); }
  } }); stdin.on("error", () => {});
  const receipt = (): CodexAccountProcessReceipt => Object.freeze({ schema: "agentrouter.codex-account-process.v1", binding: owned, productionQualified: false, network: deviceCode ? "tcp443-system-resolver-candidate" : "denied", nativeVersion: runtime.version,
    nativeSha256: runtime.sha256, schemaSha256: runtime.schemaSha256, parentSha256: runtime.parentRuntime.expectedSha256, configurationSha256: hash(configuration), ...state, failures: Object.freeze([...failures]) });
  function recordFailure(code: string) { if (failures.size < 24) failures.add(code); }
  function persist() {
    const fd = journalFd;
    if (fd === undefined || journalFailed || sequence >= 32) { journalFailed = true; throw new Error("CODEX_ACCOUNT_PROCESS_JOURNAL_FAILED"); }
    const line = JSON.stringify({ sequence, previousSha256: previous, snapshot: receipt() }) + "\n";
    try { const bytes = Buffer.from(line); assert(bytes.length <= 8192, "CODEX_ACCOUNT_PROCESS_JOURNAL_BOUND"); let offset = 0;
      while (offset < bytes.length) { const count = writeSync(fd, bytes, offset, bytes.length - offset); assert(count > 0, "CODEX_ACCOUNT_PROCESS_JOURNAL_FAILED"); offset += count; }
      fsyncSync(fd); previous = hash(line); sequence++;
    } catch { journalFailed = true; fail("CODEX_ACCOUNT_PROCESS_JOURNAL_FAILED"); }
  }
  function alivePreparation() { assert(!closing && Date.now() < startupDeadline, "CODEX_ACCOUNT_PROCESS_START_CANCELLED"); }
  const preparation = Promise.resolve().then(async () => {
    alivePreparation(); await directory(stateRoot); const parent = await host.inspectParent(parentRuntime);
    assert(parent.sha256 === parentRuntime.expectedSha256 && parent.platform === "darwin" && parent.arch === "arm64" && parent.version === "1.3.14", "CODEX_ACCOUNT_PROCESS_PARENT_MISMATCH"); alivePreparation();
    await inspectCodexHostExecutable(runtime.executablePath, runtime.sha256); alivePreparation();
    const accounts = join(stateRoot, "accounts"), runs = join(stateRoot, "runs"); await ensureDirectory(accounts); await ensureDirectory(runs);
    const accountRoot = join(accounts, owned.accountId); let created = false;
    try { await mkdir(accountRoot, { mode: 0o700 }); created = true; await syncDirectory(accounts); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await directory(accountRoot);
    await fixedFile(join(accountRoot, "owner.json"), JSON.stringify({ schema: "agentrouter.codex-account-home.v1", accountId: owned.accountId }) + "\n", created);
    root = join(runs, `${owned.owner}-${owned.processGeneration}-${randomBytes(12).toString("hex")}`); await mkdir(root, { mode: 0o700 });
    await syncDirectory(runs);
    state.journalPath = join(root, "custody.jsonl"); journalFd = openSync(state.journalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fsyncSync(journalFd); await syncDirectory(root);
    lockPath = join(accountRoot, "active.json"); lockContents = JSON.stringify({ schema: "agentrouter.codex-account-lock.v1", binding: owned, journalPath: state.journalPath }) + "\n";
    // Mark ownership as soon as the exclusive create succeeds, including a
    // failed fsync: that uncertainty must never erase somebody else's lock.
    const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); lockOwned = true;
    try { await lock.writeFile(lockContents); await lock.sync(); } finally { await lock.close(); }
    await syncDirectory(accountRoot);
    persist();
    // Native-home writes are admitted only by this exact durable lock, even
    // when an outer account lease already serialized the intended caller.
    const accountHome = join(accountRoot, "codex-home"); await ensureDirectory(accountHome);
    await fixedFile(join(accountHome, "config.toml"), configuration, true); alivePreparation();
    scratch = join(root, "scratch"); runtimeRoot = join(root, "runtime"); await mkdir(scratch, { mode: 0o700 }); state.scratchRetained = true; scratchIdentity = await directory(scratch);
    await mkdir(runtimeRoot, { mode: 0o700 }); runtimeIdentity = await directory(runtimeRoot); for (const name of ["home", "tmp", "work"]) await mkdir(join(scratch, name), { mode: 0o700 });
    const executable = join(runtimeRoot, "codex");
    // Copy through one no-follow descriptor, then independently verify the exact
    // immutable destination bytes before it can be executed.
    const source = await open(runtime.executablePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const before = await source.stat({ bigint: true }); assert(before.isFile() && before.size > 0n && before.size <= 256n * 1024n * 1024n, "CODEX_ACCOUNT_PROCESS_EXECUTABLE_INVALID");
      const target = await open(executable, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o500);
      try {
        const buffer = Buffer.alloc(64 * 1024), copiedHash = createHash("sha256"); let copied = 0;
        while (copied <= Number(before.size)) {
          const count = (await source.read(buffer, 0, Math.min(buffer.length, Number(before.size) + 1 - copied), copied)).bytesRead;
          if (!count) break;
          copied += count; assert(copied <= Number(before.size), "CODEX_ACCOUNT_PROCESS_EXECUTABLE_CHANGED");
          copiedHash.update(buffer.subarray(0, count)); await target.writeFile(buffer.subarray(0, count));
        }
        assert(copied === Number(before.size) && sameFile(before, await source.stat({ bigint: true })) && sameFile(before, await lstat(runtime.executablePath, { bigint: true })) && await realpath(runtime.executablePath) === runtime.executablePath && copiedHash.digest("hex") === runtime.sha256, "CODEX_ACCOUNT_PROCESS_EXECUTABLE_CHANGED");
        await target.sync();
      } finally { await target.close(); }
    } finally { await source.close(); }
    await inspectCodexHostExecutable(executable, runtime.sha256);
    const profile = (deviceCode ? codexAccountDeviceCodeSandbox : codexAccountOfflineSandbox)({ executable, scratch, accountHome }); state.profileSha256 = hash(profile);
    const profilePath = join(root, "sandbox.sb"); await durableFile(profilePath, profile); await syncDirectory(runtimeRoot);
    await fixedFile(join(accountHome, "config.toml"), configuration, false); await directory(accountHome); await directory(scratch); alivePreparation();
    alivePreparation(); state.phase = "launch-pending"; state.launchAttempted = true; persist();
    // The preceding durable record deliberately leaves the PID unknown. A
    // crash here requires independent recovery, even if no child was created.
    child = host.spawn(Object.freeze({ executable: "/usr/bin/sandbox-exec", args: Object.freeze(["-f", profilePath, executable, "app-server", "--strict-config", "--listen", "stdio://"]), cwd: join(scratch, "work"),
      env: Object.freeze({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(scratch, "home"), CODEX_HOME: accountHome, TMPDIR: join(scratch, "tmp"), NO_COLOR: "1", CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" }), detached: true, stdio: Object.freeze(["pipe", "pipe", "pipe"] as const) }));
    state.pid = child.pid ?? null;
    child.once("spawn", () => { spawnEvent = true; });
    child.once("exit", () => { state.rootExited = true; resolveExit(); });
    child.once("close", () => { closedEvent = true; if (!spawnEvent && spawnError && state.pid === null) { state.rootExited = true; state.groupAbsent = true; resolveExit(); } resolveClosed(); });
    child.once("error", () => { spawnError = true; recordFailure("native-spawn"); });
    for (const [stream, mark] of [[child.stdout, () => { nativeStdoutClosed = true; }], [child.stderr, () => { nativeStderrClosed = true; }], [child.stdin, () => { nativeStdinClosed = true; }]] as const) {
      nativeStreamClosures.push(new Promise<void>(done => stream.once("close", () => { mark(); done(); })));
    }
    let stdoutBytes = 0, stderrBytes = 0;
    const streamFailure = (code: string) => { recordFailure(code); void stopAndJoin({ binding: owned, deadlineMs: Date.now() + 10_000 }).catch(() => {}); };
    child.stdout.on("data", (chunk: Buffer) => { stdoutBytes += chunk.length; if (stdoutBytes > 16 * 1024 * 1024) streamFailure("stdout-bound"); else if (!closing) stdout.write(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 256 * 1024) streamFailure("stderr-bound"); else if (!closing) stderr.write(chunk); });
    child.stdout.on("end", () => { stdout.end(); }); child.stderr.on("end", () => { stderr.end(); });
    child.stdout.on("error", () => streamFailure("native-stdout")); child.stderr.on("error", () => streamFailure("native-stderr")); child.stdin.on("error", () => streamFailure("native-stdin"));
    persist();
    assert(state.pid !== null && Number.isSafeInteger(state.pid) && state.pid > 0, "CODEX_ACCOUNT_PROCESS_PID_UNPROVEN");
    state.pgid = host.processGroup(state.pid!); assert(state.pgid === state.pid, "CODEX_ACCOUNT_PROCESS_GROUP_UNPROVEN");
    alivePreparation(); assert(!state.rootExited, "CODEX_ACCOUNT_PROCESS_PREMATURE_EXIT"); state.phase = "running"; persist();
  }).catch(error => {
    recordFailure(error instanceof Error && /^CODEX_[A-Z_]+$/u.test(error.message) ? error.message : "preparation-failed");
    if (!state.launchAttempted) { state.rootExited = true; state.groupAbsent = true; resolveExit(); }
    throw new Error("CODEX_ACCOUNT_PROCESS_PREPARATION_FAILED");
  });
  void preparation.catch(() => {});
  const ready = bounded(preparation, startupDeadline).catch(() => { recordFailure("startup-failed"); void stopAndJoin({ binding: owned, deadlineMs: Date.now() + 10_000 }).catch(() => {}); throw new Error("CODEX_ACCOUNT_PROCESS_UNAVAILABLE"); });
  void ready.catch(() => {});
  function stopAndJoin(request: { binding: CodexAccountBinding; deadlineMs: number }): Promise<CodexAccountProcessCloseReceipt> {
    const input = object(request, ["binding", "deadlineMs"]), selected = binding(input.binding as CodexAccountBinding); assert(same(selected, owned), "CODEX_ACCOUNT_PROCESS_STOP_BINDING_MISMATCH");
    const now = Date.now(), deadline = safeInteger(input.deadlineMs, now + 1, now + 120_000);
    if (stopTask !== undefined) return stopTask;
    closing = true;
    const task = Promise.resolve().then(async () => {
      try {
        await bounded(preparation.catch(() => {}), deadline);
        if (child) {
          try { child.stdin.end(); } catch { recordFailure("stdin-end"); }
          for (const signal of ["SIGTERM", "SIGKILL"] as const) {
            // An exited/reaped root no longer anchors numeric process-group
            // identity. Never signal a possibly reused group after that point.
            if (state.rootExited) {
              if (state.pgid === state.pid && state.pgid !== null) state.groupAbsent = !host.signalGroup(state.pgid, 0);
              break;
            }
            if (state.pgid !== null && state.pgid === state.pid) host.signalGroup(state.pgid, signal);
            else if (!state.rootExited) child.kill(signal);
            try { await bounded(exited, Math.min(deadline, Date.now() + 250)); } catch {}
          }
          if (state.rootExited && state.pgid === state.pid && state.pgid !== null) state.groupAbsent = !host.signalGroup(state.pgid, 0);
          await bounded(Promise.all([nativeClosed, ...nativeStreamClosures]), deadline);
          assert(closedEvent && state.rootExited && state.groupAbsent && nativeStdoutClosed && nativeStderrClosed && nativeStdinClosed, "CODEX_ACCOUNT_PROCESS_STOP_UNPROVEN");
        } else assert(!state.launchAttempted && state.rootExited, "CODEX_ACCOUNT_PROCESS_LAUNCH_UNCERTAIN");
        stdin.end(); stdout.end(); stderr.end(); stdout.resume(); stderr.resume();
        await bounded(Promise.all([new Promise<void>(done => stdout.readableEnded ? done() : stdout.once("end", done)), new Promise<void>(done => stderr.readableEnded ? done() : stderr.once("end", done))]), deadline);
        state.stdoutJoined = true; state.stderrJoined = true;
        if (lockOwned) {
          assert(!journalFailed, "CODEX_ACCOUNT_PROCESS_JOURNAL_FAILED");
          await fixedFile(lockPath!, lockContents, false);
          if (scratch && scratchIdentity) { const current = await directory(scratch); assert(current.dev === scratchIdentity.dev && current.ino === scratchIdentity.ino, "CODEX_ACCOUNT_PROCESS_SCRATCH_CHANGED"); await rm(scratch, { recursive: true }); state.scratchRetained = false; scratch = undefined; }
          if (runtimeRoot && runtimeIdentity) { const current = await directory(runtimeRoot); assert(current.dev === runtimeIdentity.dev && current.ino === runtimeIdentity.ino, "CODEX_ACCOUNT_PROCESS_RUNTIME_CHANGED"); await rm(runtimeRoot, { recursive: true }); runtimeRoot = undefined; }
          // Terminal process/stream proof must be durable before the exclusive
          // lock disappears. A crash after unlink may resurrect a stale lock,
          // which safely requires recovery; it cannot resurrect the process.
          state.phase = "closed"; persist(); await unlink(lockPath!); lockOwned = false; state.lockReleased = true;
          try { await syncDirectory(dirname(lockPath!)); } catch { recordFailure("lock-release-sync"); }
        } else state.lockReleased = !state.launchAttempted;
        state.phase = "closed";
      } catch { recordFailure("cleanup-unproven"); state.phase = "recovery-required"; if (journalFd !== undefined && !journalFailed) try { persist(); } catch {} }
      const proven = state.phase === "closed" && state.lockReleased && !journalFailed;
      if (proven && journalFd !== undefined) { closeSync(journalFd); journalFd = undefined; }
      return Object.freeze({ binding: owned, processExited: state.rootExited, processGroupStopped: proven && state.groupAbsent, stdoutEnded: state.stdoutJoined, stderrEnded: state.stderrJoined });
    });
    stopTask = task;
    void task.then(result => { if (!result.processGroupStopped && stopTask === task) stopTask = undefined; });
    return task;
  }
  return Object.freeze({ binding: owned, stdin, stdout, stderr, ready, exited, stopAndJoin, receipt });
}
