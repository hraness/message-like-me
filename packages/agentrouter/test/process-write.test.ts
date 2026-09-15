import { expect, test } from "bun:test";
import { createProcessWriteQueue } from "../src/process-write.ts";
import type { ProviderProcessWriteResult } from "../src/process-port.ts";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("writes copy bytes and serialize full acceptance at the last active fence", async () => {
  const receipt = deferred<ProviderProcessWriteResult>(), calls: Uint8Array[] = [];
  let assertions = 0;
  const queue = createProcessWriteQueue({ timeoutMs: 1000, assertActive() { assertions++; }, failed() {},
    write(bytes) { calls.push(bytes); return calls.length === 1 ? receipt.promise : Promise.resolve({ outcome: "accepted-full", acceptedBytes: bytes.length }); } });
  const bytes = new Uint8Array([1, 2]); const first = queue.write(bytes), second = queue.write(new Uint8Array([3]));
  bytes[0] = 9; await Promise.resolve();
  expect(calls).toEqual([new Uint8Array([1, 2])]); expect(assertions).toBe(1);
  receipt.resolve({ outcome: "accepted-full", acceptedBytes: 2 }); await first; await second; await queue.settled();
  expect(calls).toEqual([new Uint8Array([1, 2]), new Uint8Array([3])]); expect(assertions).toBe(2);
});

test.each(["partial-known", "indeterminate", "refused-before-write"] as const)("%s closes the queue without replay", async outcome => {
  let calls = 0, failures = 0;
  const queue = createProcessWriteQueue({ timeoutMs: 1000, assertActive() {}, failed() { failures++; },
    async write() { calls++; return { outcome, acceptedBytes: outcome === "partial-known" ? 1 : 0 }; } });
  const first = queue.write(new Uint8Array([1, 2])), second = queue.write(new Uint8Array([3]));
  void first.catch(() => {}); void second.catch(() => {});
  await expect(first).rejects.toThrow("UNACCEPTED"); await expect(second).rejects.toThrow("CLOSED");
  await queue.settled(); expect(calls).toBe(1); expect(failures).toBeGreaterThan(0);
});

test("deadline revokes queued input while retaining the unsettled first write", async () => {
  const receipt = deferred<ProviderProcessWriteResult>(); let calls = 0, settled = false;
  const queue = createProcessWriteQueue({ timeoutMs: 10, assertActive() {}, failed() {}, write() { calls++; return receipt.promise; } });
  const first = queue.write(new Uint8Array([1])), second = queue.write(new Uint8Array([2]));
  void first.catch(() => {}); void second.catch(() => {});
  await expect(first).rejects.toThrow("DEADLINE");
  const joining = queue.settled().then(() => { settled = true; }); await Promise.resolve(); expect(settled).toBe(false);
  receipt.resolve({ outcome: "accepted-full", acceptedBytes: 1 });
  await expect(second).rejects.toThrow(); await joining; expect(calls).toBe(1);
});
