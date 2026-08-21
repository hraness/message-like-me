import { cp, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.ts";

export type SkillTarget = "codex" | "claude" | "agents";
export type SkillScope = "user" | "project";

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function bundledSkillPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../skills/message-like-me");
}

function targetRoot(target: SkillTarget, scope: SkillScope, projectDirectory: string): string {
  const directory = target === "codex" ? ".codex" : target === "claude" ? ".claude" : ".agents";
  return scope === "user"
    ? join(homedir(), directory, "skills")
    : join(resolve(projectDirectory), directory, "skills");
}

export async function installSkill(options: Readonly<{
  target: SkillTarget;
  scope: SkillScope;
  projectDirectory?: string;
  force?: boolean;
}>): Promise<string> {
  const source = bundledSkillPath();
  if (!(await exists(source))) throw new CliError("not-found", `Bundled skill is missing at ${source}`);
  const sourceMetadata = await lstat(source);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new CliError("unsafe-path", "Bundled skill must be a physical directory");
  }
  const root = targetRoot(options.target, options.scope, options.projectDirectory ?? process.cwd());
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destination = join(root, "message-like-me");
  if (await exists(destination)) {
    const metadata = await lstat(destination);
    if (metadata.isSymbolicLink()) {
      throw new CliError("unsafe-path", `Refusing to replace symbolic link ${destination}`);
    }
    if (!options.force) {
      throw new CliError("conflict", `Skill already exists at ${destination}; pass --force to replace it`);
    }
    await rm(destination, { recursive: true, force: true });
  }
  await cp(source, destination, { recursive: true, errorOnExist: true });
  return realpath(destination);
}
