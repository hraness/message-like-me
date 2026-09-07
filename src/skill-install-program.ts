import { Context, Effect, Exit } from "effect";
import type { CommandFailure } from "./command-failure.ts";
import {
  SKILL_INSTALL_PAIR,
  type SkillInstallCleanupPhase,
  type SkillInstallName,
  type SkillInstallOutcome,
  type SkillInstallPlan,
  type SkillInstallResidual,
  type SkillInstallTransaction,
} from "./skill-install-model.ts";
import type { SkillInstallDestinations, SkillInstallOptions } from "./skill-install.ts";

export interface SkillInstallPlatformService {
  preflight(options: SkillInstallOptions): Effect.Effect<SkillInstallPlan, CommandFailure>;
  transaction(plan: SkillInstallPlan): Effect.Effect<SkillInstallTransaction, CommandFailure>;
  acquire(transaction: SkillInstallTransaction): Effect.Effect<void, CommandFailure>;
  copy(transaction: SkillInstallTransaction, skill: SkillInstallName): Effect.Effect<void, CommandFailure>;
  backup(transaction: SkillInstallTransaction, skill: SkillInstallName): Effect.Effect<void, CommandFailure>;
  publish(transaction: SkillInstallTransaction, skill: SkillInstallName): Effect.Effect<void, CommandFailure>;
  cleanup(transaction: SkillInstallTransaction, skill: SkillInstallName | "pair", phase: SkillInstallCleanupPhase): Effect.Effect<void, CommandFailure>;
  destinations(transaction: SkillInstallTransaction): Effect.Effect<SkillInstallDestinations, CommandFailure>;
}

export class SkillInstallPlatform extends Context.Tag("@hraness/message-like-me/SkillInstallPlatform")<
  SkillInstallPlatform, SkillInstallPlatformService
>() {}

/** The fixed pair has one commit latch; no cleanup path can replay a mutation. */
export function installSkillProgram(options: SkillInstallOptions): Effect.Effect<SkillInstallOutcome, never, SkillInstallPlatform> {
  return Effect.uninterruptible(Effect.gen(function* () {
    const platform = yield* SkillInstallPlatform;
    const prepared = yield* Effect.exit(platform.preflight(options).pipe(Effect.flatMap(plan => platform.transaction(plan))));
    if (Exit.isFailure(prepared)) return { operation: Exit.failCause(prepared.cause), committed: false, residuals: [] };
    const transaction = prepared.value;
    let committed = false;
    const operation = yield* Effect.exit(Effect.gen(function* () {
      yield* platform.acquire(transaction);
      for (const skill of SKILL_INSTALL_PAIR) yield* platform.copy(transaction, skill);
      for (const skill of SKILL_INSTALL_PAIR) yield* platform.backup(transaction, skill);
      for (const skill of SKILL_INSTALL_PAIR) yield* platform.publish(transaction, skill);
      // Both native publish acknowledgements commit before cleanup or realpath.
      committed = true;
    }));
    const residuals: SkillInstallResidual[] = [];
    const cleanup = (skill: SkillInstallName | "pair", phase: SkillInstallCleanupPhase) => Effect.gen(function* () {
      const result = yield* Effect.exit(platform.cleanup(transaction, skill, phase));
      if (Exit.isFailure(result)) residuals.push({ skill, phase, cause: result.cause });
    });
    if (!committed) {
      for (const skill of [...SKILL_INSTALL_PAIR].reverse()) {
        yield* cleanup(skill, "rollback-published");
        yield* cleanup(skill, "restore-backup");
        yield* cleanup(skill, "stage-cleanup");
      }
    } else {
      for (const skill of SKILL_INSTALL_PAIR) yield* cleanup(skill, "backup-cleanup");
    }
    const output = Exit.isFailure(operation) ? Exit.failCause(operation.cause) : yield* Effect.exit(platform.destinations(transaction));
    yield* cleanup("pair", "transaction-cleanup");
    yield* cleanup("pair", "lock-cleanup");
    return { operation: output, committed, residuals };
  }));
}
