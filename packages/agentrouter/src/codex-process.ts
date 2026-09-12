import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Transform, type Readable, type Writable } from "node:stream";
import { identifier, object, safeInteger } from "./validation.ts";
import { inspectCodexHostRuntime, type CodexParentRuntimeBinding } from "./codex-host.ts";
import { inspectCodexScratch } from "./codex-scratch.ts";

export const CODEX_NATIVE_VERSION = "0.153.4";
export const CODEX_NATIVE_SHA256 = "87a08119b8effa519f0ecb552dc98043f58a8200bf2ec5da60f76890c33e9c3a";
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export type CodexProcessReceipt = Readonly<{
  nativeVersion: string; executableSha256: string; runtimeSnapshotSha256: string;
  configSha256: string; profileSha256: string; custodyPath: string;
  parentRuntimeSha256: string; scratchContentSha256: string; scratchIdentitySha256: string;
  pid: number | null; pgid: number | null; rootExited: boolean; groupAbsent: boolean;
  stdioJoined: boolean; scratchRetained: boolean; nativeExitCode: number | null;
  nativeExitSignal: string | null; runtimeErrors: readonly string[]; cleanupErrors: readonly string[];
}>;
export interface CodexProcessHandle {
  readonly cwd: string; readonly stdin: Writable; readonly stdout: Readable;
  readonly exited: Promise<void>; readonly ready: Promise<void>;
  receipt(): CodexProcessReceipt;
  stopAndJoin(): Promise<CodexProcessReceipt>;
}
export interface CodexProcessLauncher {
  /** No contact path, credential, arbitrary executable, or caller-selected argv. */
  launch(input: { runId: string; accountId: string; workspaceId: string; configuration: string; relayPort: number; signal: AbortSignal }): Promise<CodexProcessHandle>;
}

/** Journal decoding supplies recovery evidence, never process-stop authority. */
export function parseCodexCustodyJournal(text: string): { snapshot: Readonly<Record<string, unknown>>; incompleteTail: boolean } {
  if (Buffer.byteLength(text) > 128 * 1024) throw new Error("CODEX_CUSTODY_JOURNAL_BOUND");
  const lines = text.split("\n"), tail = lines.pop();
  if (!lines.length || lines.length > 8) throw new Error("CODEX_CUSTODY_JOURNAL_INCOMPLETE");
  let previous: string | null = null, snapshot: Record<string, unknown> | undefined;
  for (const [index, line] of lines.entries()) {
    if (Buffer.byteLength(line) > 16 * 1024) throw new Error("CODEX_CUSTODY_RECORD_BOUND");
    const record = object(JSON.parse(line) as unknown, ["sequence", "previousSha256", "snapshot"]);
    if (record.sequence !== index || record.previousSha256 !== previous) throw new Error("CODEX_CUSTODY_CHAIN_INVALID");
    const prior = snapshot;
    snapshot = object(record.snapshot, ["schema", "runId", "accountId", "workspaceId", "nativeVersion", "executableSha256", "runtimeSnapshotSha256", "configSha256", "profileSha256", "custodyPath", "parentRuntimeSha256", "scratchContentSha256", "scratchIdentitySha256", "pid", "pgid", "rootExited", "groupAbsent", "stdioJoined", "scratchRetained", "nativeExitCode", "nativeExitSignal", "runtimeErrors", "cleanupErrors"]);
    if (snapshot.schema !== "agentrouter.codex-process.v2" || snapshot.nativeVersion !== CODEX_NATIVE_VERSION
      || snapshot.executableSha256 !== CODEX_NATIVE_SHA256) throw new Error("CODEX_CUSTODY_IDENTITY_INVALID");
    for (const key of ["runId", "accountId", "workspaceId"] as const) identifier(snapshot[key]);
    for (const key of ["configSha256", "profileSha256", "runtimeSnapshotSha256", "parentRuntimeSha256", "scratchContentSha256", "scratchIdentitySha256"] as const) if (typeof snapshot[key] !== "string" || !/^[a-f0-9]{64}$/u.test(snapshot[key])) throw new Error("CODEX_CUSTODY_DIGEST_INVALID");
    for (const key of ["pid", "pgid"] as const) if (snapshot[key] !== null) safeInteger(snapshot[key], 1, Number.MAX_SAFE_INTEGER);
    for (const key of ["rootExited", "groupAbsent", "stdioJoined", "scratchRetained"] as const) if (typeof snapshot[key] !== "boolean") throw new Error("CODEX_CUSTODY_FLAG_INVALID");
    for (const key of ["runtimeErrors", "cleanupErrors"] as const) {
      if (!Array.isArray(snapshot[key]) || snapshot[key].length > 32
        || snapshot[key].some(value => typeof value !== "string" || !/^[a-z0-9-]{1,128}$/u.test(value))) throw new Error("CODEX_CUSTODY_ERRORS_INVALID");
    }
    if (typeof snapshot.custodyPath !== "string" || !isAbsolute(snapshot.custodyPath)
      || snapshot.nativeExitCode !== null && (!Number.isSafeInteger(snapshot.nativeExitCode) || Number(snapshot.nativeExitCode) < 0)
      || snapshot.nativeExitSignal !== null && (typeof snapshot.nativeExitSignal !== "string" || !/^SIG[A-Z0-9]+$/u.test(snapshot.nativeExitSignal))) throw new Error("CODEX_CUSTODY_RESULT_INVALID");
    if (snapshot.groupAbsent && !snapshot.rootExited || !snapshot.scratchRetained && !(snapshot.rootExited && snapshot.groupAbsent && snapshot.stdioJoined)) throw new Error("CODEX_CUSTODY_ORDER_INVALID");
    if (prior) {
      for (const key of ["runId", "accountId", "workspaceId", "configSha256", "profileSha256", "runtimeSnapshotSha256", "custodyPath", "parentRuntimeSha256", "scratchContentSha256", "scratchIdentitySha256"] as const) if (snapshot[key] !== prior[key]) throw new Error("CODEX_CUSTODY_BINDING_CHANGED");
      for (const key of ["pid", "pgid"] as const) if (prior[key] !== null && snapshot[key] !== prior[key]) throw new Error("CODEX_CUSTODY_PROCESS_CHANGED");
      for (const key of ["rootExited", "groupAbsent", "stdioJoined"] as const) if (prior[key] === true && snapshot[key] !== true) throw new Error("CODEX_CUSTODY_REGRESSED");
    }
    previous = hash(line + "\n");
  }
  return { snapshot: Object.freeze(snapshot!), incompleteTail: tail !== "" };
}

async function privateDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("CODEX_ABSOLUTE_STATE_REQUIRED");
  const physical = await realpath(path), metadata = await lstat(path);
  if (physical !== resolve(path) || !metadata.isDirectory() || metadata.isSymbolicLink()
    || metadata.uid !== process.getuid!() || (metadata.mode & 0o777) !== 0o700) throw new Error("CODEX_PRIVATE_STATE_REQUIRED");
  return physical;
}

/** Inspect through one no-follow descriptor before copying any executable bytes. */
export async function inspectCodexExecutable(path: string): Promise<Buffer> {
  if (!isAbsolute(path)) throw new Error("CODEX_ABSOLUTE_EXECUTABLE_REQUIRED");
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat();
    if (!before.isFile() || before.nlink !== 1 || ![0, process.getuid!()].includes(before.uid)
      || (before.mode & 0o022) !== 0 || (before.mode & 0o111) === 0 || before.size < 1 || before.size > 256 * 1024 * 1024) throw new Error("CODEX_EXECUTABLE_IDENTITY_INVALID");
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) {
      const next = await descriptor.read(bytes, length, Math.min(1024 * 1024, bytes.length - length), length);
      if (!next.bytesRead) break; length += next.bytesRead;
    }
    const after = await descriptor.stat(), result = bytes.subarray(0, length);
    if (length !== before.size || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || hash(result) !== CODEX_NATIVE_SHA256) throw new Error("CODEX_EXECUTABLE_CHANGED_OR_UNREVIEWED");
    return result;
  } finally { await descriptor.close(); }
}

/** Experimental runtime policy; the launcher never issues a qualification. */
export function codexMacSandbox(input: { executable: string; scratch: string; relayPort: number }): string {
  if (!Number.isSafeInteger(input.relayPort) || input.relayPort < 1 || input.relayPort > 65535) throw new Error("CODEX_RELAY_PORT_INVALID");
  const literal = (path: string) => {
    if (!isAbsolute(path) || /[\x00-\x1f"\\]/u.test(path)) throw new Error("CODEX_SANDBOX_PATH_INVALID");
    return JSON.stringify(path);
  };
  if (resolve(input.executable).startsWith(`${resolve(input.scratch)}/`) || resolve(input.executable) === resolve(input.scratch)) throw new Error("CODEX_RUNTIME_MUST_BE_OUTSIDE_SCRATCH");
  const executable = literal(input.executable), scratch = literal(input.scratch);
  return `(version 1)
(deny default)
(allow process-exec (literal ${executable}))
(allow file-read* (literal ${executable})
  (subpath "/System/Library") (subpath "/usr/lib") (subpath "/Library/Apple/System/Library")
  (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS")
  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (literal "/dev/null"))
(allow file-read-data file-write-data (literal "/dev/fd/0") (literal "/dev/fd/1") (literal "/dev/fd/2"))
(allow file-map-executable (literal ${executable}) (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Cryptexes/OS") (subpath "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read* (literal "/") (path-ancestors "/System/Cryptexes/OS") (path-ancestors "/System/Volumes/Preboot/Cryptexes/OS"))
(allow file-read-metadata (path-ancestors ${executable}) (path-ancestors ${scratch}))
(allow file-read* file-write* (subpath ${scratch}))
(allow file-read-data file-read-metadata (literal "/etc/codex/requirements.toml") (literal "/private/etc/codex/requirements.toml"))
(allow file-read-metadata (path-ancestors "/etc/codex/requirements.toml") (path-ancestors "/private/etc/codex/requirements.toml"))
(allow sysctl-read)
(allow process-info* (target self))
(allow signal (target self))
(allow network-outbound (remote tcp "localhost:${input.relayPort}"))
`;
}

async function waitFor(promise: Promise<void>, milliseconds: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise.then(() => true), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

/** Internal host launcher. Account/API integration and production admission are separate. */
export function createCodexProcessLauncher(options: { executablePath: string; stateRoot: string; parentRuntime: CodexParentRuntimeBinding }): CodexProcessLauncher {
  const executablePath = options.executablePath, configuredStateRoot = options.stateRoot, binding = options.parentRuntime;
  // Snapshot only a closed data binding from prior artifact admission. A caller
  // cannot turn an accessor or later mutation into a different parent pin.
  if (binding === null || typeof binding !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(binding))
    || Reflect.ownKeys(binding).length !== 1) throw new Error("CODEX_HOST_BINDING_INVALID");
  const pin = Object.getOwnPropertyDescriptor(binding, "expectedSha256");
  if (!pin || !("value" in pin)) throw new Error("CODEX_HOST_BINDING_INVALID");
  if (typeof pin.value !== "string" || !/^[a-f0-9]{64}$/u.test(pin.value)) throw new Error("CODEX_HOST_PIN_INVALID");
  const parentRuntime = Object.freeze({ expectedSha256: pin.value });
  return Object.freeze({ async launch(raw: Parameters<CodexProcessLauncher["launch"]>[0]): Promise<CodexProcessHandle> {
    const input = Object.freeze({ runId: raw.runId, accountId: raw.accountId, workspaceId: raw.workspaceId,
      configuration: raw.configuration, relayPort: raw.relayPort, signal: raw.signal });
    if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("CODEX_PINNED_MAC_RUNTIME_REQUIRED");
    for (const value of [input.runId, input.accountId, input.workspaceId]) identifier(value);
    safeInteger(input.relayPort, 1, 65535);
    if (typeof input.configuration !== "string" || !input.configuration || input.configuration.includes("\0")
      || Buffer.byteLength(input.configuration) > 256 * 1024) throw new Error("CODEX_CONFIG_BOUND");
    input.signal.throwIfAborted();
    const stateRoot = await privateDirectory(configuredStateRoot);
    input.signal.throwIfAborted();
    const parent = await inspectCodexHostRuntime(parentRuntime);
    input.signal.throwIfAborted();
    const bytes = await inspectCodexExecutable(executablePath);
    const root = await mkdtemp(join(stateRoot, "run-")); await chmod(root, 0o700);
    const scratch = join(root, "child"), runtime = join(root, "runtime"), executable = join(runtime, "codex"), custodyPath = join(root, "custody.jsonl");
    let custodyFd: number | undefined;
    let sequence = 0, previousRecordHash: string | null = null, journalFailed = false;
    let child: ChildProcessWithoutNullStreams;
    const errors: string[] = [], runtimeErrors: string[] = [];
    const value = { nativeVersion: CODEX_NATIVE_VERSION, executableSha256: CODEX_NATIVE_SHA256, runtimeSnapshotSha256: "",
      configSha256: hash(input.configuration), profileSha256: "", custodyPath,
      parentRuntimeSha256: parent.sha256, scratchContentSha256: "", scratchIdentitySha256: "",
      pid: null as number | null, pgid: null as number | null,
      rootExited: false, groupAbsent: false, stdioJoined: false, scratchRetained: true,
      nativeExitCode: null as number | null, nativeExitSignal: null as string | null };
    const receipt = (): CodexProcessReceipt => Object.freeze({ ...value, runtimeErrors: Object.freeze([...runtimeErrors]), cleanupErrors: Object.freeze([...errors]) });
    const persist = () => {
      if (custodyFd === undefined || journalFailed || sequence >= 8) throw new Error("CODEX_CUSTODY_NOT_WRITABLE");
      const encoded = Buffer.from(JSON.stringify({ sequence, previousSha256: previousRecordHash,
        snapshot: { schema: "agentrouter.codex-process.v2", runId: input.runId, accountId: input.accountId, workspaceId: input.workspaceId, ...receipt() } }) + "\n");
      try {
        if (encoded.length > 16 * 1024) throw new Error("CODEX_CUSTODY_BOUND");
        let offset = 0;
        while (offset < encoded.length) { const count = writeSync(custodyFd, encoded, offset, encoded.length - offset); if (!count) throw new Error("CODEX_CUSTODY_WRITE_FAILED"); offset += count; }
        fsyncSync(custodyFd); previousRecordHash = hash(encoded); sequence++;
      } catch (error) { journalFailed = true; throw error; }
    };
    const failure = (operation: string) => { if (!errors.includes(operation) && errors.length < 32) errors.push(operation); };
    const runtimeFailure = (operation: string) => { if (!runtimeErrors.includes(operation) && runtimeErrors.length < 32) runtimeErrors.push(operation); };
    try {
      for (const path of [scratch, runtime, ...["home", "state", "tmp", "work"].map(name => join(scratch, name))]) await mkdir(path, { mode: 0o700 });
      await writeFile(executable, bytes, { mode: 0o500, flag: "wx" });
      value.runtimeSnapshotSha256 = hash(await inspectCodexExecutable(executable));
      await writeFile(join(scratch, "state", "config.toml"), input.configuration, { mode: 0o600, flag: "wx" });
      const profile = codexMacSandbox({ executable, scratch, relayPort: input.relayPort }); value.profileSha256 = hash(profile);
      const profilePath = join(root, "sandbox.sb"); await writeFile(profilePath, profile, { mode: 0o600, flag: "wx" });
      const inspectedScratch = await inspectCodexScratch({ scratch, configuration: input.configuration });
      if (inspectedScratch.configurationSha256 !== value.configSha256) throw new Error("CODEX_SCRATCH_CONFIGURATION_MISMATCH");
      value.scratchContentSha256 = inspectedScratch.contentSha256;
      value.scratchIdentitySha256 = inspectedScratch.identitySha256;
      custodyFd = openSync(custodyPath, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); persist();
      input.signal.throwIfAborted();
      child = spawn("/usr/bin/sandbox-exec", ["-f", profilePath, executable, "app-server", "--strict-config", "--listen", "stdio://"], {
        cwd: join(scratch, "work"), detached: true, stdio: ["pipe", "pipe", "pipe"],
        // Exact pinned CLI consumes this before runtime startup, selecting
        // DisabledEphemeral instead of consulting persisted remote-control state.
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: join(scratch, "home"), CODEX_HOME: join(scratch, "state"), TMPDIR: join(scratch, "tmp"), NO_COLOR: "1",
          CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: "1" },
      });
    } catch (error) {
      if (custodyFd !== undefined) closeSync(custodyFd);
      await rm(root, { recursive: true });
      throw error;
    }
    // No rejection after spawn escapes without an owned handle and join path.
    value.pid = child.pid ?? null;
    let resolveExit!: () => void, resolveClose!: () => void;
    const exited = new Promise<void>(resolve => { resolveExit = resolve; });
    const closed = new Promise<void>(resolve => { resolveClose = resolve; });
    child.once("exit", (code, signal) => { value.rootExited = true; value.nativeExitCode = code; value.nativeExitSignal = signal; resolveExit(); });
    child.once("close", () => { value.stdioJoined = true; resolveClose(); });
    child.once("error", () => { runtimeFailure("spawn"); if (value.pid === null) { value.rootExited = true; value.groupAbsent = true; resolveExit(); } });
    let stdoutBytes = 0, stderrBytes = 0;
    const stdout = new Transform({ transform(chunk: Buffer, _encoding, done) {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 8 * 1024 * 1024) { runtimeFailure("stdout-bound"); done(new Error("CODEX_STDOUT_BOUND")); }
      else done(null, chunk);
    } });
    stdout.on("error", () => { runtimeFailure("stdout"); }); child.stdout.on("error", () => { runtimeFailure("native-stdout"); stdout.destroy(new Error("CODEX_STDOUT_FAILED")); });
    child.stdin.on("error", () => { if (!value.rootExited) runtimeFailure("native-stdin"); });
    child.stderr.on("error", () => { runtimeFailure("native-stderr"); stdout.destroy(new Error("CODEX_STDERR_FAILED")); });
    child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 256 * 1024) { runtimeFailure("stderr-bound"); stdout.destroy(new Error("CODEX_STDERR_BOUND")); } });
    child.stdout.pipe(stdout);
    try { persist(); } catch { failure("initial-custody-write"); }
    const ready = Promise.resolve().then(() => {
      if (errors.length || runtimeErrors.length) throw new Error("CODEX_PREPARATION_FAILED");
      if (value.pid === null) throw new Error("CODEX_SPAWN_IDENTITY_MISSING");
      const result = spawnSync("/bin/ps", ["-p", String(value.pid), "-o", "pgid="], { encoding: "utf8", timeout: 1000, maxBuffer: 1024, env: { PATH: "/usr/bin:/bin" } });
      if (!result.error && result.status === 0 && /^[1-9][0-9]*$/u.test(result.stdout.trim())) value.pgid = Number(result.stdout.trim());
      persist();
      if (value.pgid !== value.pid) throw new Error("CODEX_GROUP_IDENTITY_UNPROVEN");
      input.signal.throwIfAborted();
    }).catch(error => { runtimeFailure("startup"); throw error; });
    void ready.catch(() => {});
    const signalGroup = (signal: NodeJS.Signals | 0): boolean => {
      if (value.pid === null || value.pgid !== value.pid) throw new Error("CODEX_GROUP_IDENTITY_UNPROVEN");
      try { process.kill(-value.pid, signal); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
    };
    const observeAbsent = () => {
      if (!value.rootExited) return false;
      try { value.groupAbsent = !signalGroup(0); } catch { failure("group-absence-unproven"); }
      return value.groupAbsent;
    };
    let stopping: Promise<CodexProcessReceipt> | undefined;
    const stopAndJoin = () => stopping ??= (async () => {
      await ready.catch(() => {});
      try { child.stdin.end(); } catch { failure("stdin-close"); }
      if (!value.rootExited) await waitFor(exited, 1500);
      for (const signal of ["SIGTERM", "SIGKILL"] as const) {
        if (value.rootExited && (value.groupAbsent || observeAbsent())) break;
        try {
          if (value.pid !== null && value.pgid === value.pid) signalGroup(signal);
          else if (!value.rootExited) child.kill(signal);
        } catch { failure(`signal-${signal.toLowerCase()}`); }
        if (!value.rootExited) await waitFor(exited, 1500);
        if (value.rootExited && value.pgid === value.pid) {
          const end = performance.now() + 500;
          while (!observeAbsent() && performance.now() < end && !errors.includes("group-absence-unproven")) await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      if (value.rootExited && value.pgid === value.pid && !value.groupAbsent) observeAbsent();
      if (!value.rootExited || !value.groupAbsent) failure("process-custody-unproven");
      if (!await waitFor(closed, 1500)) {
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
        if (!await waitFor(closed, 500)) failure("native-stream-custody-unproven");
      }
      stdout.destroy();
      if (value.rootExited && value.groupAbsent && value.stdioJoined) {
        try { value.runtimeSnapshotSha256 = hash(await inspectCodexExecutable(executable)); }
        catch { failure("runtime-snapshot-drift"); }
        try {
          const currentParent = await inspectCodexHostRuntime(parentRuntime);
          if (currentParent.sha256 !== value.parentRuntimeSha256 || currentParent.executablePath !== parent.executablePath) throw new Error("CODEX_HOST_EXECUTABLE_CHANGED");
        } catch { runtimeFailure("parent-runtime-drift"); }
      }
      if (!errors.length && !runtimeErrors.length && value.rootExited && value.groupAbsent && value.stdioJoined) {
        try { await rm(scratch, { recursive: true }); await rm(runtime, { recursive: true }); value.scratchRetained = false; }
        catch { failure("scratch-removal"); }
      }
      try { persist(); } catch { failure("final-custody-write"); }
      if (custodyFd !== undefined) { closeSync(custodyFd); custodyFd = undefined; }
      return receipt();
    })();
    return Object.freeze({ cwd: join(scratch, "work"), stdin: child.stdin, stdout, exited, ready, receipt, stopAndJoin });
  } });
}
