import { isAbsolute, resolve } from "node:path";
import { finished } from "node:stream/promises";
import { bindCodexAccountProcess } from "./codex-account-process.ts";
import type { CodexAccountProcessCloseReceipt } from "./codex-account-transport.ts";
import type { CodexProcessHandle, CodexProcessReceipt } from "./codex-process.ts";
import { snapshotProviderProcessBinding, type ProviderProcessWriteResult } from "./process-port.ts";
import { boundedText, safeInteger } from "./validation.ts";

export type CodexTaskProcessOptions = Parameters<typeof bindCodexAccountProcess>[0] & Readonly<{
  cwd: string;
  joinTimeoutMs: number;
  /** Application-owned policy, scratch and journal observations. */
  receipt(): CodexProcessReceipt;
  /** Called only after matching physical proof and settled local work. The host
   * persists closure and handles its own scratch; native join supplies neither
   * configuration qualification nor successful product finalization. */
  finalize(observation: Readonly<{
    physical: CodexAccountProcessCloseReceipt;
    operationCompleted: boolean;
  }>): Promise<CodexProcessReceipt>;
}>;

/** Bridge for a trusted CodexProcessLauncher or CodexManagedProcessLauncher.
 * The application still prepares and binds its exact task/account/profile,
 * admits the shared artifact, owns launch intent and returns an owned port even
 * when readiness fails. No launcher or qualification is inferred here. */
export function bindCodexTaskProcess(options: CodexTaskProcessOptions): CodexProcessHandle {
  const cwd = boundedText(options.cwd, 4096);
  if (!isAbsolute(cwd) || resolve(cwd) !== cwd || /[\x00-\x1f\x7f]/u.test(cwd)) throw Error("CODEX_TASK_PROCESS_CWD_INVALID");
  const timeoutMs = safeInteger(options.joinTimeoutMs, 1, 120_000);
  if (typeof options.receipt !== "function" || typeof options.finalize !== "function") throw Error("CODEX_TASK_PROCESS_POLICY_REQUIRED");
  const receipt = options.receipt.bind(options), finalize = options.finalize.bind(options);
  const invocation = snapshotProviderProcessBinding(options.invocation);
  const process = options.process;
  const account = bindCodexAccountProcess({ ...options, invocation });
  const delivery = Promise.allSettled([finished(account.stdout), finished(account.stderr)]);
  const writes = new Set<Promise<ProviderProcessWriteResult>>();
  let stopping = false, stopFailed = false, operationFailed = false, expired = false;
  let stopAttempt: Promise<CodexProcessReceipt> | undefined;
  void account.operationCompleted.catch(() => { operationFailed = true; });
  const ready = account.ready.then(() => { if (stopping) throw Error("CODEX_TASK_PROCESS_STOPPED"); });
  void ready.catch(() => {});
  const snapshot = (): CodexProcessReceipt => {
    const value = receipt();
    return Object.freeze({ ...value, cleanupErrors: Object.freeze([...value.cleanupErrors]), runtimeErrors: Object.freeze([...value.runtimeErrors]) });
  };
  return Object.freeze({ cwd, stdout: account.stdout, ready, exited: account.exited, receipt: snapshot,
    write(bytes) {
      if (stopping) return Promise.resolve({ outcome: "refused-before-write", acceptedBytes: 0 });
      const task = account.write(bytes);
      writes.add(task); void task.then(value => {
        writes.delete(task);
        if (value.outcome !== "accepted-full") operationFailed = true;
      }, () => { writes.delete(task); operationFailed = true; });
      return task;
    },
    stopAndJoin() {
      if (stopAttempt !== undefined) return stopAttempt;
      stopping = true;
      let resolveStop!: (value: CodexProcessReceipt) => void, rejectStop!: (error: unknown) => void;
      stopAttempt = new Promise((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
      // Publish ownership before either host stop or an authority assertion can
      // reenter. Revoke at the native port immediately, before any await.
      try { process.requestStop(); } catch { stopFailed = true; }
      const deadlineMs = Date.now() + timeoutMs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = (async () => {
        const physical = await account.stopAndJoin({ binding: account.binding, deadlineMs });
        const results = await Promise.allSettled([process.transportCompleted, account.operationCompleted, delivery, ...writes]);
        const completed = !operationFailed && !stopFailed && results.every(value => value.status === "fulfilled")
          && (await delivery).every(value => value.status === "fulfilled");
        if (expired) throw Error("CODEX_TASK_PROCESS_JOIN_DEADLINE");
        const value = await finalize({ physical, operationCompleted: completed });
        // Product finalization may fail independently of native proof. It must
        // retain those failures, rather than manufacture a successful task.
        if (!value.rootExited || !value.groupAbsent || !value.stdioJoined
          || (!completed && value.runtimeErrors.length === 0)) throw Error("CODEX_TASK_PROCESS_FINALIZATION_UNPROVEN");
        return Object.freeze({ ...value, cleanupErrors: Object.freeze([...value.cleanupErrors]), runtimeErrors: Object.freeze([...value.runtimeErrors]) });
      })();
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => {
        expired = true;
        try { process.forceStop(); } catch { /* A failed stop supplies no closure proof. */ }
        reject(Error("CODEX_TASK_PROCESS_JOIN_DEADLINE"));
      }, timeoutMs); });
      void Promise.race([work, timeout]).then(resolveStop, rejectStop).finally(() => clearTimeout(timer));
      return stopAttempt;
    },
  } satisfies CodexProcessHandle);
}
