import { assertCodexManagedConfigResponse } from "./codex-managed-config.ts";
import type { CodexProcessHandle } from "./codex-process.ts";

export type OfflineProtocolReceipt = Readonly<{ methods: readonly string[]; configurationObserved: boolean;
  disabledNotices: number; frameCount: number; failure: string | null; joined: boolean }>;

/** Internal fixed diagnostic protocol. It cannot create a process, accept RPC
 * choices, emit model input, or return a process/stream to its caller. */
export function createManagedOfflineProtocol(process: CodexProcessHandle, accountHome: string, signal: AbortSignal, deadline: number) {
  const stdin = process.stdin!;
  if (!stdin) throw Error("OFFLINE_DIAGNOSTIC_STDIN_UNAVAILABLE");
  let closing = false, configured = false, disabledNotices = 0, frames = 0, bytes = 0, line = "", failure: string | null = null, joined = false, decoded = false;
  const methods: string[] = [], writes = new Set<Promise<void>>(), decoder = new TextDecoder("utf-8", { fatal: true });
  let revoke!: (error: Error) => void;
  const revoked = new Promise<never>((_, reject) => { revoke = reject; }); void revoked.catch(() => {});
  let pending: { id: number; resolve(value: unknown): void; reject(error: Error): void } | undefined;
  const invalid = (code: string): never => { throw Error(code); };
  function object(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 256) return invalid("OFFLINE_DIAGNOSTIC_RESPONSE_INVALID");
    return value as Record<string, unknown>;
  }
  function fail(code: string) { failure ??= code; revoke(Error(failure)); pending?.reject(Error(code)); pending = undefined; }
  function active() { if (closing || signal.aborted || failure || Date.now() >= deadline) throw Error(failure ?? "OFFLINE_DIAGNOSTIC_PROTOCOL_STOPPED"); }
  async function bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, revoked, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("OFFLINE_DIAGNOSTIC_PROTOCOL_DEADLINE")), Math.max(0, deadline - Date.now())); })]); }
    finally { clearTimeout(timer); }
  }
  function write(frame: object, method: string): Promise<void> {
    active(); methods.push(method); const encoded = JSON.stringify(frame) + "\n";
    if (methods.length > 3 || Buffer.byteLength(encoded) > 8192) return Promise.reject(Error("OFFLINE_DIAGNOSTIC_REQUEST_BOUND"));
    const work = new Promise<void>((resolve, reject) => stdin.write(encoded, error => error ? reject(Error("OFFLINE_DIAGNOSTIC_WRITE_FAILED")) : resolve()));
    writes.add(work); void work.then(() => writes.delete(work), () => writes.delete(work)); return bounded(work);
  }
  async function rpc(id: number, method: string, params: object): Promise<unknown> {
    active(); if (pending) return invalid("OFFLINE_DIAGNOSTIC_CONCURRENT_RPC");
    const result = new Promise<unknown>((resolve, reject) => { pending = { id, resolve, reject }; }); void result.catch(() => {});
    await write({ id, method, params }, method); return bounded(result);
  }
  function onData(chunk: unknown) {
    if (closing) return;
    try {
      if (!(chunk instanceof Uint8Array) || (bytes += chunk.byteLength) > 2 * 1024 * 1024) return invalid("OFFLINE_DIAGNOSTIC_RESPONSE_BOUND");
      line += decoder.decode(chunk, { stream: true }); let index: number;
      while ((index = line.indexOf("\n")) !== -1) {
        const encoded = line.slice(0, index); line = line.slice(index + 1);
        if (++frames > 32 || Buffer.byteLength(encoded) > 1024 * 1024) return invalid("OFFLINE_DIAGNOSTIC_FRAME_BOUND");
        const frame = object(JSON.parse(encoded));
        if (frame.jsonrpc !== undefined && frame.jsonrpc !== "2.0") return invalid("OFFLINE_DIAGNOSTIC_UNEXPECTED_RESPONSE");
        if (Object.hasOwn(frame, "method")) {
          if (Object.keys(frame).some(key => !["method", "params", "jsonrpc", "emittedAtMs"].includes(key))
            || frame.method !== "remoteControl/status/changed" || ++disabledNotices > 1) return invalid("OFFLINE_DIAGNOSTIC_NATIVE_OPERATION_DENIED");
          if (frame.emittedAtMs !== undefined && (!Number.isSafeInteger(frame.emittedAtMs) || Number(frame.emittedAtMs) < 0)) return invalid("OFFLINE_DIAGNOSTIC_NATIVE_OPERATION_DENIED");
          const params = object(frame.params);
          if (params.status !== "disabled" || Object.keys(params).some(key => !["status", "installationId", "serverName", "environmentId"].includes(key))) return invalid("OFFLINE_DIAGNOSTIC_NATIVE_OPERATION_DENIED");
          for (const [key, limit] of [["installationId", 160], ["serverName", 1024]] as const) {
            if (typeof params[key] !== "string" || !params[key] || Buffer.byteLength(params[key]) > limit) return invalid("OFFLINE_DIAGNOSTIC_NATIVE_OPERATION_DENIED");
          }
          if (params.environmentId != null && (typeof params.environmentId !== "string" || !params.environmentId || Buffer.byteLength(params.environmentId) > 160)) return invalid("OFFLINE_DIAGNOSTIC_NATIVE_OPERATION_DENIED");
          continue;
        }
        if (!pending || frame.id !== pending.id || Object.hasOwn(frame, "error") || !Object.hasOwn(frame, "result")
          || Object.keys(frame).some(key => !["id", "result", "jsonrpc"].includes(key))) return invalid("OFFLINE_DIAGNOSTIC_UNEXPECTED_RESPONSE");
        const current = pending; pending = undefined; current.resolve(frame.result);
      }
      if (Buffer.byteLength(line) > 1024 * 1024) return invalid("OFFLINE_DIAGNOSTIC_FRAME_BOUND");
    } catch (error) { fail(error instanceof Error && /^OFFLINE_DIAGNOSTIC_[A-Z_]+$/u.test(error.message) ? error.message : "OFFLINE_DIAGNOSTIC_RESPONSE_INVALID"); }
  }
  function finishDecoding() {
    if (decoded) return; decoded = true;
    try { line += decoder.decode(); if (line.length !== 0) fail("OFFLINE_DIAGNOSTIC_TRUNCATED_FRAME"); }
    catch { fail("OFFLINE_DIAGNOSTIC_TRUNCATED_UTF8"); }
  }
  function onEnd() { finishDecoding(); if (!closing && !configured) fail("OFFLINE_DIAGNOSTIC_PREMATURE_EXIT"); }
  function onError() { fail("OFFLINE_DIAGNOSTIC_STREAM_FAILED"); }
  function onAbort() { fail("OFFLINE_DIAGNOSTIC_CANCELLED"); }
  process.stdout.on("data", onData); process.stdout.on("end", onEnd); process.stdout.on("error", onError); stdin.on("error", onError);
  signal.addEventListener("abort", onAbort, { once: true });
  const result = Promise.resolve().then(async () => {
    await bounded(process.ready); active();
    const initialized = object(await rpc(1, "initialize", { clientInfo: { name: "agentrouter-offline-diagnostic", version: "0.1.0" }, capabilities: { experimentalApi: false, requestAttestation: false } }));
    for (const [field, limit] of [["userAgent", 1024], ["codexHome", 4096], ["platformFamily", 128], ["platformOs", 128]] as const) {
      if (typeof initialized[field] !== "string" || !initialized[field] || Buffer.byteLength(initialized[field]) > limit) return invalid("OFFLINE_DIAGNOSTIC_INITIALIZE_INVALID");
    }
    if (initialized.codexHome !== accountHome || Object.keys(initialized).some(key => !["userAgent", "codexHome", "platformFamily", "platformOs"].includes(key))) return invalid("OFFLINE_DIAGNOSTIC_INITIALIZE_INVALID");
    await write({ method: "initialized" }, "initialized");
    const configuration = await rpc(2, "config/read", { cwd: process.cwd, includeLayers: false }); active();
    assertCodexManagedConfigResponse(configuration, { cwd: process.cwd }); configured = true;
    if (disabledNotices !== 1 || line.length !== 0) return invalid("OFFLINE_DIAGNOSTIC_STARTUP_UNPROVEN");
  }).catch(error => { fail(error instanceof Error && /^OFFLINE_DIAGNOSTIC_[A-Z_]+$/u.test(error.message) ? error.message : "OFFLINE_DIAGNOSTIC_CONFIGURATION_INVALID"); throw Error(failure!); });
  void result.catch(() => {});
  function stop() {
    if (closing) return; closing = true; finishDecoding(); revoke(Error("OFFLINE_DIAGNOSTIC_PROTOCOL_STOPPED")); pending?.reject(Error("OFFLINE_DIAGNOSTIC_PROTOCOL_STOPPED")); pending = undefined;
    process.stdout.off("data", onData); process.stdout.off("end", onEnd); process.stdout.off("error", onError); stdin.off("error", onError); signal.removeEventListener("abort", onAbort);
  }
  const receipt = (): OfflineProtocolReceipt => Object.freeze({ methods: Object.freeze([...methods]), configurationObserved: configured, disabledNotices, frameCount: frames, failure, joined });
  return Object.freeze({ result, stop, async join() { stop(); await Promise.allSettled([result, ...writes]); joined = writes.size === 0; return receipt(); }, receipt });
}
