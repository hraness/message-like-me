import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber, Ref } from "effect";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandArtifacts, commandArtifactsLive } from "./command-artifacts.ts";
import { commandFailure } from "./command-failure.ts";
import { CliError } from "./errors.ts";
import type { PublicationReport } from "./private-publication.ts";

const failure = commandFailure(new CliError("conflict", "Synthetic receipt failure"));

describe("command publication scope", () => {
  for (const confirmation of ["absent", "committed", "different", "unproven"] as const) {
    test(`reconciles a failed receipt with ${confirmation} durable state`, async () => {
      const root = await mkdtemp(join(tmpdir(), "message-like-me-reconcile-"));
      const file = join(root, "packet.json");
      let recordCalls = 0;
      let confirmCalls = 0;
      try {
        const result = await Effect.runPromise(Effect.gen(function* () {
          const reports = yield* Ref.make<readonly PublicationReport[]>([]);
          const outcome = yield* Effect.exit(Effect.scoped(Effect.gen(function* () {
            const artifacts = yield* CommandArtifacts;
            return yield* artifacts.publishWithReceipt(file, "synthetic private body",
              Effect.sync(() => { recordCalls++; }).pipe(Effect.zipRight(Effect.fail(failure))),
              Effect.sync(() => { confirmCalls++; }).pipe(Effect.zipRight(
                confirmation === "unproven" ? Effect.fail(failure) : Effect.succeed(confirmation),
              )));
          }).pipe(Effect.provide(commandArtifactsLive(reports)))));
          return { outcome, reports: yield* Ref.get(reports) };
        }));
        expect(Exit.isFailure(result.outcome)).toBe(true);
        expect(recordCalls).toBe(1);
        expect(confirmCalls).toBe(1);
        expect(result.reports).toHaveLength(1);
        expect(result.reports[0]).toMatchObject({ receipt: confirmation, cleanup: confirmation === "absent" ? "removed" : "retained" });
        expect(JSON.stringify(result.reports)).not.toContain(root);
        expect(JSON.stringify(result.reports)).not.toContain("synthetic private body");
        if (confirmation === "absent") expect(await readdir(root)).toEqual([]);
        else expect(await readFile(file, "utf8")).toBe("synthetic private body");
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }

  test("rolls back the first evaluation artifact when the second destination exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-pair-"));
    try {
      const first = join(root, "prompt.json");
      const second = join(root, "reference.json");
      await writeFile(second, "existing reference", { mode: 0o600 });
      const reports = await Effect.runPromise(Effect.gen(function* () {
        const reports = yield* Ref.make<readonly PublicationReport[]>([]);
        const result = yield* Effect.exit(Effect.scoped(Effect.gen(function* () {
          const artifacts = yield* CommandArtifacts;
          yield* artifacts.writePair([{ path: first, bytes: "prompt" }, { path: second, bytes: "reference" }]);
        }).pipe(Effect.provide(commandArtifactsLive(reports)))));
        expect(Exit.isFailure(result)).toBe(true);
        return yield* Ref.get(reports);
      }));
      expect(reports).toHaveLength(1);
      expect(reports[0]?.cleanup).toBe("removed");
      expect(await readdir(root)).toEqual(["reference.json"]);
      expect(await readFile(second, "utf8")).toBe("existing reference");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

test("defers interruption across receipt commitment and retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "message-like-me-interrupt-"));
  const file = join(root, "packet.json");
  try {
    const reports = await Effect.runPromise(Effect.gen(function* () {
      const reports = yield* Ref.make<readonly PublicationReport[]>([]);
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const fiber = yield* Effect.fork(Effect.scoped(Effect.gen(function* () {
        const artifacts = yield* CommandArtifacts;
        yield* artifacts.publishWithReceipt(file, "synthetic committed body",
          Deferred.succeed(started, undefined).pipe(Effect.zipRight(Deferred.await(finish))),
          Effect.succeed("committed" as const));
      }).pipe(Effect.provide(commandArtifactsLive(reports)))));
      yield* Deferred.await(started);
      const interruption = yield* Effect.fork(Fiber.interrupt(fiber));
      yield* Effect.yieldNow();
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(interruption);
      return yield* Ref.get(reports);
    }));
    expect(reports).toEqual([]);
    expect(await readFile(file, "utf8")).toBe("synthetic committed body");
  } finally { await rm(root, { recursive: true, force: true }); }
});
