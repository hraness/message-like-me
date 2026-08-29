import { randomBytes } from "node:crypto";
import { cp, lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
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

export function bundledEnsoulSkillPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../skills/ensoul");
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
}>): Promise<Readonly<{
  messageLikeMe: string;
  ensoul: string;
}>> {
  const sources = Object.freeze([
    Object.freeze({ name: "message-like-me", path: bundledSkillPath() }),
    Object.freeze({ name: "ensoul", path: bundledEnsoulSkillPath() }),
  ]);
  for (const source of sources) {
    if (!(await exists(source.path))) {
      throw new CliError("not-found", `Bundled ${source.name} skill is missing at ${source.path}`);
    }
    const sourceMetadata = await lstat(source.path);
    if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
      throw new CliError("unsafe-path", `Bundled ${source.name} skill must be a physical directory`);
    }
  }
  const root = targetRoot(options.target, options.scope, options.projectDirectory ?? process.cwd());
  await mkdir(root, { recursive: true, mode: 0o700 });
  const destinations = sources.map((source) => Object.freeze({
    ...source,
    destination: join(root, source.name),
  }));
  for (const item of destinations) {
    if (await exists(item.destination)) {
      const metadata = await lstat(item.destination);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new CliError("unsafe-path", `Refusing to replace non-directory ${item.destination}`);
      }
      if (!options.force) {
        throw new CliError(
          "conflict",
          `Skill already exists at ${item.destination}; pass --force to replace both bundled skills`,
        );
      }
    }
  }

  const nonce = `${process.pid}.${randomBytes(8).toString("hex")}`;
  const state: Array<{
    name: string;
    path: string;
    destination: string;
    stage: string;
    backup: string;
    hadExisting: boolean;
    published: boolean;
  }> = destinations.map((item) => ({
    ...item,
    stage: join(root, `.${item.name}.install.${nonce}`),
    backup: join(root, `.${item.name}.backup.${nonce}`),
    hadExisting: false,
    published: false,
  }));
  try {
    for (const item of state) {
      await cp(item.path, item.stage, { recursive: true, errorOnExist: true });
    }
    for (const item of state) {
      if (await exists(item.destination)) {
        await rename(item.destination, item.backup);
        item.hadExisting = true;
      }
    }
    for (const item of state) {
      await rename(item.stage, item.destination);
      item.published = true;
    }
  } catch (error) {
    for (const item of [...state].reverse()) {
      if (item.published) await rm(item.destination, { recursive: true, force: true }).catch(() => undefined);
      if (item.hadExisting) {
        await rename(item.backup, item.destination).catch(() => undefined);
      }
      await rm(item.stage, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  }
  // Both skills are committed once both destinations publish. Cleanup failure
  // must not trigger a rollback after an earlier backup has already been removed.
  for (const item of state) {
    if (item.hadExisting) {
      await rm(item.backup, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return Object.freeze({
    messageLikeMe: await realpath(join(root, "message-like-me")),
    ensoul: await realpath(join(root, "ensoul")),
  });
}
