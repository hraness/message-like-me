import type { Readable, Writable } from "node:stream";
import type {
  CodexAccountBinding, CodexAccountCloseReceipt, CodexAccountEvent, CodexAccountRequest,
  CodexAccountResponse, CodexAccountTransport,
} from "./codex-account.ts";
import { boundedText, identifier, object, safeInteger } from "./validation.ts";

export type CodexAccountProcessCloseReceipt = Readonly<{
  binding: CodexAccountBinding;
  processExited: boolean; processGroupStopped: boolean; stdoutEnded: boolean; stderrEnded: boolean;
}>;
/** The trusted host returns this custody handle before asynchronous launch. It
 * owns runtime admission, credential-home isolation and the complete process
 * group. stopAndJoin must join even a failed or still-pending launch. */
export interface CodexAccountProcessPort {
  readonly binding: CodexAccountBinding;
  readonly stdin: Writable; readonly stdout: Readable; readonly stderr: Readable;
  readonly ready: Promise<void>; readonly exited: Promise<void>;
  stopAndJoin(request: { binding: CodexAccountBinding; deadlineMs: number }): Promise<CodexAccountProcessCloseReceipt>;
}
export type CodexAccountTransportOptions = Readonly<{
  binding: CodexAccountBinding; process: CodexAccountProcessPort;
  onEvent(event: CodexAccountEvent): void;
  now?: () => number; initializeTimeoutMs?: number; closeTimeoutMs?: number;
}>;
const LIMITS = Object.freeze({ frameBytes: 1024 * 1024, stdoutBytes: 16 * 1024 * 1024,
  stderrBytes: 256 * 1024, frames: 2048, requests: 256, pending: 4, notifications: 1024 });
const fields = ["binding", "accountGeneration", "signal", "deadlineMs"];
type Pending = {
  resolve(value: unknown): void; reject(error: Error): void;
  cleanup(): void;
};
function text(value: unknown, maximum: number): string {
  const result = boundedText(value, maximum);
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(result)) throw Error("CODEX_ACCOUNT_TRANSPORT_TEXT_INVALID");
  return result;
}
function bind(value: CodexAccountBinding): CodexAccountBinding {
  const raw = object(value, ["accountId", "owner", "leaseGeneration", "processGeneration"]);
  return Object.freeze({ accountId: identifier(raw.accountId), owner: identifier(raw.owner),
    leaseGeneration: safeInteger(raw.leaseGeneration, 1, Number.MAX_SAFE_INTEGER),
    processGeneration: safeInteger(raw.processGeneration, 1, Number.MAX_SAFE_INTEGER) });
}
function same(a: CodexAccountBinding, b: CodexAccountBinding): boolean {
  return a.accountId === b.accountId && a.owner === b.owner && a.leaseGeneration === b.leaseGeneration && a.processGeneration === b.processGeneration;
}
function assert(value: unknown, code: string): asserts value { if (!value) throw Error(code); }
const complete = (value: CodexAccountCloseReceipt) => value.processExited && value.processGroupStopped && value.stdoutEnded
  && value.stderrEnded && value.writesSettled && value.requestsSettled && value.notificationsSettled;

/** Account administration only: no raw RPC, thread/turn, execution, API key or
 * externally supplied token surface. Importing this module never launches a
 * process or discovers credentials. An injected port is not qualification. */
export function createCodexAccountStdioTransport(options: CodexAccountTransportOptions): CodexAccountTransport {
  const binding = bind(options.binding), process = options.process, now = options.now ?? Date.now;
  assert(same(bind(process.binding), binding), "CODEX_ACCOUNT_PROCESS_BINDING_MISMATCH");
  assert(typeof options.onEvent === "function" && typeof process.stopAndJoin === "function", "CODEX_ACCOUNT_PROCESS_PORT_INVALID");
  const initializeTimeoutMs = safeInteger(options.initializeTimeoutMs ?? 10_000, 1, 120_000);
  const closeTimeoutMs = safeInteger(options.closeTimeoutMs ?? 10_000, 1, 120_000);
  const pending = new Map<number, Pending>(), retired = new Set<number>(), writes = new Set<Promise<void>>();
  const operations = new Set<Promise<CodexAccountResponse>>(), stopped = new AbortController();
  const stopTasks = new Set<Promise<CodexAccountProcessCloseReceipt>>();
  const asynchronousNotifications = new Set<Promise<void>>();
  let unknownNotificationWork = false;
  let nextId = 0, line = "", stdoutBytes = 0, stderrBytes = 0, frames = 0, notifications = 0, callbacks = 0;
  let stdoutEnded = false, stderrEnded = false, processExited = false, closing = false, failure: string | null = null;
  let writeTail = Promise.resolve(), closeAttempt: Promise<CodexAccountCloseReceipt> | undefined;
  let resolveStdout!: () => void, resolveStderr!: () => void, resolveExited!: () => void;
  const stdoutDone = new Promise<void>(resolve => { resolveStdout = resolve; });
  const stderrDone = new Promise<void>(resolve => { resolveStderr = resolve; });
  const exitedDone = new Promise<void>(resolve => { resolveExited = resolve; });
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function deadline(value: number): number {
    safeInteger(value, 1, Number.MAX_SAFE_INTEGER);
    const remaining = value - now();
    return safeInteger(remaining, 1, 120_000);
  }
  async function until<T>(task: Promise<T>, end: number, signal?: AbortSignal): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    assert(!signal?.aborted, "CODEX_ACCOUNT_TRANSPORT_ABORTED");
    try { return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("CODEX_ACCOUNT_TRANSPORT_TIMEOUT")), deadline(end));
      onAbort = () => reject(Error("CODEX_ACCOUNT_TRANSPORT_ABORTED"));
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    })]); } finally { clearTimeout(timer); if (onAbort) signal?.removeEventListener("abort", onAbort); }
  }
  function settle(id: number, error?: Error, value?: unknown): void {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id); entry.cleanup();
    if (error) entry.reject(error); else entry.resolve(value);
  }
  function notify(event: Omit<CodexAccountEvent, "binding">): void {
    callbacks++;
    try {
      const result: unknown = options.onEvent(Object.freeze({ binding, ...event }));
      // Controller invalidation must happen synchronously. Reject an async
      // listener, but retain and join any work it has already started.
      if (result !== undefined) {
        if (result instanceof Promise) {
          const joined = result.then(() => {}, () => {});
          asynchronousNotifications.add(joined);
          void joined.then(() => asynchronousNotifications.delete(joined));
        } else unknownNotificationWork = true;
        fail("CODEX_ACCOUNT_NOTIFICATION_HANDLER_ASYNC");
      }
    }
    catch { fail("CODEX_ACCOUNT_NOTIFICATION_HANDLER_FAILED"); }
    finally { callbacks--; }
  }
  function fail(code: string): void {
    if (failure !== null) return;
    failure = code;
    for (const id of [...pending.keys()]) settle(id, Error(code));
    if (!closing) notify({ type: "disconnected" });
    // Stop authority is held by the exact injected custody port, never a native
    // method. Keep an unsuccessful join available for an explicit close retry.
    void closeBound(now() + closeTimeoutMs).catch(() => {});
  }
  function write(message: unknown, signal?: AbortSignal, admitted?: () => boolean): Promise<void> {
    const encoded = JSON.stringify(message) + "\n";
    assert(Buffer.byteLength(encoded) <= LIMITS.frameBytes, "CODEX_ACCOUNT_WRITE_BOUND");
    const task = writeTail.then(async () => {
      assert(!closing && failure === null && !signal?.aborted && (admitted === undefined || admitted()), "CODEX_ACCOUNT_TRANSPORT_CLOSED");
      await new Promise<void>((resolve, reject) => {
        try { process.stdin.write(encoded, error => error ? reject(Error("CODEX_ACCOUNT_WRITE_FAILED")) : resolve()); }
        catch { reject(Error("CODEX_ACCOUNT_WRITE_FAILED")); }
      });
    });
    writes.add(task);
    writeTail = task.then(() => { writes.delete(task); }, () => { writes.delete(task); });
    return task;
  }
  async function rpc(method: string, params: unknown, end: number, signal?: AbortSignal): Promise<unknown> {
    assert(!closing && failure === null, "CODEX_ACCOUNT_TRANSPORT_CLOSED");
    assert(!signal?.aborted, "CODEX_ACCOUNT_TRANSPORT_ABORTED");
    const remaining = deadline(end);
    assert(pending.size < LIMITS.pending && nextId < LIMITS.requests, "CODEX_ACCOUNT_REQUEST_LIMIT");
    const id = ++nextId;
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => { retired.add(id); settle(id, Error("CODEX_ACCOUNT_TRANSPORT_ABORTED")); };
    const response = new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => { retired.add(id); settle(id, Error("CODEX_ACCOUNT_TRANSPORT_TIMEOUT")); }, remaining);
      pending.set(id, { resolve, reject, cleanup() { clearTimeout(timer); signal?.removeEventListener("abort", abort); } });
    });
    void response.catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const sent = write({ id, method, ...(params === undefined ? {} : { params }) }, signal, () => pending.has(id) && now() < end);
    void sent.catch(() => {
      if (pending.has(id)) { retired.add(id); settle(id, Error("CODEX_ACCOUNT_WRITE_FAILED")); }
    });
    // A blocked write callback must not prevent the caller's deadline/abort.
    // Its actual settlement remains tracked independently for close custody.
    return await response;
  }
  function receive(raw: unknown): void {
    const value = object(raw, ["id", "method", "params", "result", "error", "jsonrpc", "emittedAtMs"]);
    assert(value.jsonrpc === undefined || value.jsonrpc === "2.0", "CODEX_ACCOUNT_RPC_VERSION_INVALID");
    if (value.method !== undefined) {
      assert(value.id === undefined && value.result === undefined && value.error === undefined, "CODEX_ACCOUNT_NATIVE_REQUEST_DENIED");
      if (value.emittedAtMs !== undefined) safeInteger(value.emittedAtMs, 0, Number.MAX_SAFE_INTEGER);
      assert(++notifications <= LIMITS.notifications, "CODEX_ACCOUNT_NOTIFICATION_LIMIT");
      if (value.method === "remoteControl/status/changed") {
        const params = object(value.params, ["installationId", "serverName", "environmentId", "status"]);
        assert(params.status === "disabled", "CODEX_ACCOUNT_REMOTE_CONTROL_DENIED");
        text(params.installationId, 160); text(params.serverName, 1024);
        if (params.environmentId !== undefined && params.environmentId !== null) text(params.environmentId, 160);
        // Native initialization reports its disabled remote-control state. The
        // account surface discards this notice and all of its identity fields.
        return;
      }
      if (value.method === "account/updated") {
        const params = object(value.params, ["authMode", "planType"]);
        for (const item of [params.authMode, params.planType]) if (item !== undefined && item !== null) text(item, 128);
        notify({ type: "account-updated" }); return;
      }
      if (value.method === "account/login/completed") {
        const params = object(value.params, ["loginId", "success", "error", "onboardingEntrypoint"]);
        assert(typeof params.success === "boolean", "CODEX_ACCOUNT_NOTIFICATION_INVALID");
        const loginId = params.loginId === undefined || params.loginId === null ? null : text(params.loginId, 160);
        if (params.error !== undefined && params.error !== null) boundedText(params.error, 4096, true);
        if (params.onboardingEntrypoint !== undefined && params.onboardingEntrypoint !== null) text(params.onboardingEntrypoint, 128);
        notify({ type: "login-completed", loginId, success: params.success }); return;
      }
      throw Error("CODEX_ACCOUNT_NATIVE_METHOD_DENIED");
    }
    assert(value.params === undefined && value.emittedAtMs === undefined, "CODEX_ACCOUNT_RESPONSE_INVALID");
    const id = safeInteger(value.id, 1, LIMITS.requests);
    assert(pending.has(id) || retired.has(id), "CODEX_ACCOUNT_RESPONSE_ID_INVALID");
    const result = Object.hasOwn(value, "result"), error = Object.hasOwn(value, "error");
    assert(result !== error, "CODEX_ACCOUNT_RESPONSE_INVALID");
    if (error) {
      const errorValue = object(value.error, ["code", "message", "data"]);
      safeInteger(errorValue.code, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      boundedText(errorValue.message, 4096, true);
    }
    if (retired.delete(id)) return;
    settle(id, error ? Error("CODEX_ACCOUNT_RPC_FAILED") : undefined, value.result);
  }
  process.stdout.on("data", (chunk: unknown) => {
    try {
      assert(chunk instanceof Uint8Array, "CODEX_ACCOUNT_STDOUT_INVALID");
      stdoutBytes += chunk.byteLength;
      assert(stdoutBytes <= LIMITS.stdoutBytes, "CODEX_ACCOUNT_STDOUT_LIMIT");
      if (closing || failure !== null) return;
      line += decoder.decode(chunk, { stream: true });
      let index: number;
      while ((index = line.indexOf("\n")) !== -1) {
        const frame = line.slice(0, index); line = line.slice(index + 1);
        assert(++frames <= LIMITS.frames && Buffer.byteLength(frame) <= LIMITS.frameBytes, "CODEX_ACCOUNT_FRAME_LIMIT");
        receive(JSON.parse(frame));
        if (closing || failure !== null) { line = ""; return; }
      }
      assert(Buffer.byteLength(line) <= LIMITS.frameBytes, "CODEX_ACCOUNT_FRAME_LIMIT");
    } catch (error) { fail(error instanceof Error && /^CODEX_ACCOUNT_[A-Z_]+$/u.test(error.message) ? error.message : "CODEX_ACCOUNT_FRAME_INVALID"); }
  });
  process.stdout.once("end", () => {
    stdoutEnded = true; resolveStdout();
    if (!closing) {
      try { assert(decoder.decode() === "" && line === "", "CODEX_ACCOUNT_STDOUT_TRUNCATED"); }
      catch { fail("CODEX_ACCOUNT_STDOUT_TRUNCATED"); }
      fail("CODEX_ACCOUNT_DISCONNECTED");
    }
  });
  process.stderr.on("data", (chunk: unknown) => {
    if (!(chunk instanceof Uint8Array)) { fail("CODEX_ACCOUNT_STDERR_INVALID"); return; }
    stderrBytes += chunk.byteLength;
    if (stderrBytes > LIMITS.stderrBytes) fail("CODEX_ACCOUNT_STDERR_LIMIT");
  });
  process.stderr.once("end", () => { stderrEnded = true; resolveStderr(); });
  process.stdout.on("error", () => fail("CODEX_ACCOUNT_STDOUT_FAILED"));
  process.stderr.on("error", () => fail("CODEX_ACCOUNT_STDERR_FAILED"));
  process.stdin.on("error", () => fail("CODEX_ACCOUNT_STDIN_FAILED"));
  process.stdout.once("close", () => { if (!stdoutEnded && !closing) fail("CODEX_ACCOUNT_STDOUT_TRUNCATED"); });
  process.stderr.once("close", () => { if (!stderrEnded && !closing) fail("CODEX_ACCOUNT_STDERR_TRUNCATED"); });
  void process.exited.then(() => {
    processExited = true; resolveExited(); if (!closing) fail("CODEX_ACCOUNT_DISCONNECTED");
  }, () => fail("CODEX_ACCOUNT_EXIT_UNPROVEN"));

  let initializationSettled = false;
  const initialized = Promise.resolve().then(async () => {
    const end = now() + initializeTimeoutMs;
    await until(process.ready, end, stopped.signal);
    const result = object(await rpc("initialize", { clientInfo: { name: "agentrouter-account", version: "0.1.0" },
      capabilities: { experimentalApi: false, requestAttestation: false } }, end), ["userAgent", "codexHome", "platformFamily", "platformOs"]);
    text(result.userAgent, 1024); text(result.codexHome, 4096); text(result.platformFamily, 128); text(result.platformOs, 128);
    await until(write({ method: "initialized" }), end, stopped.signal);
  });
  void initialized.then(() => { initializationSettled = true; }, () => { initializationSettled = true; });
  void initialized.catch(() => { if (!closing) fail("CODEX_ACCOUNT_INITIALIZE_FAILED"); });

  function operation(request: CodexAccountRequest, extra: readonly string[], method: string, params: unknown): Promise<CodexAccountResponse> {
    let accountGeneration: number, signal: AbortSignal, end: number;
    try {
      object(request, [...fields, ...extra]);
      assert(same(bind(request.binding), binding), "CODEX_ACCOUNT_REQUEST_BINDING_MISMATCH");
      accountGeneration = safeInteger(request.accountGeneration, 1, Number.MAX_SAFE_INTEGER);
      signal = request.signal; end = request.deadlineMs;
      assert(signal instanceof AbortSignal && !signal.aborted, "CODEX_ACCOUNT_TRANSPORT_ABORTED");
      deadline(end);
    } catch (error) { return Promise.reject(error); }
    const task = Promise.resolve().then(async () => {
      assert(!closing, "CODEX_ACCOUNT_TRANSPORT_CLOSED");
      await until(initialized, end, signal);
      const value = await rpc(method, params, end, signal);
      assert(!signal.aborted && !closing && failure === null, "CODEX_ACCOUNT_TRANSPORT_CLOSED");
      return Object.freeze({ binding, accountGeneration, value });
    });
    operations.add(task);
    void task.then(() => operations.delete(task), () => operations.delete(task));
    return task;
  }
  function closeBound(end: number): Promise<CodexAccountCloseReceipt> {
    if (closeAttempt) return closeAttempt;
    deadline(end); closing = true; stopped.abort();
    for (const id of [...pending.keys()]) settle(id, Error("CODEX_ACCOUNT_TRANSPORT_CLOSED"));
    // Publish the join before the port or notification callback can reenter it.
    const task = Promise.resolve().then(async () => {
      let native: CodexAccountProcessCloseReceipt | undefined;
      try {
        const stop = Promise.resolve().then(() => process.stopAndJoin({ binding, deadlineMs: end }));
        stopTasks.add(stop);
        void stop.then(() => stopTasks.delete(stop), () => stopTasks.delete(stop));
        const receipt = await until(stop, end);
        assert(same(bind(receipt.binding), binding), "CODEX_ACCOUNT_STOP_BINDING_MISMATCH");
        native = receipt;
        await until(Promise.all([stdoutDone, stderrDone, exitedDone, writeTail, initialized.catch(() => {}),
          ...[...operations].map(task => task.catch(() => {})), ...asynchronousNotifications,
          ...[...stopTasks].map(task => task.catch(() => {}))]).then(() => {}), end);
      } catch { /* Incomplete custody remains visible and retryable; never infer exit from timeout. */ }
      // A newer port receipt cannot discharge host cleanup still owned by an
      // earlier timed-out stop call, even when native exit is already observed.
      return Object.freeze({ binding, processExited: processExited && native?.processExited === true && stopTasks.size === 0,
        processGroupStopped: native?.processGroupStopped === true && stopTasks.size === 0,
        stdoutEnded: stdoutEnded && native?.stdoutEnded === true, stderrEnded: stderrEnded && native?.stderrEnded === true,
        writesSettled: writes.size === 0, requestsSettled: pending.size === 0 && operations.size === 0 && initializationSettled && stopTasks.size === 0,
        notificationsSettled: callbacks === 0 && asynchronousNotifications.size === 0 && !unknownNotificationWork });
    });
    closeAttempt = task;
    void task.then(receipt => { if (!complete(receipt) && closeAttempt === task) closeAttempt = undefined; });
    return task;
  }
  return Object.freeze({
    accountRead: (request) => {
      if (request.refreshToken !== false) return Promise.reject(Error("CODEX_ACCOUNT_REFRESH_DENIED"));
      return operation(request, ["refreshToken"], "account/read", { refreshToken: false });
    },
    startLogin: (request) => {
      if (request.method !== "chatgpt" && request.method !== "chatgptDeviceCode") return Promise.reject(Error("CODEX_ACCOUNT_LOGIN_METHOD_DENIED"));
      return operation(request, ["method"], "account/login/start", request.method === "chatgpt"
        ? { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" } : { type: "chatgptDeviceCode" });
    },
    cancelLogin: (request) => operation(request, ["loginId"], "account/login/cancel", { loginId: text(request.loginId, 160) }),
    logout: (request) => operation(request, [], "account/logout", undefined),
    listModels: (request) => {
      if (request.limit !== 100 || request.includeHidden !== true) return Promise.reject(Error("CODEX_ACCOUNT_MODEL_PAGE_DENIED"));
      return operation(request, ["cursor", "limit", "includeHidden"], "model/list",
        { cursor: request.cursor === null ? null : text(request.cursor, 4096), limit: 100, includeHidden: true });
    },
    close: (request) => {
      object(request, ["binding", "deadlineMs"]);
      assert(same(bind(request.binding), binding), "CODEX_ACCOUNT_STOP_BINDING_MISMATCH");
      return closeBound(request.deadlineMs);
    },
  } satisfies CodexAccountTransport);
}
