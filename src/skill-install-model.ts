import type { Cause, Exit } from "effect";
import type { CommandFailure } from "./command-failure.ts";
import type { SkillInstallDestinations } from "./skill-install.ts";

export const SKILL_INSTALL_PAIR = ["message-like-me", "ensoul"] as const;
export type SkillInstallName = typeof SKILL_INSTALL_PAIR[number];
export type SkillInstallCleanupPhase = "rollback-published" | "restore-backup" | "stage-cleanup"
  | "backup-cleanup" | "transaction-cleanup" | "lock-cleanup";

/** Opaque values gain authority only through the native adapter's private maps. */
export type SkillInstallPlan = Readonly<{ _tag: "SkillInstallPlan" }>;
export type SkillInstallTransaction = Readonly<{ _tag: "SkillInstallTransaction" }>;

export type SkillInstallResidual = Readonly<{
  skill: SkillInstallName | "pair";
  phase: SkillInstallCleanupPhase;
  cause: Cause.Cause<CommandFailure>;
}>;

export type SkillInstallOutcome = Readonly<{
  operation: Exit.Exit<SkillInstallDestinations, CommandFailure>;
  committed: boolean;
  residuals: readonly SkillInstallResidual[];
}>;

/** Only fixed product states reach stderr. Paths and foreign causes stay private. */
export function skillInstallWarning(outcome: Pick<SkillInstallOutcome, "committed" | "residuals"> & Readonly<{ operation: { readonly _tag: "Failure" | "Success" } }>): string | null {
  if (outcome.residuals.length === 0 && !(outcome.committed && outcome.operation._tag === "Failure")) return null;
  const state = outcome.committed ? "committed" : "not committed";
  const details = outcome.residuals.map(({ skill, phase }) => `${skill}:${phase}`).join(", ");
  return `Skill installation ${state}; ${details.length > 0 ? `cleanup incomplete (${details})` : "output confirmation failed"}. Retained installation files need review.\n`;
}
