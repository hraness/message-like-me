import { Context, Effect, Exit, Layer, Ref, type Scope } from "effect";

import { commandFailure, type CommandFailure } from "./command-failure.ts";
import { discardPrivatePublication, publishPrivateArtifact, type PrivatePublication } from "./paths.ts";
import type { PublicationCleanup, PublicationReport, ReceiptState } from "./private-publication.ts";

type PendingPublication = Readonly<{ publication: PrivatePublication; retained: Ref.Ref<boolean> }>;
type ReceiptConfirmation = "absent" | "committed" | "different";
export interface CommandArtifactsService {
  write(path: string, bytes: string): Effect.Effect<void, CommandFailure, Scope.Scope>;
  writePair(files: readonly [Readonly<{ path: string; bytes: string }>, Readonly<{ path: string; bytes: string }>]): Effect.Effect<void, CommandFailure, Scope.Scope>;
  publishWithReceipt<A>(path: string, bytes: string, record: Effect.Effect<A, CommandFailure>,
    confirm: Effect.Effect<ReceiptConfirmation, CommandFailure>): Effect.Effect<A, CommandFailure, Scope.Scope>;
}
export class CommandArtifacts extends Context.Tag("@hraness/message-like-me/CommandArtifacts")<CommandArtifacts, CommandArtifactsService>() {}

/** The file publication and the SQL receipt have separate, observable outcomes. */
export function commandArtifactsLive(reports: Ref.Ref<readonly PublicationReport[]>): Layer.Layer<CommandArtifacts> {
  const append = (publication: PrivatePublication, receipt: ReceiptState, cleanup: PublicationCleanup): Effect.Effect<void> =>
    Ref.update(reports, (current) => [...current, { ...publication, receipt, cleanup }]);
  const discard = (publication: PrivatePublication): Effect.Effect<PublicationCleanup> => Effect.tryPromise({
    try: () => discardPrivatePublication(publication), catch: commandFailure,
  }).pipe(Effect.match({ onFailure: () => "retained-unproven" as const, onSuccess: (result) => result }));
  const acquire = (path: string, bytes: string): Effect.Effect<PendingPublication, CommandFailure, Scope.Scope> => Effect.acquireRelease(
    Effect.gen(function* () {
      const publication = yield* Effect.tryPromise({ try: () => publishPrivateArtifact(path, bytes), catch: commandFailure });
      return { publication, retained: yield* Ref.make(false) };
    }),
    (pending) => Effect.gen(function* () {
      if (!(yield* Ref.get(pending.retained))) {
        const cleanup = yield* discard(pending.publication);
        yield* append(pending.publication, "not-attempted", cleanup);
      }
    }),
  );
  return Layer.succeed(CommandArtifacts, {
    write: (path, bytes) => Effect.gen(function* () {
      const pending = yield* acquire(path, bytes);
      yield* Ref.set(pending.retained, true);
    }),
    writePair: (files) => Effect.gen(function* () {
      const first = yield* acquire(files[0].path, files[0].bytes);
      const second = yield* acquire(files[1].path, files[1].bytes);
      yield* Effect.uninterruptible(Effect.all([Ref.set(first.retained, true), Ref.set(second.retained, true)]));
    }),
    publishWithReceipt: <A>(path: string, bytes: string, record: Effect.Effect<A, CommandFailure>,
      confirm: Effect.Effect<ReceiptConfirmation, CommandFailure>): Effect.Effect<A, CommandFailure, Scope.Scope> => Effect.uninterruptible(Effect.gen(function* () {
      const pending = yield* acquire(path, bytes);
      const recorded = yield* Effect.exit(record);
      if (Exit.isSuccess(recorded)) {
        yield* Ref.set(pending.retained, true);
        return recorded.value;
      }
      // A thrown audit read may follow a committed SQL transaction. Never use
      // the throw alone as proof that publication is safe to remove.
      const confirmed = yield* Effect.exit(confirm);
      const receipt = Exit.isSuccess(confirmed) ? confirmed.value : "unproven";
      const cleanup = receipt === "absent" ? yield* discard(pending.publication) : "retained";
      yield* Ref.set(pending.retained, true);
      yield* append(pending.publication, receipt, cleanup);
      return yield* recorded;
    })),
  });
}
