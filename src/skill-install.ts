import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type SkillTarget = "codex" | "claude" | "agents";
export type SkillScope = "user" | "project";
export type SkillInstallOptions = Readonly<{
  target: SkillTarget;
  scope: SkillScope;
  projectDirectory?: string;
  force?: boolean;
}>;
export type SkillInstallDestinations = Readonly<{ messageLikeMe: string; ensoul: string }>;

export function bundledSkillPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../skills/message-like-me");
}

export function bundledEnsoulSkillPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../skills/ensoul");
}
