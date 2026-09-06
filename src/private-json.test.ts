import { describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, constants, truncateSync, type Stats } from "node:fs";
import * as nativeFs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readStablePrivateFile, readStablePrivateJson } from "./private-json.ts";

const label = "Synthetic private input";
const maximumBytes = 128 * 1024;

type ReadFixture = Readonly<{
  afterOpenedStat?: (path: string) => void;
  atEof?: (path: string) => Promise<void>;
  closeFailure?: Error;
  maximumRead?: number;
  readFailure?: Error;
}>;

/** The calls the production reader makes, projected from a real FileHandle. */
type TracedDescriptor = {
  stat(): Promise<Stats>;
  read(options: {
    buffer: Uint8Array; offset: number; length: number; position: number;
  }): Promise<{ bytesRead: number; buffer: Uint8Array }>;
  readFile(): Promise<Uint8Array>;
  close(): Promise<void>;
};

async function withPrivateFile(
  body: string | Uint8Array,
  fixture: ReadFixture,
  check: (path: string, evidence: {
    bytesRead: number;
    closes: number;
    eofReads: number;
    maximumBufferBytes: number;
    openFlags: number | undefined;
    readFileCalls: number;
    reads: number;
  }) => Promise<void>,
): Promise<void> {
  const root = await nativeFs.mkdtemp(join(tmpdir(), "message-like-me-private-json-"));
  const path = join(root, "input.json");
  const evidence = {
    bytesRead: 0, closes: 0, eofReads: 0, maximumBufferBytes: 0,
    openFlags: undefined as number | undefined, readFileCalls: 0, reads: 0,
  };
  const originalOpen = nativeFs.open;
  let openedHandle: nativeFs.FileHandle | undefined;
  const restore: (() => void)[] = [];
  try {
    await nativeFs.writeFile(path, body, { mode: 0o600 });
    const open = spyOn(nativeFs, "open").mockImplementation(async (...arguments_) => {
      const handle = await originalOpen(...arguments_);
      if (arguments_[0] !== path) return handle;
      openedHandle = handle;
      const descriptor: TracedDescriptor = handle;
      if (typeof arguments_[1] === "number") evidence.openFlags = arguments_[1];
      const originalStat = descriptor.stat.bind(descriptor);
      let sampled = false;
      const stat = spyOn(descriptor, "stat").mockImplementation(async () => {
        const metadata = await originalStat();
        if (!sampled) {
          sampled = true;
          fixture.afterOpenedStat?.(path);
        }
        return metadata;
      });
      const originalRead = descriptor.read.bind(descriptor);
      const read = spyOn(descriptor, "read").mockImplementation(async (options) => {
        if (options?.buffer === undefined || options.length === undefined) {
          throw new Error("Synthetic reader fixture requires an explicit bounded buffer");
        }
        if (fixture.readFailure !== undefined) throw fixture.readFailure;
        evidence.reads += 1;
        evidence.maximumBufferBytes = Math.max(evidence.maximumBufferBytes, options.buffer.byteLength);
        const result = await originalRead({
          ...options,
          length: Math.min(options.length, fixture.maximumRead ?? options.length),
        });
        evidence.bytesRead += result.bytesRead;
        if (result.bytesRead === 0) {
          evidence.eofReads += 1;
          await fixture.atEof?.(path);
        }
        return result;
      });
      const originalReadFile = descriptor.readFile.bind(descriptor);
      const readFile = spyOn(descriptor, "readFile").mockImplementation(async () => {
        evidence.readFileCalls += 1;
        const bytes = await originalReadFile();
        evidence.bytesRead += bytes.byteLength;
        return bytes;
      });
      const originalClose = descriptor.close.bind(descriptor);
      const close = spyOn(descriptor, "close").mockImplementation(async () => {
        evidence.closes += 1;
        await originalClose();
        if (fixture.closeFailure !== undefined) throw fixture.closeFailure;
      });
      restore.push(() => stat.mockRestore(), () => read.mockRestore(),
        () => readFile.mockRestore(), () => close.mockRestore());
      return handle;
    });
    restore.push(() => open.mockRestore());
    await check(path, evidence);
  } finally {
    for (const reset of restore.reverse()) reset();
    try {
      if (openedHandle !== undefined) {
        await expect(openedHandle.stat()).rejects.toMatchObject({ code: "EBADF" });
      }
    } finally {
      if (openedHandle !== undefined && openedHandle.fd !== -1) await openedHandle.close();
      await nativeFs.rm(root, { recursive: true, force: true });
    }
  }
}

describe("bounded stable private descriptor reads", () => {
  test("rejects an empty file before opening a descriptor", async () => {
    await withPrivateFile("", {}, async (path, evidence) => {
      await expect(readStablePrivateFile(path, label, maximumBytes)).rejects.toMatchObject({
        kind: "invalid-data", message: `${label} must be within its private file-size bound`,
      });
      expect(evidence.openFlags).toBeUndefined();
      expect(evidence.closes).toBe(0);
    });
  });

  test("retains stable bytes at the exact admitted limit and proves EOF", async () => {
    const body = "s".repeat(maximumBytes);
    await withPrivateFile(body, {}, async (path, evidence) => {
      const bytes = await readStablePrivateFile(path, label, maximumBytes);
      expect(bytes).toEqual(new TextEncoder().encode(body));
      expect((evidence.openFlags ?? 0) & constants.O_NOFOLLOW).toBe(constants.O_NOFOLLOW);
      expect(evidence.bytesRead).toBe(maximumBytes);
      expect(evidence.maximumBufferBytes).toBe(maximumBytes);
      expect(evidence.eofReads).toBe(1);
      expect(evidence.readFileCalls).toBe(0);
      expect(evidence.closes).toBe(1);
    });
  });

  test("joins actual short reads without losing bytes or skipping the EOF probe", async () => {
    const body = '{"synthetic":"short reads"}\n';
    await withPrivateFile(body, { maximumRead: 3 }, async (path, evidence) => {
      expect(await readStablePrivateJson(path, label, maximumBytes)).toEqual({ synthetic: "short reads" });
      expect(evidence.reads).toBe(Math.ceil(body.length / 3) + 1);
      expect(evidence.bytesRead).toBe(body.length);
      expect(evidence.eofReads).toBe(1);
      expect(evidence.readFileCalls).toBe(0);
      expect(evidence.closes).toBe(1);
    });
  });

  test("growth after the admitted stat cannot make the reader consume beyond captured size plus one", async () => {
    const body = '{"synthetic":"bounded"}';
    await withPrivateFile(body, {
      afterOpenedStat: path => appendFileSync(path, "x".repeat(maximumBytes * 2)),
    }, async (path, evidence) => {
      await expect(readStablePrivateFile(path, label, maximumBytes)).rejects.toMatchObject({
        kind: "unsafe-path", message: `${label} changed while it was read`,
      });
      expect(evidence.bytesRead).toBe(body.length + 1);
      expect(evidence.maximumBufferBytes).toBeLessThanOrEqual(body.length);
      expect(evidence.readFileCalls).toBe(0);
      expect(evidence.closes).toBe(1);
      expect((await nativeFs.lstat(path)).size).toBe(body.length + maximumBytes * 2);
    });
  });

  for (const remainingBytes of [0, 4]) {
    test(`premature EOF after ${remainingBytes} bytes rejects instead of returning padding`, async () => {
      const body = '{"synthetic":"truncated"}';
      await withPrivateFile(body, {
        afterOpenedStat: path => truncateSync(path, remainingBytes), maximumRead: 2,
      }, async (path, evidence) => {
        await expect(readStablePrivateFile(path, label, maximumBytes)).rejects.toMatchObject({
          kind: "unsafe-path", message: `${label} changed while it was read`,
        });
        expect(evidence.bytesRead).toBe(remainingBytes);
        expect(evidence.eofReads).toBe(1);
        expect(evidence.closes).toBe(1);
      });
    });
  }

  test("path replacement after EOF is still refused and the opened descriptor closes", async () => {
    await withPrivateFile('{"synthetic":true}', {
      atEof: async path => {
        await nativeFs.rename(path, `${path}.original`);
        await nativeFs.writeFile(path, '{"synthetic":true}', { mode: 0o600 });
      },
    }, async (path, evidence) => {
      await expect(readStablePrivateFile(path, label, maximumBytes)).rejects.toMatchObject({
        kind: "unsafe-path", message: `${label} changed while it was read`,
      });
      expect(evidence.closes).toBe(1);
    });
  });

  test("retains descriptor-read failure identity when close succeeds", async () => {
    const failure = new Error("Synthetic descriptor read failure");
    await withPrivateFile("synthetic", { readFailure: failure }, async (path, evidence) => {
      await expect(readStablePrivateFile(path, label, maximumBytes)).rejects.toBe(failure);
      expect(evidence.closes).toBe(1);
    });
  });

  for (const readFails of [false, true]) {
    test(`native close failure retains precedence when read ${readFails ? "fails" : "succeeds"}`, async () => {
      const closeFailure = new Error("Synthetic descriptor close failure");
      await withPrivateFile("synthetic", {
        closeFailure,
        ...(readFails ? { readFailure: new Error("Synthetic descriptor read failure") } : {}),
      }, async (path, evidence) => {
        await expect(readStablePrivateFile(path, label, maximumBytes)).rejects.toBe(closeFailure);
        expect(evidence.closes).toBe(1);
      });
    });
  }
});
