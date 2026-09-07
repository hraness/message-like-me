import { Cause, Effect, Exit, Layer, Option, Ref } from "effect";

import { commandFailure, type CommandFailure } from "./command-failure.ts";
import { commandPlatformLive } from "./command-platform.ts";
import { commandProgram } from "./command-program.ts";
import { commandArtifactsLive } from "./command-artifacts.ts";
import { CliError } from "./errors.ts";
import type { CommandIo } from "./io.ts";
import { PrivatePublicationError, type PublicationReport } from "./private-publication.ts";

export { HELP } from "./command-input.ts";

type CommandOutcome = Readonly<{
  operation: Exit.Exit<void, CommandFailure>;
  cleanupFailure: CommandFailure | null;
  publications: readonly PublicationReport[];
}>;

function executeCommand(argv: readonly string[], io: CommandIo): Effect.Effect<CommandOutcome, never, never> {
  return Effect.gen(function* () {
    const cleanupFailure = yield* Ref.make<CommandFailure | null>(null);
    const publications = yield* Ref.make<readonly PublicationReport[]>([]);
    const result = yield* Effect.exit(Effect.scoped(commandProgram(argv).pipe(
      Effect.provide(Layer.merge(commandPlatformLive(io, cleanupFailure), commandArtifactsLive(publications))),
      // Pure validators retain their existing CliError contract. Unknown
      // defects keep their own channel and are never silently made successful.
      Effect.catchAllDefect((defect) => defect instanceof CliError
        ? Effect.fail(commandFailure(defect))
        : Effect.die(defect)),
    )));
    // The former finally blocks gave close failures precedence over a command
    // failure. Keep that public behavior without an unobserved finalizer error.
    return { operation: result, cleanupFailure: yield* Ref.get(cleanupFailure), publications: yield* Ref.get(publications) };
  });
}

/** One command owns one scope and one Promise boundary. */
export async function runCommand(argv: readonly string[], io: CommandIo): Promise<void> {
  const result = await runClosed(executeCommand(argv, io));
  let failure: unknown;
  if (result.cleanupFailure !== null) failure = result.cleanupFailure.cause;
  else if (Exit.isSuccess(result.operation)) return;
  else {
    const expected = Cause.failureOption(result.operation.cause);
    failure = Option.isSome(expected) ? expected.value.cause : Cause.squash(result.operation.cause);
  }
  if (result.publications.length > 0) throw new PrivatePublicationError(failure, result.publications);
  throw failure;
}

function runClosed<A>(effect: Effect.Effect<A, never, never>): Promise<A> {
  return Effect.runPromise(effect);
}
