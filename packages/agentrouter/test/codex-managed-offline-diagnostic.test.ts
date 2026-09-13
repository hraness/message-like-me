import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { codexManagedAccountConfiguration } from "../src/codex-managed-baseline.ts";
import { runCodexManagedOfflineDiagnostic, type CodexManagedOfflineDiagnosticOptions, type CodexManagedOfflineDiagnosticReceipt,
  type CodexManagedProcessSystem, type CodexManagedSpawn } from "../src/codex-managed-process.ts";
import { createManagedOfflineProtocol } from "../src/codex-managed-offline-protocol.ts";
import type { CodexProcessHandle } from "../src/codex-process.ts";

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
const executable = "synthetic diagnostic executable: never run", parentSha = sha("synthetic parent"), schemaSha = sha("synthetic schemas");
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
type Frame = { id?: number; method: string; params?: unknown };
type Fault = "wrong-home" | "config-drift" | "response-id" | "duplicate" | "extra-frame-field" | "missing-disabled" | "truncated"
  | "native-auth" | "native-thread" | "native-tool" | "native-account-request" | "secret-error" | "bad-utf8" | "oversized" | "partial-utf8" | "invalid-notice";

/** Uses the real private filesystem, SQLite leases and process-owner code.
 * Only the native child/host observations are synthetic; no runtime is launched. */
async function fixture(input: { fault?: Fault; failInspect?: number; throwSpawn?: number; cancelOnConfig?: boolean; writeAuth?: boolean; stderrErrorOnStop?: number } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-offline-diagnostic-test-"))); await chmod(directory, 0o700);
  const executablePath = join(directory, "synthetic-executable"); await writeFile(executablePath, executable, { mode: 0o500 });
  const controller = new AbortController(), runtime = { executablePath, version: "synthetic-native", sha256: sha(executable), schemaSha256: schemaSha, parentRuntime: { expectedSha256: parentSha } };
  const options: CodexManagedOfflineDiagnosticOptions = { directory, runtime, signal: controller.signal,
    admission: { kind: "managed-offline-lifecycle-diagnostic-v1", nativeSha256: runtime.sha256, schemaSha256: schemaSha, parentSha256: parentSha } };
  const spawns: CodexManagedSpawn[] = [], frames: Frame[][] = [], signals: { pid: number; signal: string | number }[] = [];
  const children = new Map<number, { finish(): void; present(): boolean }>(), leasesAtSpawn: { generation: number; expires_at: number; owner: string }[] = [];
  let inspections = 0, retained = false;
  const system: CodexManagedProcessSystem = {
    async inspectParent() {
      if (++inspections === input.failInspect) throw Error("synthetic inspection failure");
      return { executablePath: "/synthetic-parent", version: "1.3.14", platform: "darwin", arch: "arm64", sha256: parentSha };
    },
    spawn(request) {
      spawns.push(request); frames.push([]); const ordinal = spawns.length, accountHome = request.env.CODEX_HOME!, stateRoot = dirname(dirname(dirname(accountHome)));
      const db = new Database(join(dirname(stateRoot), "account-leases.sqlite"), { readonly: true });
      try { leasesAtSpawn.push(db.query<{ generation: number; expires_at: number; owner: string }, []>("SELECT generation, expires_at, owner FROM agentrouter_account_leases").get()!); } finally { db.close(); }
      if (ordinal === input.throwSpawn) throw Error("synthetic uncertain launch");
      const native = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough(), pid = 43000 + ordinal;
      let present = true, ended = false;
      function send(value: unknown) { stdout.write(JSON.stringify(value) + "\n"); }
      const stdin = new Writable({ write(chunk, _encoding, done) {
        const frame = JSON.parse(chunk.toString()) as Frame; frames[ordinal - 1]!.push(frame); done();
        if (frame.method === "initialize") {
          if (input.fault === "bad-utf8") { stdout.write(Buffer.from([0xff, 0x0a])); return; }
          if (input.fault === "oversized") { stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1, 0x61)); return; }
          if (input.fault?.startsWith("native-")) {
            const methods: Record<string, string> = { "native-auth": "account/chatgptAuthTokens/refresh", "native-thread": "thread/started", "native-tool": "item/tool/call", "native-account-request": "account/read" };
            const method = methods[input.fault];
            send({ id: 90, method, params: { sensitive: "synthetic secret never returned" } }); return;
          }
          if (input.fault === "secret-error") { send({ id: 1, error: { message: "synthetic private account data" } }); return; }
          if (input.fault !== "missing-disabled") send({ method: "remoteControl/status/changed", jsonrpc: "2.0", emittedAtMs: 1,
            params: { status: "disabled", installationId: "synthetic-installation", serverName: "synthetic-server", environmentId: null, ...(input.fault === "invalid-notice" ? { extra: true } : {}) } });
          const response = { id: input.fault === "response-id" ? 99 : 1, result: { userAgent: "synthetic", codexHome: input.fault === "wrong-home" ? "/foreign-account" : accountHome, platformFamily: "unix", platformOs: "darwin" },
            ...(input.fault === "extra-frame-field" ? { private: "synthetic secret never returned" } : {}) };
          send(response); if (input.fault === "duplicate") send(response);
        } else if (frame.method === "config/read") {
          if (input.cancelOnConfig) { controller.abort(); return; }
          const config = Bun.TOML.parse(codexManagedAccountConfiguration()) as Record<string, unknown>;
          if (input.fault === "config-drift") config.web_search = "enabled";
          if (input.writeAuth) writeFileSync(join(accountHome, "auth.json"), "synthetic data must never be opened", { mode: 0o600 });
          send({ id: 2, result: { config, layers: [], origins: {} } });
          if (input.fault === "truncated") stdout.write("{");
          if (input.fault === "partial-utf8") stdout.write(Buffer.from([0xc2]));
        }
      } });
      function finish() { if (ended) return; ended = true; if (input.stderrErrorOnStop === ordinal) stderr.emit("error", Error("synthetic stderr private detail"));
        present = false; native.emit("exit", 0, null); stdin.destroy(); stdout.destroy(); stderr.destroy(); native.emit("close", 0, null); }
      children.set(pid, { finish, present: () => present });
      queueMicrotask(() => native.emit("spawn"));
      return Object.assign(native, { pid, stdin, stdout, stderr, kill() { finish(); return true; } }) as unknown as ChildProcessWithoutNullStreams;
    },
    processGroup: pid => pid,
    signalGroup(pid, signal) { signals.push({ pid, signal }); if (signal === 0) return children.get(pid)?.present() ?? false; children.get(pid)?.finish(); return true; },
  };
  cleanup.push(async () => { for (const child of children.values()) child.finish(); if (!retained) await rm(directory, { recursive: true, force: true }); });
  async function run() { const result = await runCodexManagedOfflineDiagnostic(options, system); retained ||= !result.leaseReleased; return result; }
  return { directory, options, system, controller, spawns, frames, signals, leasesAtSpawn, run, inspections: () => inspections };
}
function stopped(receipt: CodexManagedOfflineDiagnosticReceipt) {
  expect(receipt).toMatchObject({ productionQualified: false, network: "denied", bootstrapJoined: true, processJoined: true, leaseReleased: true });
  expect(receipt.protocol?.joined).toBe(true);
}
async function accountState(receipt: CodexManagedOfflineDiagnosticReceipt) {
  const db = new Database(join(receipt.root, "account-leases.sqlite"), { readonly: true });
  try { return db.query<{ account_id: string; owner: string | null; generation: number }, []>("SELECT account_id, owner, generation FROM agentrouter_account_leases").get()!; } finally { db.close(); }
}

test("fixed diagnostic joins two real lease generations and emits no account, model, thread or tool requests", async () => {
  const f = await fixture(), result = await f.run(); stopped(result); expect(result.passed).toBe(true); expect(result.failures).toEqual([]);
  expect(f.spawns).toHaveLength(2); expect(f.frames[0]).toEqual([]);
  expect(f.frames[1]).toEqual([
    { id: 1, method: "initialize", params: { clientInfo: { name: "agentrouter-offline-diagnostic", version: "0.1.0" }, capabilities: { experimentalApi: false, requestAttestation: false } } },
    { method: "initialized" }, { id: 2, method: "config/read", params: { cwd: f.spawns[1]!.cwd, includeLayers: false } },
  ]);
  expect(result.protocol).toEqual({ methods: ["initialize", "initialized", "config/read"], configurationObserved: true, disabledNotices: 1, frameCount: 3, failure: null, joined: true });
  expect(f.leasesAtSpawn.map(value => value.generation)).toEqual([1, 2]); expect(f.leasesAtSpawn[0]!.expires_at).toBe(f.leasesAtSpawn[1]!.expires_at);
  expect(f.leasesAtSpawn[0]!.owner).not.toBe(f.leasesAtSpawn[1]!.owner);
  expect(await accountState(result)).toMatchObject({ owner: null, generation: 2 });
  const home = f.spawns[1]!.env.CODEX_HOME!; expect(f.spawns[0]!.env.CODEX_HOME).toBe(home); expect(f.spawns[0]!.cwd).not.toBe(f.spawns[1]!.cwd);
  expect(await readFile(join(home, "config.toml"), "utf8")).toBe(codexManagedAccountConfiguration()); expect(await readdir(home)).toEqual(["config.toml"]);
  expect((await lstat(result.root)).mode & 0o777).toBe(0o700); expect((await lstat(result.receiptPath)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(result.receiptPath, "utf8"))).toEqual(result);
  for (const spawn of f.spawns) {
    expect(spawn.args.slice(3)).toEqual(["app-server", "--strict-config", "--listen", "stdio://"]);
    expect(spawn.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED).toBe("1");
    expect(await readdir(dirname(spawn.env.CODEX_HOME!))).not.toContain("active.json");
    const policy = await readFile(spawn.args[1]!, "utf8"); expect(policy).not.toMatch(/\(allow (?:network|mach|process-fork)/u);
  }
  const journal = await readFile(join(result.root, "diagnostic.jsonl"), "utf8");
  expect(journal).toContain('"kind":"offline-diagnostic"'); expect(journal).not.toContain('"model"'); expect(journal).not.toContain('"qualification"');
  expect(Object.keys(result)).not.toContain("stdin"); expect(Object.keys(result)).not.toContain("binding"); expect(Object.values(result).some(value => typeof value === "function")).toBe(false);
});

test("each invocation creates a fresh synthetic account with no caller-selected account or task authority", async () => {
  const f = await fixture(), first = await f.run(), second = await f.run(); expect(first.passed).toBe(true); expect(second.passed).toBe(true);
  expect(first.root).not.toBe(second.root); expect((await accountState(first)).account_id).not.toBe((await accountState(second)).account_id);
});

test.each(["accountId", "stateRoot", "configuration", "rpc", "model", "prompt", "network", "onProcess", "qualification"])("rejects caller %s before any filesystem or process effect", async key => {
  const f = await fixture(); expect(() => runCodexManagedOfflineDiagnostic({ ...f.options, [key]: "untrusted" }, f.system)).toThrow("UNKNOWN_FIELD");
  expect(await readdir(f.directory)).toEqual(["synthetic-executable"]); expect(f.inspections()).toBe(0);
});

test("descriptor admission rejects accessors without invoking them", async () => {
  const f = await fixture(); let called = false;
  const runtime = Object.defineProperty({ ...f.options.runtime }, "executablePath", { enumerable: true, get() { called = true; return f.options.runtime.executablePath; } });
  expect(() => runCodexManagedOfflineDiagnostic({ ...f.options, runtime }, f.system)).toThrow("ACCESSOR_DENIED"); expect(called).toBe(false); expect(f.inspections()).toBe(0);
});

test.each(["kind", "nativeSha256", "schemaSha256", "parentSha256"])("diagnostic admission requires matching %s pins before effects", async field => {
  const f = await fixture(), admission = { ...f.options.admission, [field]: field === "kind" ? "qualified-task" : sha("wrong pin") };
  expect(() => runCodexManagedOfflineDiagnostic({ ...f.options, admission }, f.system)).toThrow("ADMISSION_MISMATCH"); expect(f.inspections()).toBe(0);
});

test.each(["wrong-home", "config-drift", "response-id", "duplicate", "extra-frame-field", "missing-disabled", "truncated", "native-auth", "native-thread", "native-tool", "native-account-request", "secret-error", "bad-utf8", "oversized", "partial-utf8", "invalid-notice"] as const)("fixed protocol rejects %s and joins actual ownership before release", async fault => {
  const f = await fixture({ fault }), result = await f.run(); stopped(result); expect(result.passed).toBe(false); expect(result.failures.length).toBeGreaterThan(0);
  expect(f.frames[0]).toEqual([]); expect(f.frames[1]!.every(frame => ["initialize", "initialized", "config/read"].includes(frame.method))).toBe(true);
  expect(JSON.stringify(result)).not.toContain("synthetic private account data"); expect(JSON.stringify(result)).not.toContain("synthetic secret never returned");
  expect((await accountState(result)).owner).toBeNull();
});

test.each([1, 2])("joined stderr failure in phase %i releases safe custody without claiming diagnostic success", async stderrErrorOnStop => {
  const f = await fixture({ stderrErrorOnStop }), result = await f.run(); expect(result.passed).toBe(false); expect(result.leaseReleased).toBe(true);
  expect(result.bootstrapJoined).toBe(true); expect(f.spawns).toHaveLength(stderrErrorOnStop);
  expect(result.failures).toContain(stderrErrorOnStop === 1 ? "OFFLINE_DIAGNOSTIC_BOOTSTRAP_RUNTIME_FAILED" : "OFFLINE_DIAGNOSTIC_PROCESS_RUNTIME_FAILED");
  expect(JSON.stringify(result)).not.toContain("synthetic stderr private detail"); expect((await accountState(result)).owner).toBeNull();
});

test("protocol cancellation revokes a blocked write immediately but join retains the actual callback", async () => {
  let completeWrite!: () => void, wrote!: () => void;
  const writing = new Promise<void>(resolve => { wrote = resolve; }), stdout = new PassThrough(), controller = new AbortController();
  const stdin = new Writable({ write(_chunk, _encoding, done) { completeWrite = () => done(); wrote(); } });
  const process = { cwd: "/synthetic/work", stdin, stdout, ready: Promise.resolve() } as unknown as CodexProcessHandle;
  const protocol = createManagedOfflineProtocol(process, "/synthetic/account", controller.signal, Date.now() + 30_000);
  const outcome = protocol.result.catch(error => error as Error); await writing; controller.abort();
  expect((await outcome as Error).message).toBe("OFFLINE_DIAGNOSTIC_CANCELLED");
  let joined = false; const joining = protocol.join().then(receipt => { joined = true; return receipt; });
  await Promise.resolve(); expect(joined).toBe(false); expect(protocol.receipt().joined).toBe(false);
  completeWrite(); expect((await joining).joined).toBe(true); expect(protocol.receipt().methods).toEqual(["initialize"]);
  stdin.destroy(); stdout.destroy();
});

test("cancellation during the fixed read sends no additional frames and joins process and protocol", async () => {
  const f = await fixture({ cancelOnConfig: true }), result = await f.run(); stopped(result); expect(result.passed).toBe(false); expect(result.failures).toContain("OFFLINE_DIAGNOSTIC_CANCELLED");
  expect(f.frames[1]!.map(frame => frame.method)).toEqual(["initialize", "initialized", "config/read"]);
});

test("unexpected auth state is detected without reading or returning its bytes", async () => {
  const f = await fixture({ writeAuth: true }), result = await f.run(); stopped(result); expect(result.passed).toBe(false); expect(result.failures).toContain("OFFLINE_DIAGNOSTIC_AUTH_STATE_UNEXPECTED");
  expect(JSON.stringify(result)).not.toContain("synthetic data must never be opened"); expect(await readFile(join(f.spawns[1]!.env.CODEX_HOME!, "auth.json"), "utf8")).toBe("synthetic data must never be opened");
});

test("pre-spawn diagnostic admission failure still joins its allocated core and releases only its own next lease", async () => {
  const f = await fixture({ failInspect: 2 }), result = await f.run(); stopped(result); expect(result.passed).toBe(false); expect(f.spawns).toHaveLength(1);
  expect((await accountState(result)).generation).toBe(2); expect(result.protocol?.methods).toEqual([]);
});

test.each([1, 2])("uncertain launch in phase %i retains account lock and actual SQLite custody", async throwSpawn => {
  const f = await fixture({ throwSpawn }), result = await f.run(); expect(result.passed).toBe(false); expect(result.leaseReleased).toBe(false); expect(result.processJoined).toBe(false);
  expect(f.spawns).toHaveLength(throwSpawn); const account = await accountState(result); expect(account.owner).not.toBeNull(); expect(account.generation).toBe(throwSpawn);
  const lock = JSON.parse(readFileSync(join(dirname(f.spawns.at(-1)!.env.CODEX_HOME!), "active.json"), "utf8"));
  expect(lock.binding.leaseGeneration).toBe(throwSpawn); expect(readFileSync(lock.journalPath, "utf8")).toContain('"launchAttempted":true');
  // Intentionally retain this wholly synthetic directory until process exit:
  // the diagnostic's live store/owner are not removed by test cleanup either.
});

test("already cancelled admission creates no synthetic account or process", async () => {
  const f = await fixture(); f.controller.abort(); await expect(f.run()).rejects.toThrow(); expect(f.spawns).toEqual([]); expect(await readdir(f.directory)).toEqual(["synthetic-executable"]);
});
