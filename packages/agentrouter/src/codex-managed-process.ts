import { Database } from "bun:sqlite";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, closeSync, fsyncSync, openSync, writeSync, type BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, opendir, realpath, rm, unlink, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { codexManagedAccountConfiguration } from "./codex-managed-baseline.ts";
import { SqliteAccountLeases, type AccountLease } from "./accounts.ts";
import { createCodexAccountProcess, type CodexAccountOwnedProcessPort } from "./codex-account-process.ts";
import { createManagedOfflineProtocol, type OfflineProtocolReceipt } from "./codex-managed-offline-protocol.ts";
import type { CodexManagedProcessLauncher } from "./codex-managed-config.ts";
import type { CodexProcessHandle, CodexProcessReceipt } from "./codex-process.ts";
import { assertCodexHostFileStable, inspectCodexHostExecutable, inspectCodexHostRuntime, type CodexHostRuntime, type CodexParentRuntimeBinding } from "./codex-host.ts";
import { assertAgentTaskAccountLease, type AgentTaskAccountLease, type AgentTaskBinding } from "./task-runtime.ts";
import { identifier, safeInteger } from "./validation.ts";

/** Trusted distribution inputs, never owner settings. The explicit mapping
 * binds an adapter runtime identity to independently admitted native artifacts;
 * matching these strings does not create qualification or schema evidence. */
type ManagedSandboxProfile = "managed-task-offline-candidate-v1" | "managed-task-provider-tcp443-dns-candidate-v1";
export type CodexManagedProcessOptions = Readonly<{
  stateRoot: string;
  runtime: Readonly<{ executablePath: string; version: string; sha256: string; schemaSha256: string; parentRuntime: CodexParentRuntimeBinding }>;
  admission: Readonly<{ profile: ManagedSandboxProfile; taskRuntimeVersion: string; taskRuntimeDigest: string;
    nativeSha256: string; schemaSha256: string; parentSha256: string }>;
  startupTimeoutMs?: number;
}>;
export type CodexManagedSpawn = Readonly<{ executable: "/usr/bin/sandbox-exec"; args: readonly string[]; cwd: string;
  env: Readonly<Record<string, string>>; detached: true; stdio: readonly ["pipe", "pipe", "pipe"] }>;
/** Synthetic host seam; never exposed through configuration, plugins or tools. */
export interface CodexManagedProcessSystem {
  inspectParent(binding: CodexParentRuntimeBinding): Promise<CodexHostRuntime>;
  spawn(request: CodexManagedSpawn): ChildProcessWithoutNullStreams;
  processGroup(pid: number): number | null;
  signalGroup(pgid: number, signal: "SIGTERM" | "SIGKILL" | 0): boolean;
  /** Host-derived release directory only; defaults to the physical fsync helper. */
  syncDirectory?(path: string): Promise<void>;
}
type CoreReceipt<B, S extends string> = CodexProcessReceipt & Readonly<{
  schema: S; binding: B; processGeneration: number;
  productionQualified: false; network: "denied" | "general-tcp443-system-resolver-var-metadata-candidate"; profile: ManagedSandboxProfile; schemaSha256: string;
  launchAttempted: boolean; lockReleased: boolean; phase: "preparing" | "launch-pending" | "running" | "release-pending" | "recovery-required" | "closed";
}>;
export type CodexManagedProcessReceipt = CoreReceipt<AgentTaskBinding, "agentrouter.codex-managed-process.v1">;
export interface CodexManagedOwnedProcess extends CodexProcessHandle { receipt(): CodexManagedProcessReceipt; stopAndJoin(): Promise<CodexManagedProcessReceipt> }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const fail = (code: string): never => { throw new Error(code); };
function check(value: unknown, code: string): asserts value { if (!value) fail(code); }
function digest(value: unknown): string { check(typeof value === "string" && /^[a-f0-9]{64}$/u.test(value), "CODEX_MANAGED_PROCESS_PIN_INVALID"); return value; }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  check(value !== null && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "CODEX_MANAGED_PROCESS_OBJECT_INVALID");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    check(typeof key === "string" && keys.includes(key), "CODEX_MANAGED_PROCESS_UNKNOWN_FIELD");
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    check("value" in descriptor && descriptor.enumerable, "CODEX_MANAGED_PROCESS_ACCESSOR_DENIED"); result[key] = descriptor.value;
  }
  return result;
}
function path(value: unknown): string {
  check(typeof value === "string" && isAbsolute(value) && resolve(value) === value && value.length <= 4096 && !/[\x00-\x1f\x7f"\\]/u.test(value), "CODEX_MANAGED_PROCESS_PATH_INVALID"); return value;
}
async function directory(value: string): Promise<BigIntStats> {
  const metadata = await lstat(value, { bigint: true });
  check(await realpath(value) === value && metadata.isDirectory() && metadata.uid === BigInt(process.getuid!()) && (metadata.mode & 0o7777n) === 0o700n, "CODEX_MANAGED_PROCESS_PRIVATE_DIRECTORY_REQUIRED"); return metadata;
}
async function syncDirectory(value: string): Promise<void> { const fd = await open(value, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await fd.sync(); } finally { await fd.close(); } }
async function durableFile(value: string, contents: string): Promise<void> {
  const fd = await open(value, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await fd.writeFile(contents); await fd.sync(); } finally { await fd.close(); } await syncDirectory(dirname(value));
}
async function fixedFile(value: string, contents: string): Promise<void> {
  const fd = await open(value, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    check(before.isFile() && before.uid === BigInt(process.getuid!()) && before.nlink === 1n && (before.mode & 0o7777n) === 0o600n && before.size === BigInt(Buffer.byteLength(contents)), "CODEX_MANAGED_PROCESS_FILE_INVALID");
    const bytes = Buffer.alloc(Buffer.byteLength(contents) + 1); let count = 0;
    while (count < bytes.length) { const part = await fd.read(bytes, count, bytes.length - count, count); if (!part.bytesRead) break; count += part.bytesRead; }
    check(count === bytes.length - 1 && bytes.subarray(0, count).equals(Buffer.from(contents)), "CODEX_MANAGED_PROCESS_FILE_CHANGED");
    assertCodexHostFileStable(before, await fd.stat({ bigint: true }), await lstat(value, { bigint: true }));
  } finally { await fd.close(); }
}
async function copyExecutable(sourcePath: string, destination: string, expectedSha256: string): Promise<void> {
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await source.stat({ bigint: true }); check(before.isFile() && before.size > 0n && before.size <= 256n * 1024n * 1024n, "CODEX_MANAGED_PROCESS_EXECUTABLE_INVALID");
    const target = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o500);
    try {
      const bytes = Buffer.alloc(64 * 1024), sha = createHash("sha256"); let count = 0;
      while (count <= Number(before.size)) {
        const part = await source.read(bytes, 0, Math.min(bytes.length, Number(before.size) + 1 - count), count); if (!part.bytesRead) break;
        count += part.bytesRead; check(count <= Number(before.size), "CODEX_MANAGED_PROCESS_EXECUTABLE_CHANGED"); sha.update(bytes.subarray(0, part.bytesRead)); await target.writeFile(bytes.subarray(0, part.bytesRead));
      }
      check(count === Number(before.size) && sha.digest("hex") === expectedSha256 && await realpath(sourcePath) === sourcePath, "CODEX_MANAGED_PROCESS_EXECUTABLE_CHANGED");
      assertCodexHostFileStable(before, await source.stat({ bigint: true }), await lstat(sourcePath, { bigint: true })); await target.sync();
    } finally { await target.close(); }
  } finally { await source.close(); }
  await inspectCodexHostExecutable(destination, expectedSha256);
}
async function inspectScratch(scratch: string): Promise<{ content: string; identity: string }> {
  const entries: { name: string; device: string; inode: string }[] = [];
  for (const name of ["", "home", "tmp", "work"]) {
    const value = name ? join(scratch, name) : scratch, metadata = await directory(value), iterator = await opendir(value, { bufferSize: 4 });
    const expected = name ? [] : ["home", "tmp", "work"], found: string[] = [];
    try { for (;;) { const entry = await iterator.read(); if (!entry) break; check(expected.includes(entry.name) && found.length < expected.length, "CODEX_MANAGED_PROCESS_SCRATCH_INVALID"); found.push(entry.name); } }
    finally { await iterator.close(); }
    check(JSON.stringify(found.sort()) === JSON.stringify(expected), "CODEX_MANAGED_PROCESS_SCRATCH_INVALID");
    const current = await directory(value); check(current.dev === metadata.dev && current.ino === metadata.ino, "CODEX_MANAGED_PROCESS_SCRATCH_CHANGED");
    entries.push({ name, device: String(metadata.dev), inode: String(metadata.ino) });
  }
  const content = hash(JSON.stringify({ schema: "agentrouter.codex-managed-scratch.v1", directories: entries.map(entry => entry.name), mode: 0o700 }));
  return { content, identity: hash(JSON.stringify({ scratch, content, entries })) };
}
async function bounded<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now(); check(remaining > 0, "CODEX_MANAGED_PROCESS_DEADLINE"); let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("CODEX_MANAGED_PROCESS_DEADLINE")), remaining); })]); }
  finally { clearTimeout(timer); }
}
const system: CodexManagedProcessSystem = {
  inspectParent: inspectCodexHostRuntime,
  spawn: request => spawn(request.executable, [...request.args], { cwd: request.cwd, env: { ...request.env }, detached: true, stdio: ["pipe", "pipe", "pipe"] }),
  processGroup(pid) { const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "pgid="], { encoding: "utf8", timeout: 1_000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin" } });
    return !result.error && result.status === 0 && /^[1-9][0-9]*$/u.test(result.stdout.trim()) ? Number(result.stdout.trim()) : null; },
  signalGroup(pgid, signal) { try { process.kill(-pgid, signal); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } },
};

/** Offline diagnostic candidate only. No network, Mach expansion, fork,
 * listener, browser helper, contact path, or caller-defined policy. Native
 * tool inventory and auth-home isolation are separate unproven controls. */
export function codexManagedOfflineSandbox(input: { executable: string; scratch: string; accountHome: string }): string {
  const raw = record(input, ["executable", "scratch", "accountHome"]), executable = path(raw.executable), scratch = path(raw.scratch), accountHome = path(raw.accountHome);
  check(executable !== scratch && !executable.startsWith(scratch + "/") && executable !== accountHome && !executable.startsWith(accountHome + "/") && scratch !== accountHome && !scratch.startsWith(accountHome + "/") && !accountHome.startsWith(scratch + "/"), "CODEX_MANAGED_PROCESS_LAYOUT_INVALID");
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

/** Explicit task-only candidate for the native OpenAI provider transport.
 * General TCP 443 and the system resolver do not enforce TLS or hostnames.
 * Model-requested web access still belongs to the separate host broker. No
 * extra file contents, Mach services, listeners, forks or tools are admitted. */
export function codexManagedProviderSandbox(input: { executable: string; scratch: string; accountHome: string }): string {
  return codexManagedOfflineSandbox(input)
    + '(allow network-outbound (literal "/private/var/run/mDNSResponder") (remote tcp "*:443"))\n'
    + '(allow file-read-metadata (literal "/var"))\n';
}

/** Internal, nondefault launcher. Owns no account acquisition or release and
 * cannot qualify an adapter. Account controls must join before runAgentTask
 * acquires its lease. Filesystem fsync/removal can outlast a deadline; the raw
 * cleanup promise remains owned and no timeout supplies release authority. */
export function createCodexManagedProcessLauncher(options: CodexManagedProcessOptions, trustedSystem: CodexManagedProcessSystem = system): CodexManagedProcessLauncher {
  const raw = record(options, ["stateRoot", "runtime", "admission", "startupTimeoutMs"]), stateRoot = path(raw.stateRoot);
  const r = record(raw.runtime, ["executablePath", "version", "sha256", "schemaSha256", "parentRuntime"]), p = record(r.parentRuntime, ["expectedSha256"]);
  const runtime = Object.freeze({ executablePath: path(r.executablePath), version: identifier(r.version), sha256: digest(r.sha256), schemaSha256: digest(r.schemaSha256), parentRuntime: Object.freeze({ expectedSha256: digest(p.expectedSha256) }) });
  const a = record(raw.admission, ["profile", "taskRuntimeVersion", "taskRuntimeDigest", "nativeSha256", "schemaSha256", "parentSha256"]);
  const sandboxProfile = a.profile;
  check(sandboxProfile === "managed-task-offline-candidate-v1" || sandboxProfile === "managed-task-provider-tcp443-dns-candidate-v1", "CODEX_MANAGED_PROCESS_ADMISSION_MISMATCH");
  check(digest(a.nativeSha256) === runtime.sha256 && digest(a.schemaSha256) === runtime.schemaSha256 && digest(a.parentSha256) === runtime.parentRuntime.expectedSha256, "CODEX_MANAGED_PROCESS_ADMISSION_MISMATCH");
  const taskRuntime = Object.freeze({ version: identifier(a.taskRuntimeVersion), digest: digest(a.taskRuntimeDigest) }), startupMs = safeInteger(raw.startupTimeoutMs ?? 10_000, 1, 120_000);
  const host = Object.freeze({ inspectParent: trustedSystem.inspectParent.bind(trustedSystem), spawn: trustedSystem.spawn.bind(trustedSystem), processGroup: trustedSystem.processGroup.bind(trustedSystem), signalGroup: trustedSystem.signalGroup.bind(trustedSystem), syncDirectory: trustedSystem.syncDirectory?.bind(trustedSystem) ?? syncDirectory });
  const seen = new WeakSet<AgentTaskAccountLease>(); let generation = 0;
  return Object.freeze({ launch(input: Parameters<CodexManagedProcessLauncher["launch"]>[0]) {
    const launch = record(input, ["request", "runId", "accountId", "workspaceId", "configuration", "accountLease", "cancellationSignal"]), request = launch.request as Parameters<CodexManagedProcessLauncher["launch"]>[0]["request"];
    const lease = assertAgentTaskAccountLease(request), originalSignal = request.signal, cancellationSignal = launch.cancellationSignal as AbortSignal;
    check(request.route.provider === "codex" && request.route.authentication === "subscription" && launch.accountLease === lease && launch.runId === request.runId && launch.accountId === request.accountId && launch.workspaceId === request.workspaceId, "CODEX_MANAGED_PROCESS_BINDING_MISMATCH");
    check(request.runtime.runtimeVersion === taskRuntime.version && request.runtime.runtimeDigest === taskRuntime.digest, "CODEX_MANAGED_PROCESS_RUNTIME_MAPPING_MISMATCH");
    check(launch.configuration === codexManagedAccountConfiguration(), "CODEX_MANAGED_PROCESS_CONFIGURATION_MISMATCH");
    check(cancellationSignal instanceof AbortSignal, "CODEX_MANAGED_PROCESS_SIGNAL_INVALID");
    check(!seen.has(lease), "CODEX_MANAGED_PROCESS_DUPLICATE_RUN"); seen.add(lease);
    const processGeneration = safeInteger(++generation, 1, Number.MAX_SAFE_INTEGER), configuration = codexManagedAccountConfiguration();
    const binding: AgentTaskBinding = Object.freeze({ route: Object.freeze({ ...request.route }), accountId: request.accountId, workspaceId: request.workspaceId, runId: request.runId,
      profile: Object.freeze({ ...request.profile }), model: Object.freeze({ ...request.model }), runtime: Object.freeze({ ...request.runtime }), accountLease: lease });
    return Promise.resolve(createOwnedCore({ stateRoot, runtime, host, binding, lease, processGeneration, configuration, runId: request.runId,
      originalSignal, cancellationSignal, startupMs, sandboxProfile, executionDeadline: request.executionDeadlineUnixMs,
      outerDeadline: request.cleanupDeadlineUnixMs, maxCleanupMs: request.limits.maxCleanupMs, schema: "agentrouter.codex-managed-process.v1",
      authority() { assertAgentTaskAccountLease(request); check(request.accountLease === lease && request.signal === originalSignal, "CODEX_MANAGED_PROCESS_BINDING_MISMATCH"); } }));
  } });
}

// This ownership core is deliberately not exported. A task can enter only via
// the original runtime authority checks; diagnostics have a separate fixed entry.
interface OwnedCore<B, S extends string> extends CodexProcessHandle { receipt(): CoreReceipt<B, S>; stopAndJoin(): Promise<CoreReceipt<B, S>> }
type ProcessHost = Required<CodexManagedProcessSystem>;
function createOwnedCore<B, S extends string>(input: Readonly<{ stateRoot: string; runtime: CodexManagedProcessOptions["runtime"]; host: ProcessHost;
  binding: B; lease: AccountLease; processGeneration: number; configuration: string; runId: string; schema: S;
  sandboxProfile?: ManagedSandboxProfile;
  originalSignal: AbortSignal; cancellationSignal: AbortSignal; startupMs: number; executionDeadline: number; outerDeadline: number; maxCleanupMs: number; authority(): void;
}>): OwnedCore<B, S> {
  const { stateRoot, runtime, host, binding, lease, processGeneration, configuration, runId, schema, originalSignal, cancellationSignal,
    startupMs, executionDeadline, outerDeadline, maxCleanupMs, authority } = input;
  const sandboxProfile = input.sandboxProfile ?? "managed-task-offline-candidate-v1";
  const network = sandboxProfile === "managed-task-provider-tcp443-dns-candidate-v1" ? "general-tcp443-system-resolver-var-metadata-candidate" : "denied";
    const owned = Object.freeze({ accountId: lease.accountId, owner: lease.owner, leaseGeneration: lease.generation, processGeneration });
    const accountRoot = join(stateRoot, "accounts", lease.accountId), accountHome = join(accountRoot, "codex-home"), runs = join(stateRoot, "runs");
    const root = join(runs, `task-${runId}-${processGeneration}-${randomBytes(12).toString("hex")}`), scratch = join(root, "scratch"), runtimeRoot = join(root, "runtime"), executable = join(runtimeRoot, "codex"), cwd = join(scratch, "work"), custodyPath = join(root, "custody.jsonl"), lockPath = join(accountRoot, "active.json");
    const lockContents = JSON.stringify({ schema: "agentrouter.codex-account-lock.v1", binding: owned, journalPath: custodyPath }) + "\n";
    const startupDeadline = Math.min(executionDeadline, Date.now() + startupMs);
    const state = { phase: "preparing" as CodexManagedProcessReceipt["phase"], launchAttempted: false, pid: null as number | null, pgid: null as number | null, rootExited: false, groupAbsent: false, stdioJoined: false, lockReleased: false, scratchRetained: false,
      nativeExitCode: null as number | null, nativeExitSignal: null as string | null, runtimeSnapshotSha256: "", profileSha256: "", scratchContentSha256: "", scratchIdentitySha256: "" };
    let child: ChildProcessWithoutNullStreams | undefined, lockOwned = false, pendingReleaseSync = false, journalFd: number | undefined, journalFailed = false, sequence = 0, previous: string | null = null;
    let scratchIdentity: BigIntStats | undefined, runtimeIdentity: BigIntStats | undefined, preparationSettled = false, nativeClosed = false, spawnEvent = false, spawnError = false, closing = false, pendingWrites = 0;
    let stopTask: Promise<CoreReceipt<B, S>> | undefined, cleanupDeadline: number | undefined, cleanupErrors: readonly string[] = [], executionTimer: ReturnType<typeof setTimeout> | undefined;
    const runtimeErrors = new Set<string>(), nativeStreams = { stdin: false, stdout: false, stderr: false };
    let resolveExit!: () => void, resolveClose!: () => void;
    const exited = new Promise<void>(done => { resolveExit = done; }), closed = new Promise<void>(done => { resolveClose = done; });
    const streamClosures: Promise<void>[] = [], stdout = new PassThrough(); stdout.on("error", () => {});
    let inputClosed = false;
    const stdin = new Writable({ write(chunk: Buffer, _encoding, done) {
      if (!child || closing || state.phase !== "running") { done(new Error("CODEX_MANAGED_PROCESS_STDIN_UNAVAILABLE")); return; }
      pendingWrites++; let settled = false;
      const settle = (error?: Error | null) => { if (settled) return; settled = true; pendingWrites--; done(error); };
      try { child.stdin.write(chunk, settle); } catch { settle(new Error("CODEX_MANAGED_PROCESS_STDIN_FAILED")); }
    } }); stdin.on("error", () => {});
    const inputClosure = new Promise<void>(done => stdin.once("close", () => { inputClosed = true; done(); }));
    const receipt = (): CoreReceipt<B, S> => Object.freeze({ schema, binding, processGeneration, productionQualified: false, network, profile: sandboxProfile,
      nativeVersion: runtime.version, executableSha256: runtime.sha256, schemaSha256: runtime.schemaSha256, parentRuntimeSha256: runtime.parentRuntime.expectedSha256, configSha256: hash(configuration), custodyPath, ...state, runtimeErrors: Object.freeze([...runtimeErrors]), cleanupErrors: Object.freeze([...cleanupErrors]) });
    const error = (code: string) => { if (runtimeErrors.size < 24) runtimeErrors.add(code); };
    function persist() {
      check(journalFd !== undefined && !journalFailed && sequence < 32, "CODEX_MANAGED_PROCESS_JOURNAL_FAILED");
      const line = JSON.stringify({ sequence, previousSha256: previous, snapshot: receipt() }) + "\n";
      try { const bytes = Buffer.from(line); check(bytes.length <= 16 * 1024, "CODEX_MANAGED_PROCESS_JOURNAL_BOUND"); let offset = 0;
        while (offset < bytes.length) { const count = writeSync(journalFd, bytes, offset, bytes.length - offset); check(count > 0, "CODEX_MANAGED_PROCESS_JOURNAL_FAILED"); offset += count; }
        fsyncSync(journalFd); previous = hash(line); sequence++;
      } catch { journalFailed = true; fail("CODEX_MANAGED_PROCESS_JOURNAL_FAILED"); }
    }
    function admitted() {
      authority();
      check(!originalSignal.aborted && !cancellationSignal.aborted && !closing && Date.now() < startupDeadline, "CODEX_MANAGED_PROCESS_START_CANCELLED");
    }
    const preparation = Promise.resolve().then(async () => {
      admitted(); await directory(stateRoot); await directory(join(stateRoot, "accounts")); await directory(accountRoot);
      await fixedFile(join(accountRoot, "owner.json"), JSON.stringify({ schema: "agentrouter.codex-account-home.v1", accountId: owned.accountId }) + "\n");
      const parent = await host.inspectParent(runtime.parentRuntime);
      check(parent.sha256 === runtime.parentRuntime.expectedSha256 && parent.platform === "darwin" && parent.arch === "arm64" && parent.version === "1.3.14", "CODEX_MANAGED_PROCESS_PARENT_MISMATCH");
      admitted(); await inspectCodexHostExecutable(runtime.executablePath, runtime.sha256); admitted(); await directory(runs);
      await mkdir(root, { mode: 0o700 }); await syncDirectory(runs);
      journalFd = openSync(custodyPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); fsyncSync(journalFd); await syncDirectory(root);
      const lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); lockOwned = true;
      try { await lock.writeFile(lockContents); await lock.sync(); } finally { await lock.close(); } await syncDirectory(accountRoot); persist();
      await directory(accountHome); await fixedFile(join(accountHome, "config.toml"), configuration); admitted();
      await mkdir(scratch, { mode: 0o700 }); state.scratchRetained = true; scratchIdentity = await directory(scratch);
      await mkdir(runtimeRoot, { mode: 0o700 }); runtimeIdentity = await directory(runtimeRoot);
      for (const name of ["home", "tmp", "work"]) await mkdir(join(scratch, name), { mode: 0o700 });
      await copyExecutable(runtime.executablePath, executable, runtime.sha256); state.runtimeSnapshotSha256 = runtime.sha256;
      const profile = (sandboxProfile === "managed-task-provider-tcp443-dns-candidate-v1" ? codexManagedProviderSandbox : codexManagedOfflineSandbox)({ executable, scratch, accountHome }), profilePath = join(root, "sandbox.sb"); state.profileSha256 = hash(profile);
      await durableFile(profilePath, profile); await syncDirectory(runtimeRoot);
      const inspected = await inspectScratch(scratch); state.scratchContentSha256 = inspected.content; state.scratchIdentitySha256 = inspected.identity;
      await fixedFile(join(accountHome, "config.toml"), configuration); await fixedFile(lockPath, lockContents); await directory(accountHome); admitted();
      state.phase = "launch-pending"; state.launchAttempted = true; persist();
      // This pending record intentionally leaves PID unknown across the spawn
      // crash gap. A thrown spawn is uncertainty, never proof that none started.
      child = host.spawn(Object.freeze({ executable: "/usr/bin/sandbox-exec", args: Object.freeze(["-f", profilePath, executable, "app-server", "--strict-config", "--listen", "stdio://"]), cwd,
        env: Object.freeze({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(scratch, "home"), CODEX_HOME: accountHome, TMPDIR: join(scratch, "tmp"), NO_COLOR: "1", CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" }), detached: true, stdio: Object.freeze(["pipe", "pipe", "pipe"] as const) }));
      state.pid = child.pid ?? null;
      child.once("spawn", () => { spawnEvent = true; });
      child.once("exit", (code, signal) => { state.rootExited = true; state.nativeExitCode = code; state.nativeExitSignal = signal; resolveExit(); });
      child.once("close", () => { nativeClosed = true; if (!spawnEvent && spawnError && state.pid === null) { state.rootExited = true; state.groupAbsent = true; resolveExit(); } resolveClose(); });
      child.once("error", () => { spawnError = true; error("native-spawn"); });
      for (const name of ["stdin", "stdout", "stderr"] as const) streamClosures.push(new Promise<void>(done => child![name].once("close", () => { nativeStreams[name] = true; done(); })));
      let stdoutBytes = 0, stderrBytes = 0;
      const streamFailed = (code: string) => { error(code); void stopAndJoin().catch(() => {}); };
      child.stdout.on("data", (chunk: Buffer) => { stdoutBytes += chunk.length; if (stdoutBytes > 16 * 1024 * 1024) streamFailed("stdout-bound"); else if (!closing) stdout.write(chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 256 * 1024) streamFailed("stderr-bound"); });
      child.stdout.on("end", () => { stdout.end(); });
      for (const name of ["stdin", "stdout", "stderr"] as const) child[name].on("error", () => streamFailed(`native-${name}`));
      persist(); check(state.pid !== null && Number.isSafeInteger(state.pid) && state.pid > 0, "CODEX_MANAGED_PROCESS_PID_UNPROVEN");
      state.pgid = host.processGroup(state.pid); check(state.pgid === state.pid, "CODEX_MANAGED_PROCESS_GROUP_UNPROVEN");
      admitted(); check(!state.rootExited, "CODEX_MANAGED_PROCESS_PREMATURE_EXIT"); state.phase = "running"; persist();
    }).catch(caught => {
      error(caught instanceof Error && /^(?:CODEX|TASK)_[A-Z_]+$/u.test(caught.message) ? caught.message : "preparation-failed");
      if (!state.launchAttempted) { state.rootExited = true; state.groupAbsent = true; resolveExit(); }
      throw new Error("CODEX_MANAGED_PROCESS_PREPARATION_FAILED");
    }).finally(() => { preparationSettled = true; });
    void preparation.catch(() => {});
    function cancel() { void stopAndJoin().catch(() => {}); }
    originalSignal.addEventListener("abort", cancel, { once: true }); cancellationSignal.addEventListener("abort", cancel, { once: true });
    executionTimer = setTimeout(cancel, Math.max(0, executionDeadline - Date.now()));
    if (originalSignal.aborted || cancellationSignal.aborted) cancel();
    const ready = bounded(preparation, startupDeadline).catch(() => { error("startup-failed"); cancel(); throw new Error("CODEX_MANAGED_PROCESS_UNAVAILABLE"); }); void ready.catch(() => {});
    function stopAndJoin(): Promise<CoreReceipt<B, S>> {
      if (stopTask !== undefined) return stopTask;
      closing = true; cleanupDeadline ??= Math.min(outerDeadline, Date.now() + maxCleanupMs); const deadline = cleanupDeadline;
      clearTimeout(executionTimer); originalSignal.removeEventListener("abort", cancel); cancellationSignal.removeEventListener("abort", cancel);
      // Publish before any trusted native callback can synchronously reenter.
      const task = Promise.resolve().then(async () => {
        cleanupErrors = [];
        try {
          if (!preparationSettled) await bounded(preparation.catch(() => {}), deadline);
          if (child) {
            try { child.stdin.end(); } catch { error("stdin-end"); }
            for (const signal of ["SIGTERM", "SIGKILL"] as const) {
              if (state.rootExited || Date.now() >= deadline) break;
              if (state.pgid !== null && state.pgid === state.pid) host.signalGroup(state.pgid, signal); else child.kill(signal);
              if (!state.rootExited) try { await bounded(exited, Math.min(deadline, Date.now() + 250)); } catch {}
            }
            if (state.rootExited && state.pgid === state.pid && state.pgid !== null) state.groupAbsent = !host.signalGroup(state.pgid, 0);
            if (!nativeClosed || !nativeStreams.stdin || !nativeStreams.stdout || !nativeStreams.stderr) await bounded(Promise.all([closed, ...streamClosures]), deadline);
            check(nativeClosed && state.rootExited && state.groupAbsent && nativeStreams.stdin && nativeStreams.stdout && nativeStreams.stderr && pendingWrites === 0, "CODEX_MANAGED_PROCESS_STOP_UNPROVEN");
          } else check(preparationSettled && !state.launchAttempted && state.rootExited, "CODEX_MANAGED_PROCESS_LAUNCH_UNCERTAIN");
          stdin.end(); stdin.destroy(); stdout.end(); stdout.resume();
          if (!inputClosed) await bounded(inputClosure, deadline);
          if (!stdout.readableEnded) await bounded(new Promise<void>(done => stdout.once("end", done)), deadline);
          check(inputClosed && pendingWrites === 0, "CODEX_MANAGED_PROCESS_WRITES_UNJOINED"); state.stdioJoined = true;
          if (lockOwned) {
            check(!journalFailed, "CODEX_MANAGED_PROCESS_JOURNAL_FAILED"); await fixedFile(lockPath, lockContents);
            if (scratchIdentity && state.scratchRetained) { const current = await directory(scratch); check(current.dev === scratchIdentity.dev && current.ino === scratchIdentity.ino, "CODEX_MANAGED_PROCESS_SCRATCH_CHANGED"); await rm(scratch, { recursive: true }); state.scratchRetained = false; }
            if (runtimeIdentity) { const current = await directory(runtimeRoot); check(current.dev === runtimeIdentity.dev && current.ino === runtimeIdentity.ino, "CODEX_MANAGED_PROCESS_RUNTIME_CHANGED"); await rm(runtimeRoot, { recursive: true }); runtimeIdentity = undefined; }
            state.phase = "release-pending"; persist(); await unlink(lockPath); lockOwned = false; pendingReleaseSync = true;
          }
          // A retry after unlink must not inspect or remove a replacement lock.
          // Only the unfinished directory sync belongs to this process owner.
          if (pendingReleaseSync) { await host.syncDirectory(accountRoot); pendingReleaseSync = false; state.lockReleased = true; }
          else if (!state.lockReleased) state.lockReleased = !state.launchAttempted;
          check(state.lockReleased && !journalFailed, "CODEX_MANAGED_PROCESS_RELEASE_UNPROVEN"); state.phase = "closed";
          if (journalFd !== undefined) { persist(); closeSync(journalFd); journalFd = undefined; }
        } catch { state.phase = "recovery-required"; cleanupErrors = ["cleanup-unproven"]; if (journalFd !== undefined && !journalFailed) try { persist(); } catch {} }
        return receipt();
      });
      stopTask = task; void task.then(result => { if (result.phase !== "closed" && stopTask === task) stopTask = undefined; }); return task;
    }
    const handle: OwnedCore<B, S> = Object.freeze({ cwd, stdin, stdout, exited, ready, receipt, stopAndJoin });
    return handle;
}

export type CodexManagedOfflineDiagnosticOptions = Readonly<{
  /** Existing private directory. Every account is created inside a fresh child. */
  directory: string; runtime: CodexManagedProcessOptions["runtime"]; signal: AbortSignal;
  admission: Readonly<{ kind: "managed-offline-lifecycle-diagnostic-v1"; nativeSha256: string; schemaSha256: string; parentSha256: string }>;
}>;
export type CodexManagedOfflineDiagnosticReceipt = Readonly<{
  schema: "agentrouter.codex-managed-offline-diagnostic.v1"; passed: boolean; productionQualified: false; network: "denied";
  root: string; receiptPath: string; configurationSha256: string; nativeSha256: string; schemaSha256: string; parentSha256: string;
  bootstrapJoined: boolean; processJoined: boolean; leaseReleased: boolean; protocol: OfflineProtocolReceipt | null; failures: readonly string[];
}>;
type DiagnosticBinding = Readonly<{ kind: "offline-diagnostic"; diagnosticId: string; accountId: string; accountLease: AccountLease }>;
type DiagnosticCustody = { database: Database; journal: FileHandle; bootstrap?: CodexAccountOwnedProcessPort;
  core?: OwnedCore<DiagnosticBinding, "agentrouter.codex-managed-offline-process.v1">; protocol?: ReturnType<typeof createManagedOfflineProtocol>; joins: Set<Promise<unknown>> };
// Failed diagnostics keep the actual open store, native owners and pending joins.
// There is no TTL takeover, implicit retry, or exported process handle.
const retainedOfflineDiagnostics = new Map<string, DiagnosticCustody>();
async function assertNoDiagnosticAuth(accountHome: string): Promise<void> {
  try { await lstat(join(accountHome, "auth.json")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  fail("OFFLINE_DIAGNOSTIC_AUTH_STATE_UNEXPECTED");
}

/** Fixed offline lifecycle diagnostic, never a task adapter or qualification.
 * Owns fresh synthetic state and real account leases. There is no caller account,
 * model, prompt, config/RPC map, raw handle, callback, or task-admission escape.
 * A failed cleanup retains the private database and native journals for recovery.
 */
export function runCodexManagedOfflineDiagnostic(options: CodexManagedOfflineDiagnosticOptions, trustedSystem: CodexManagedProcessSystem = system): Promise<CodexManagedOfflineDiagnosticReceipt> {
  const raw = record(options, ["directory", "runtime", "signal", "admission"]), parentDirectory = path(raw.directory), signal = raw.signal as AbortSignal;
  check(signal instanceof AbortSignal, "OFFLINE_DIAGNOSTIC_SIGNAL_INVALID");
  const r = record(raw.runtime, ["executablePath", "version", "sha256", "schemaSha256", "parentRuntime"]), p = record(r.parentRuntime, ["expectedSha256"]);
  const runtime = Object.freeze({ executablePath: path(r.executablePath), version: identifier(r.version), sha256: digest(r.sha256), schemaSha256: digest(r.schemaSha256), parentRuntime: Object.freeze({ expectedSha256: digest(p.expectedSha256) }) });
  const admission = record(raw.admission, ["kind", "nativeSha256", "schemaSha256", "parentSha256"]);
  check(admission.kind === "managed-offline-lifecycle-diagnostic-v1" && digest(admission.nativeSha256) === runtime.sha256 && digest(admission.schemaSha256) === runtime.schemaSha256 && digest(admission.parentSha256) === runtime.parentRuntime.expectedSha256, "OFFLINE_DIAGNOSTIC_ADMISSION_MISMATCH");
  const host: ProcessHost = Object.freeze({ inspectParent: trustedSystem.inspectParent.bind(trustedSystem), spawn: trustedSystem.spawn.bind(trustedSystem), processGroup: trustedSystem.processGroup.bind(trustedSystem), signalGroup: trustedSystem.signalGroup.bind(trustedSystem), syncDirectory: trustedSystem.syncDirectory?.bind(trustedSystem) ?? syncDirectory });
  const outerDeadline = Date.now() + 60_000, executionDeadline = outerDeadline - 15_000;
  return Promise.resolve().then(async () => {
    signal.throwIfAborted(); await directory(parentDirectory); signal.throwIfAborted();
    const root = await mkdtemp(join(parentDirectory, "managed-offline-diagnostic-")); await directory(root); await syncDirectory(parentDirectory);
    const stateRoot = join(root, "state"); await mkdir(stateRoot, { mode: 0o700 }); await syncDirectory(root);
    const databasePath = join(root, "account-leases.sqlite"), journalPath = join(root, "diagnostic.jsonl"), receiptPath = join(root, "receipt.json");
    await durableFile(databasePath, ""); await durableFile(journalPath, "");
    let acquiredJournal: FileHandle | undefined, acquiredDatabase: Database | undefined, leases: SqliteAccountLeases;
    try {
      acquiredJournal = await open(journalPath, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
      acquiredDatabase = new Database(databasePath); leases = new SqliteAccountLeases(acquiredDatabase);
    } catch (error) {
      try { acquiredDatabase?.close(); } finally { await acquiredJournal?.close(); }
      throw error;
    }
    const journal = acquiredJournal, database = acquiredDatabase;
    const custody: DiagnosticCustody = { database, journal, joins: new Set() }; retainedOfflineDiagnostics.set(root, custody);
    function retain<T>(work: Promise<T>): Promise<T> { custody.joins.add(work); void work.then(() => custody.joins.delete(work), () => custody.joins.delete(work)); return work; }
    const diagnosticId = randomBytes(12).toString("hex"), accountId = `diagnostic-${diagnosticId}`, accountHome = join(stateRoot, "accounts", accountId, "codex-home"), configuration = codexManagedAccountConfiguration();
    const controller = new AbortController(), interrupt = () => controller.abort(); signal.addEventListener("abort", interrupt, { once: true });
    if (signal.aborted) controller.abort();
    const timer = setTimeout(interrupt, Math.max(0, executionDeadline - Date.now()));
    let lease: AccountLease | undefined, bootstrap: CodexAccountOwnedProcessPort | undefined, core: OwnedCore<DiagnosticBinding, "agentrouter.codex-managed-offline-process.v1"> | undefined;
    let protocol: ReturnType<typeof createManagedOfflineProtocol> | undefined, bootstrapJoined = false, processJoined = false, protocolReceipt: OfflineProtocolReceipt | null = null, sequence = 0, journalFailed = false;
    const failures = new Set<string>(), error = (code: string) => { if (failures.size < 16) failures.add(code); };
    async function persist(event: string, detail: unknown) {
      try { check(++sequence <= 12, "OFFLINE_DIAGNOSTIC_JOURNAL_BOUND"); const line = JSON.stringify({ sequence, event, detail }) + "\n";
        check(Buffer.byteLength(line) <= 16 * 1024, "OFFLINE_DIAGNOSTIC_JOURNAL_BOUND"); await journal.writeFile(line); await journal.sync();
      } catch { journalFailed = true; throw Error("OFFLINE_DIAGNOSTIC_JOURNAL_FAILED"); }
    }
    const cleanupDeadline = () => Math.min(outerDeadline, Date.now() + 10_000);
    function active() { controller.signal.throwIfAborted(); check(Date.now() < executionDeadline, "OFFLINE_DIAGNOSTIC_DEADLINE"); }
    let bootstrapCleanupDeadline: number | undefined;
    async function joinBootstrap() {
      if (!bootstrap) return;
      bootstrapCleanupDeadline ??= cleanupDeadline();
      const stopped = await retain(bootstrap.stopAndJoin({ binding: bootstrap.binding, deadlineMs: bootstrapCleanupDeadline })), receipt = bootstrap.receipt();
      bootstrapJoined = stopped.processExited && stopped.processGroupStopped && stopped.stdoutEnded && stopped.stderrEnded
        && JSON.stringify(stopped.binding) === JSON.stringify(bootstrap.binding) && receipt.phase === "closed" && receipt.lockReleased && !receipt.scratchRetained;
      check(bootstrapJoined, "OFFLINE_DIAGNOSTIC_BOOTSTRAP_UNJOINED");
      if (receipt.failures.length !== 0) error("OFFLINE_DIAGNOSTIC_BOOTSTRAP_RUNTIME_FAILED");
    }
    try {
      await persist("prepared", { nativeSha256: runtime.sha256, schemaSha256: runtime.schemaSha256, parentSha256: runtime.parentRuntime.expectedSha256, configurationSha256: hash(configuration), productionQualified: false, network: "denied" });
      active(); const bootstrapBegan = Date.now(); lease = leases.acquire({ provider: "codex", accountId, owner: `bootstrap-${diagnosticId}`, now: bootstrapBegan, ttlMs: outerDeadline - bootstrapBegan });
      bootstrap = createCodexAccountProcess({ stateRoot, mode: "offline", runtime, binding: { accountId, owner: lease.owner, leaseGeneration: lease.generation, processGeneration: 1 }, startupTimeoutMs: 10_000 }, host);
      custody.bootstrap = bootstrap;
      await bounded(bootstrap.ready, Math.min(executionDeadline, Date.now() + 10_000)); controller.signal.throwIfAborted(); await joinBootstrap();
      check(failures.size === 0, "OFFLINE_DIAGNOSTIC_BOOTSTRAP_RUNTIME_FAILED");
      await persist("bootstrap-joined", { process: bootstrap.receipt(), leaseGeneration: lease.generation });
      check(!journalFailed && leases.release(lease), "OFFLINE_DIAGNOSTIC_BOOTSTRAP_RELEASE_FAILED"); lease = undefined;
      active(); await fixedFile(join(accountHome, "config.toml"), configuration);
      await assertNoDiagnosticAuth(accountHome);
      active(); const taskBegan = Date.now(); lease = leases.acquire({ provider: "codex", accountId, owner: `diagnostic-${diagnosticId}`, now: taskBegan, ttlMs: outerDeadline - taskBegan });
      const admittedLease = lease, binding: DiagnosticBinding = Object.freeze({ kind: "offline-diagnostic", diagnosticId, accountId, accountLease: admittedLease });
      await persist("diagnostic-admitted", { kind: binding.kind, accountId, leaseGeneration: lease.generation });
      core = createOwnedCore({ stateRoot, runtime, host, binding, lease: admittedLease, processGeneration: 2, configuration, runId: `diagnostic-${diagnosticId}`,
        schema: "agentrouter.codex-managed-offline-process.v1", originalSignal: controller.signal, cancellationSignal: controller.signal,
        startupMs: 10_000, executionDeadline, outerDeadline, maxCleanupMs: 10_000,
        authority() { check(lease === admittedLease && JSON.stringify(leases.inspect("codex", accountId)) === JSON.stringify(admittedLease), "OFFLINE_DIAGNOSTIC_LEASE_CHANGED"); } });
      custody.core = core;
      protocol = createManagedOfflineProtocol(core, accountHome, controller.signal, executionDeadline);
      custody.protocol = protocol;
      await protocol.result; controller.signal.throwIfAborted();
      await fixedFile(join(accountHome, "config.toml"), configuration); await assertNoDiagnosticAuth(accountHome);
    } catch (caught) { error(caught instanceof Error && /^(?:OFFLINE_DIAGNOSTIC|CODEX_MANAGED_PROCESS|CODEX_ACCOUNT_PROCESS)_[A-Z_]+$/u.test(caught.message) ? caught.message : controller.signal.aborted ? "OFFLINE_DIAGNOSTIC_CANCELLED" : "OFFLINE_DIAGNOSTIC_FAILED"); }
    finally {
      protocol?.stop(); controller.abort(); clearTimeout(timer); signal.removeEventListener("abort", interrupt);
      try { if (core) {
        const stopped = await retain(core.stopAndJoin()); processJoined = stopped.phase === "closed" && stopped.rootExited && stopped.groupAbsent && stopped.stdioJoined && stopped.lockReleased && stopped.cleanupErrors.length === 0;
        if (stopped.runtimeErrors.length !== 0) error("OFFLINE_DIAGNOSTIC_PROCESS_RUNTIME_FAILED");
        check(processJoined, "OFFLINE_DIAGNOSTIC_PROCESS_UNJOINED"); await persist("diagnostic-process-joined", { process: stopped });
      } else await joinBootstrap(); } catch { error("OFFLINE_DIAGNOSTIC_PROCESS_UNJOINED"); }
      try { if (protocol) { protocolReceipt = await bounded(retain(protocol.join()), cleanupDeadline()); check(protocolReceipt.joined, "OFFLINE_DIAGNOSTIC_PROTOCOL_UNJOINED"); if (protocolReceipt.failure) error(protocolReceipt.failure); } }
      catch { error("OFFLINE_DIAGNOSTIC_PROTOCOL_UNJOINED"); protocolReceipt = protocol?.receipt() ?? null; }
      try {
        if (lease && !journalFailed && (core ? processJoined && protocolReceipt?.joined === true : bootstrapJoined)) {
          await persist("lease-release", { owner: core ? "diagnostic" : "bootstrap", generation: lease.generation }); check(leases.release(lease), "OFFLINE_DIAGNOSTIC_RELEASE_FAILED"); lease = undefined;
        }
      } catch { error("OFFLINE_DIAGNOSTIC_RELEASE_FAILED"); }
    }
    const leaseReleased = lease === undefined && leases.inspect("codex", accountId) === null;
    const receipt: CodexManagedOfflineDiagnosticReceipt = Object.freeze({ schema: "agentrouter.codex-managed-offline-diagnostic.v1", passed: failures.size === 0 && bootstrapJoined && processJoined && leaseReleased && protocolReceipt?.configurationObserved === true,
      productionQualified: false, network: "denied", root, receiptPath, configurationSha256: hash(configuration), nativeSha256: runtime.sha256, schemaSha256: runtime.schemaSha256, parentSha256: runtime.parentRuntime.expectedSha256,
      bootstrapJoined, processJoined, leaseReleased, protocol: protocolReceipt, failures: Object.freeze([...failures]) });
    try { await persist("finished", receipt); }
    finally {
      if (leaseReleased && (!bootstrap || bootstrapJoined) && (!core || processJoined) && (!protocol || protocolReceipt?.joined === true) && custody.joins.size === 0) {
        await journal.close(); database.close(); retainedOfflineDiagnostics.delete(root);
      }
    }
    // A successful on-disk or returned receipt requires successful descriptor
    // closure as well. Failed cleanup keeps its actual custody owners above.
    await durableFile(receiptPath, JSON.stringify(receipt) + "\n");
    return receipt;
  });
}
