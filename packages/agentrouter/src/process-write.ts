import { providerProcessWriteResult, type ProviderProcessWriteResult } from "./process-port.ts";

/** Product-owned serialization. A deadline revokes queued writes immediately;
 * the original admitted write remains owned until its receipt settles. */
export function createProcessWriteQueue(options: Readonly<{
  write(bytes: Uint8Array): Promise<ProviderProcessWriteResult>;
  assertActive(): void;
  failed(): void;
  timeoutMs: number;
}>): Readonly<{ write(bytes: Uint8Array): Promise<void>; stop(): void; settled(): Promise<void> }> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 120_000) {
    throw Error("PROVIDER_PROCESS_WRITE_TIMEOUT_INVALID");
  }
  let closed = false, tail = Promise.resolve();
  const pending = new Set<Promise<void>>();
  const failed = () => { closed = true; options.failed(); };
  return Object.freeze({
    stop() { closed = true; },
    async settled() { await Promise.allSettled([...pending]); },
    write(input) {
      if (closed || !(input instanceof Uint8Array) || input.byteLength < 1) {
        return Promise.reject(Error("PROVIDER_PROCESS_WRITE_CLOSED"));
      }
      const bytes = Uint8Array.from(input), deadline = performance.now() + options.timeoutMs;
      const task = tail.then(async () => {
        if (closed || performance.now() >= deadline) throw Error("PROVIDER_PROCESS_WRITE_CLOSED");
        options.assertActive();
        const result = providerProcessWriteResult(await options.write(bytes), bytes.byteLength);
        if (result.outcome !== "accepted-full") throw Error("PROVIDER_PROCESS_WRITE_UNACCEPTED");
      });
      pending.add(task);
      tail = task.then(() => {}, () => {});
      void task.then(() => pending.delete(task), () => { pending.delete(task); failed(); });
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { failed(); reject(Error("PROVIDER_PROCESS_WRITE_DEADLINE")); }, options.timeoutMs);
        void task.then(() => { clearTimeout(timer); resolve(); }, error => { clearTimeout(timer); reject(error); });
      });
    },
  });
}
