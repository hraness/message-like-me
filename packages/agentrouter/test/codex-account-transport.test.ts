import { expect, test } from "bun:test";
import { PassThrough, Writable } from "node:stream";
import type { CodexAccountBinding, CodexAccountEvent, CodexAccountRequest } from "../src/codex-account.ts";
import { createCodexAccountStdioTransport, type CodexAccountProcessCloseReceipt, type CodexAccountProcessPort } from "../src/codex-account-transport.ts";

const binding: CodexAccountBinding = Object.freeze({ accountId: "synthetic-account", owner: "synthetic-owner", leaseGeneration: 2, processGeneration: 3 });
const init = { userAgent: "synthetic", codexHome: "/synthetic/account-home", platformFamily: "unix", platformOs: "macos" };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Message = { id?: number; method: string; params?: any };
function fixture(options: {
  handle?: (message: Message, emit: (value: unknown) => void) => void;
  ready?: Promise<void>; onEvent?: (event: CodexAccountEvent) => void;
  stop?: (finish: () => CodexAccountProcessCloseReceipt) => Promise<CodexAccountProcessCloseReceipt>;
  write?: (message: Message, callback: (error?: Error | null) => void) => boolean;
  initializeTimeoutMs?: number;
} = {}) {
  const stdout = new PassThrough(), stderr = new PassThrough(), messages: Message[] = [], events: CodexAccountEvent[] = [];
  const exited = deferred<void>(), initialized = deferred<void>(), stopStarted = deferred<void>();
  const completed = deferred<void>();
  let stopped = false, stops = 0;
  const emit = (value: unknown) => stdout.write(JSON.stringify(value) + "\n");
  const stdin = new Writable({ write(chunk, _encoding, callback) {
    const message: Message = JSON.parse(chunk.toString()); messages.push(message);
    if (options.write?.(message, callback)) return;
    if (message.method === "initialize") emit({ id: message.id, result: init });
    else if (message.method === "initialized") initialized.resolve();
    else if (options.handle) options.handle(message, emit);
    else emit({ id: message.id, result: message.method === "account/read" ? { requiresOpenaiAuth: true, account: null } : {} });
    callback();
  } });
  const finish = (): CodexAccountProcessCloseReceipt => {
    stopped = true; stdin.end(); stdout.end(); stderr.end(); exited.resolve(); completed.resolve();
    return { binding, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true };
  };
  const port: CodexAccountProcessPort = { binding, stdout, stderr, ready: options.ready ?? Promise.resolve(), exited: exited.promise,
    operationCompleted: completed.promise,
    write(bytes) { return new Promise((resolve, reject) => {
      stdin.write(bytes, error => error ? reject(error) : resolve({ outcome: "accepted-full", acceptedBytes: bytes.byteLength }));
    }); },
    async stopAndJoin(request) { expect(request.binding).toEqual(binding); stops++; stopStarted.resolve(); return options.stop ? options.stop(finish) : finish(); } };
  const transport = createCodexAccountStdioTransport({ binding, process: port,
    ...(options.initializeTimeoutMs === undefined ? {} : { initializeTimeoutMs: options.initializeTimeoutMs }),
    closeTimeoutMs: 100, onEvent(event) { events.push(event); return options.onEvent?.(event); } });
  const request = (overrides: Partial<CodexAccountRequest> = {}): CodexAccountRequest => ({ binding, accountGeneration: 7,
    signal: new AbortController().signal, deadlineMs: Date.now() + 2000, ...overrides });
  return { transport, port, stdout, stderr, stdin, emit, finish, messages, events, completed, initialized: initialized.promise,
    stopStarted: stopStarted.promise, request, stopped: () => stopped, stops: () => stops,
    close: (milliseconds = 1000) => transport.close({ binding, deadlineMs: Date.now() + milliseconds }) };
}

test("account-only initialization precedes the exact managed RPC set and retains response binding", async () => {
  const f = fixture({ handle(message, emit) { emit({ id: message.id, result: { synthetic: message.method } }); } });
  try {
    const response = await f.transport.accountRead({ ...f.request(), refreshToken: false });
    expect(response).toEqual({ binding, accountGeneration: 7, value: { synthetic: "account/read" } });
    await f.transport.startLogin({ ...f.request(), method: "chatgpt" });
    await f.transport.startLogin({ ...f.request(), method: "chatgptDeviceCode" });
    await f.transport.cancelLogin({ ...f.request(), loginId: "login-one" });
    await f.transport.logout(f.request());
    await f.transport.listModels({ ...f.request(), cursor: "cursor-one", limit: 100, includeHidden: true });
    expect(f.messages).toEqual([
      { id: 1, method: "initialize", params: { clientInfo: { name: "agentrouter-account", version: "0.1.0" }, capabilities: { experimentalApi: false, requestAttestation: false } } },
      { method: "initialized" },
      { id: 2, method: "account/read", params: { refreshToken: false } },
      { id: 3, method: "account/login/start", params: { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" } },
      { id: 4, method: "account/login/start", params: { type: "chatgptDeviceCode" } },
      { id: 5, method: "account/login/cancel", params: { loginId: "login-one" } },
      { id: 6, method: "account/logout" },
      { id: 7, method: "model/list", params: { cursor: "cursor-one", limit: 100, includeHidden: true } },
    ]);
    expect(Object.keys(f.transport).sort()).toEqual(["accountRead", "cancelLogin", "close", "listModels", "logout", "startLogin"]);
  } finally {
    expect(await f.close()).toEqual({ binding, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true,
      writesSettled: true, requestsSettled: true, notificationsSettled: true });
  }
});

test("concurrent replies are matched by ID and preserve each account generation", async () => {
  const held: Message[] = [], received = deferred<void>();
  const f = fixture({ handle(message) { held.push(message); if (held.length === 2) received.resolve(); } });
  try {
    const first = f.transport.accountRead({ ...f.request(), refreshToken: false });
    const second = f.transport.accountRead({ ...f.request({ accountGeneration: 8 }), refreshToken: false });
    await received.promise;
    f.emit({ id: held[1]!.id, result: { order: 2 } }); f.emit({ id: held[0]!.id, result: { order: 1 } });
    expect(await first).toMatchObject({ accountGeneration: 7, value: { order: 1 } });
    expect(await second).toMatchObject({ accountGeneration: 8, value: { order: 2 } });
  } finally { await f.close(); }
});

test.each(["apiKey", "chatgptAuthTokens", "amazonBedrock", "unknown"])("denies %s login before native writes", async method => {
  const f = fixture();
  try { await expect(f.transport.startLogin({ ...f.request(), method } as any)).rejects.toThrow("LOGIN_METHOD_DENIED");
    await f.initialized; expect(f.messages.some(message => message.method === "account/login/start")).toBe(false);
  } finally { await f.close(); }
});

test("denies refresh, widened model pages, extra fields, and every changed binding component", async () => {
  const f = fixture();
  try {
    await expect(f.transport.accountRead({ ...f.request(), refreshToken: true } as any)).rejects.toThrow("REFRESH_DENIED");
    await expect(f.transport.listModels({ ...f.request(), cursor: null, limit: 101, includeHidden: true } as any)).rejects.toThrow("MODEL_PAGE_DENIED");
    await expect(f.transport.listModels({ ...f.request(), cursor: null, limit: 100, includeHidden: false } as any)).rejects.toThrow("MODEL_PAGE_DENIED");
    await expect(f.transport.accountRead({ ...f.request(), refreshToken: false, accessToken: "synthetic-denied" } as any)).rejects.toThrow();
    for (const changed of [{ accountId: "other" }, { owner: "other" }, { leaseGeneration: 4 }, { processGeneration: 5 }]) {
      await expect(f.transport.accountRead({ ...f.request({ binding: { ...binding, ...changed } }), refreshToken: false })).rejects.toThrow("BINDING_MISMATCH");
      expect(() => f.transport.close({ binding: { ...binding, ...changed }, deadlineMs: Date.now() + 1000 })).toThrow("BINDING_MISMATCH");
    }
    await f.initialized; expect(f.messages.every(message => ["initialize", "initialized"].includes(message.method))).toBe(true);
  } finally { await f.close(); }
});

test("native notifications expose only bounded account events and never email, tokens, or error prose", async () => {
  const f = fixture();
  try {
    await f.initialized;
    f.emit({ method: "account/updated", emittedAtMs: Date.now(), params: { authMode: "chatgpt", planType: "plus" } });
    f.emit({ method: "account/login/completed", params: { loginId: "login-one", success: true, error: "private diagnostic", onboardingEntrypoint: null } });
    expect(f.events).toEqual([{ binding, type: "account-updated" }, { binding, type: "login-completed", loginId: "login-one", success: true }]);
  } finally { expect((await f.close()).notificationsSettled).toBe(true); }
});

const disabledRemoteControl = { status: "disabled", installationId: "00000000-0000-4000-8000-000000000001", serverName: "synthetic-host" };
test.each([{}, { environmentId: null }, { environmentId: "synthetic-environment" }])(
  "disabled remote-control notice preserves pending account read without exposing identity %#", async optional => {
    const held = deferred<Message>(), f = fixture({ handle(message) { held.resolve(message); } });
    try {
      const call = f.transport.accountRead({ ...f.request(), refreshToken: false }), message = await held.promise;
      f.emit({ method: "remoteControl/status/changed", params: { ...disabledRemoteControl, ...optional } });
      expect(f.events).toEqual([]); expect(f.stops()).toBe(0);
      f.emit({ id: message.id, result: { requiresOpenaiAuth: true, account: null } });
      const response = await call;
      expect(response).toEqual({ binding, accountGeneration: 7, value: { requiresOpenaiAuth: true, account: null } });
      expect(f.messages.map(message => message.method)).toEqual(["initialize", "initialized", "account/read"]);
      expect(f.events).toEqual([]);
      expect(JSON.stringify({ response, events: f.events, messages: f.messages })).not.toContain(disabledRemoteControl.installationId);
      expect(JSON.stringify({ response, events: f.events, messages: f.messages })).not.toContain(disabledRemoteControl.serverName);
      expect(JSON.stringify({ response, events: f.events, messages: f.messages })).not.toContain("synthetic-environment");
    } finally { expect((await f.close()).notificationsSettled).toBe(true); }
  });

test.each([
  ["connecting", { ...disabledRemoteControl, status: "connecting" }],
  ["connected", { ...disabledRemoteControl, status: "connected" }],
  ["errored", { ...disabledRemoteControl, status: "errored" }],
  ["unknown status", { ...disabledRemoteControl, status: "unknown" }],
  ["missing status", { installationId: "synthetic", serverName: "synthetic" }],
  ["nonstring status", { ...disabledRemoteControl, status: null }],
  ["missing installation", { status: "disabled", serverName: "synthetic" }],
  ["missing server", { status: "disabled", installationId: "synthetic" }],
  ["nonstring installation", { ...disabledRemoteControl, installationId: 123 }],
  ["nonstring server", { ...disabledRemoteControl, serverName: false }],
  ["nonstring environment", { ...disabledRemoteControl, environmentId: {} }],
  ["empty installation", { ...disabledRemoteControl, installationId: "" }],
  ["empty server", { ...disabledRemoteControl, serverName: " " }],
  ["empty environment", { ...disabledRemoteControl, environmentId: "" }],
  ["control character", { ...disabledRemoteControl, serverName: "synthetic\nname" }],
  ["oversized installation", { ...disabledRemoteControl, installationId: "i".repeat(161) }],
  ["oversized server bytes", { ...disabledRemoteControl, serverName: "🤖".repeat(257) }],
  ["oversized environment", { ...disabledRemoteControl, environmentId: "e".repeat(161) }],
  ["unknown field", { ...disabledRemoteControl, enabled: false }],
  ["nonobject params", null],
])("rejects remote-control notice with %s and joins pending account work", async (_name, params) => {
  const held = deferred<Message>(), f = fixture({ handle(message) { held.resolve(message); } });
  const call = f.transport.accountRead({ ...f.request(), refreshToken: false });
  const rejected = call.catch(error => error);
  await held.promise;
  f.emit({ method: "remoteControl/status/changed", params });
  await f.stopStarted; expect(await rejected).toBeInstanceOf(Error);
  expect(f.events).toEqual([{ binding, type: "disconnected" }]);
  expect(await f.close()).toMatchObject({ processGroupStopped: true, requestsSettled: true, notificationsSettled: true });
});

test("disabled remote-control frames cannot carry a native request ID", async () => {
  const f = fixture(); await f.initialized;
  f.emit({ id: 2, method: "remoteControl/status/changed", params: disabledRemoteControl });
  await f.stopStarted;
  expect(f.events).toEqual([{ binding, type: "disconnected" }]);
  expect(f.messages.map(message => message.method)).toEqual(["initialize", "initialized"]);
  expect((await f.close()).processGroupStopped).toBe(true);
});

test("discarded disabled remote-control notices still consume the notification budget", async () => {
  const f = fixture(); await f.initialized;
  for (let count = 0; count < 1024; count++) f.emit({ method: "remoteControl/status/changed", params: disabledRemoteControl });
  expect(f.events).toEqual([]); expect(f.stops()).toBe(0);
  f.emit({ method: "remoteControl/status/changed", params: disabledRemoteControl });
  await f.stopStarted; expect(f.events).toEqual([{ binding, type: "disconnected" }]);
  expect((await f.close()).processGroupStopped).toBe(true);
});

test.each(["item/tool/call", "account/chatgptAuthTokens/refresh", "attestation/generate", "currentTime/read", "execCommandApproval"])(
  "denies native request %s and stops through its custody port", async method => {
    const f = fixture(); await f.initialized;
    f.emit({ id: 1, method, params: {} });
    await f.stopStarted;
    expect(f.events).toEqual([{ binding, type: "disconnected" }]);
    expect(f.messages.filter(message => message.id === 1)).toHaveLength(1);
    expect((await f.close()).processGroupStopped).toBe(true);
    await expect(f.transport.accountRead({ ...f.request(), refreshToken: false })).rejects.toThrow("CLOSED");
  });

test.each([
  { method: "thread/started", params: {} },
  { id: 200, result: {} },
  { id: 1, result: {}, error: { code: 1, message: "x" } },
  { method: "account/updated", params: { apiKey: "denied" } },
  { method: "account/login/completed", params: { success: "yes" } },
  { method: "account/updated", params: {}, emittedAtMs: "now" },
  { method: "account/updated", params: {}, jsonrpc: "3.0" },
])("rejects malformed or unknown native frame %#", async frame => {
  const f = fixture(); await f.initialized; f.emit(frame); await f.stopStarted;
  expect(f.events).toEqual([{ binding, type: "disconnected" }]); await f.close();
});

test.each(["invalid-json", "invalid-utf8", "oversized-frame", "oversized-stderr"])("fails closed on %s", async kind => {
  const f = fixture(); await f.initialized;
  if (kind === "invalid-json") f.stdout.write("{broken}\n");
  if (kind === "invalid-utf8") f.stdout.write(Buffer.from([0xff, 0x0a]));
  if (kind === "oversized-frame") f.stdout.write("x".repeat(1024 * 1024 + 1));
  if (kind === "oversized-stderr") f.stderr.write(Buffer.alloc(256 * 1024 + 1));
  await f.stopStarted; expect(f.events).toEqual([{ binding, type: "disconnected" }]); await f.close();
});

test("a split UTF8 response is decoded without exposing partial frames", async () => {
  const held = deferred<Message>(), f = fixture({ handle(message) { held.resolve(message); } });
  try {
    const call = f.transport.accountRead({ ...f.request(), refreshToken: false }), message = await held.promise;
    const frame = Buffer.from(JSON.stringify({ id: message.id, result: { synthetic: "butler 🤖" } }) + "\n");
    const split = frame.indexOf(Buffer.from("🤖")) + 2;
    f.stdout.write(frame.subarray(0, split)); f.stdout.write(frame.subarray(split));
    expect((await call).value).toEqual({ synthetic: "butler 🤖" });
  } finally { await f.close(); }
});

test("an aborted RPC retires only its ID and cannot satisfy a later generation", async () => {
  const held: Message[] = [], firstSeen = deferred<void>(), secondSeen = deferred<void>();
  const f = fixture({ handle(message) { held.push(message); if (held.length === 1) firstSeen.resolve(); else secondSeen.resolve(); } });
  try {
    const abort = new AbortController(), first = f.transport.accountRead({ ...f.request({ signal: abort.signal }), refreshToken: false });
    await firstSeen.promise; abort.abort(); await expect(first).rejects.toThrow("ABORTED");
    const second = f.transport.accountRead({ ...f.request({ accountGeneration: 9 }), refreshToken: false });
    await secondSeen.promise;
    f.emit({ id: held[0]!.id, result: { stale: true } });
    f.emit({ id: held[1]!.id, result: { current: true } });
    expect(await second).toMatchObject({ accountGeneration: 9, value: { current: true } });
    expect(f.events).toHaveLength(0);
  } finally { await f.close(); }
});

test("a queued request cannot write after its deadline behind an unsettled callback", async () => {
  const blocked = deferred<void>(), callbacks: (() => void)[] = [], seen: Message[] = [];
  const f = fixture({ write(message, callback) {
    if (message.method !== "account/read") return false;
    seen.push(message); callbacks.push(callback); blocked.resolve(); return true;
  } });
  try {
    await f.initialized;
    const firstAbort = new AbortController(), first = f.transport.accountRead({ ...f.request({ signal: firstAbort.signal }), refreshToken: false });
    await blocked.promise;
    const next = f.transport.accountRead({ ...f.request({ deadlineMs: Date.now() + 20 }), refreshToken: false });
    await expect(next).rejects.toThrow("TIMEOUT");
    firstAbort.abort(); await expect(first).rejects.toThrow("ABORTED");
    callbacks[0]!();
    await f.close(); expect(seen).toHaveLength(1);
  } finally { for (const callback of callbacks.splice(1)) callback(); await f.close(); }
});

test("close cancels readiness wait and joins a handle that was returned before launch", async () => {
  const ready = deferred<void>(), f = fixture({ ready: ready.promise });
  const close = await f.close();
  expect(close).toEqual({ binding, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true,
    writesSettled: true, requestsSettled: true, notificationsSettled: true });
  expect(f.messages).toHaveLength(0); ready.resolve();
});

test("close holds custody for a stalled write and allows a later independently joined retry", async () => {
  const blocked = deferred<void>(); let callback: (() => void) | undefined;
  const f = fixture({ write(message, done) {
    if (message.method !== "account/read") return false;
    callback = done; blocked.resolve(); return true;
  } });
  const call = f.transport.accountRead({ ...f.request(), refreshToken: false }); await blocked.promise;
  const rejected = call.catch(error => error);
  const first = await f.close(20); expect((await rejected).message).toContain("CLOSED");
  expect(first.writesSettled).toBe(false);
  callback!();
  expect((await f.close()).writesSettled).toBe(true); expect(f.stops()).toBe(2);
});

test("a mismatched native stop receipt never proves process or stream custody", async () => {
  const f = fixture({ stop: async finish => ({ ...finish(), binding: { ...binding, processGeneration: 99 } }) });
  await f.initialized; const receipt = await f.close();
  expect(receipt.processExited).toBe(false); expect(receipt.processGroupStopped).toBe(false);
  expect(receipt.stdoutEnded).toBe(false); expect(receipt.stderrEnded).toBe(false);
});

test("close joins pending requests and reentrant notification callbacks once", async () => {
  let f: ReturnType<typeof fixture>, closing: Promise<unknown> | undefined;
  f = fixture({ onEvent() { closing = f.close(); } });
  await f.initialized;
  f.emit({ method: "account/updated", params: {} });
  const receipt = await closing;
  expect(receipt).toMatchObject({ notificationsSettled: true, processGroupStopped: true }); expect(f.stops()).toBe(1);
});

test("RPC provider error prose is discarded while a subsequent account read remains possible", async () => {
  let calls = 0;
  const f = fixture({ handle(message, emit) { emit(++calls === 1 ? { id: message.id, error: { code: -32000, message: "sensitive provider diagnostic", data: { secret: "never expose" } } }
    : { id: message.id, result: { account: null, requiresOpenaiAuth: true } }); } });
  try {
    await expect(f.transport.accountRead({ ...f.request(), refreshToken: false })).rejects.toThrow("CODEX_ACCOUNT_RPC_FAILED");
    expect((await f.transport.accountRead({ ...f.request(), refreshToken: false })).value).toEqual({ account: null, requiresOpenaiAuth: true });
    expect(f.events).toHaveLength(0);
  } finally { await f.close(); }
});

test("request identity and cancellation are snapshotted before asynchronous initialization", async () => {
  const ready = deferred<void>(), originalAbort = new AbortController(), f = fixture({ ready: ready.promise });
  try {
    const request = { ...f.request({ signal: originalAbort.signal }), refreshToken: false as const };
    const call = f.transport.accountRead(request);
    request.accountGeneration = 99; request.signal = new AbortController().signal; request.deadlineMs = Date.now() + 120_000;
    originalAbort.abort(); await expect(call).rejects.toThrow("ABORTED"); ready.resolve();
    await f.initialized; expect(f.messages.every(message => ["initialize", "initialized"].includes(message.method))).toBe(true);
  } finally { ready.resolve(); await f.close(); }
});

test("failed initialization is stopped and cannot open account RPC admission", async () => {
  const f = fixture({ write(message, callback) {
    if (message.method !== "initialize") return false;
    callback(); return true;
  }, initializeTimeoutMs: 20 });
  await expect(f.transport.accountRead({ ...f.request(), refreshToken: false })).rejects.toThrow();
  await f.stopStarted;
  expect(f.messages.map(message => message.method)).toEqual(["initialize"]);
  expect((await f.close()).processGroupStopped).toBe(true);
});

test("pending request capacity rejects excess work without writing it", async () => {
  const held: Message[] = [], filled = deferred<void>(), f = fixture({ handle(message) { held.push(message); if (held.length === 4) filled.resolve(); } });
  try {
    await f.initialized;
    const calls = Array.from({ length: 4 }, () => f.transport.accountRead({ ...f.request(), refreshToken: false }));
    await filled.promise;
    await expect(f.transport.accountRead({ ...f.request(), refreshToken: false })).rejects.toThrow("REQUEST_LIMIT");
    for (const message of held) f.emit({ id: message.id, result: {} });
    await Promise.all(calls); expect(held).toHaveLength(4);
  } finally { await f.close(); }
});

test("an async notification listener cannot claim joined work while its promise is still pending", async () => {
  const notification = deferred<void>();
  const f = fixture({ onEvent: () => notification.promise });
  await f.initialized;
  f.emit({ method: "account/updated", params: {} });
  await f.stopStarted;
  const incomplete = await f.close(20);
  expect(incomplete.notificationsSettled).toBe(false);
  notification.resolve();
  expect((await f.close()).notificationsSettled).toBe(true);
});

test("a newer native stop receipt cannot release a prior timed-out stop task", async () => {
  const firstStop = deferred<CodexAccountProcessCloseReceipt>(); let attempts = 0;
  const f = fixture({ stop: async finish => ++attempts === 1 ? firstStop.promise : finish() });
  try {
    await f.initialized;
    expect((await f.close(20)).processGroupStopped).toBe(false);
    const second = await f.close(20);
    expect(f.stopped()).toBe(true);
    expect(second.processGroupStopped).toBe(false); expect(second.requestsSettled).toBe(false);
    firstStop.resolve({ binding, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true });
    const third = await f.close();
    expect(third.processGroupStopped).toBe(true); expect(third.requestsSettled).toBe(true); expect(f.stops()).toBe(3);
  } finally {
    firstStop.resolve({ binding, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true });
    await f.close();
  }
});

test.each(["partial-known", "indeterminate"] as const)("an early RPC reply cannot turn a %s write into success", async outcome => {
  const f = fixture(); await f.initialized;
  f.port.write = async bytes => {
    const message: Message = JSON.parse(Buffer.from(bytes).toString());
    f.emit({ id: message.id, result: { synthetic: "reply before byte receipt" } });
    return { outcome, acceptedBytes: 1 };
  };
  await expect(f.transport.accountRead({ ...f.request(), refreshToken: false })).rejects.toThrow("WRITE_FAILED");
  await f.stopStarted;
  await expect(f.transport.accountRead({ ...f.request(), refreshToken: false })).rejects.toThrow("CLOSED");
  expect((await f.close()).processGroupStopped).toBe(true);
});

test("a reply followed by an unsettled write still obeys the caller deadline", async () => {
  const reply = deferred<void>(); let completeWrite!: () => void;
  const f = fixture(); await f.initialized;
  f.port.write = bytes => {
    const message: Message = JSON.parse(Buffer.from(bytes).toString());
    f.emit({ id: message.id, result: { synthetic: "early reply" } }); reply.resolve();
    return new Promise(resolve => { completeWrite = () => resolve({ outcome: "accepted-full", acceptedBytes: bytes.byteLength }); });
  };
  const call = f.transport.accountRead({ ...f.request({ deadlineMs: Date.now() + 20 }), refreshToken: false });
  await reply.promise; await expect(call).rejects.toThrow("TIMEOUT");
  expect((await f.close(20)).writesSettled).toBe(false);
  completeWrite(); expect((await f.close()).writesSettled).toBe(true);
});
