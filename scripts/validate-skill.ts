import { access, lstat, readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const SKILL_ROOT = join(PACKAGE_ROOT, "skills", "message-like-me");
const ENSOUL_SKILL_ROOT = join(PACKAGE_ROOT, "skills", "ensoul");
const SKILL_PATH = join(SKILL_ROOT, "SKILL.md");
const UI_PATH = join(SKILL_ROOT, "agents", "openai.yaml");
const REQUIRED_REFERENCES = [
  "references/analysis.md",
  "references/drafting.md",
  "references/ensoul.md",
  "references/privacy.md",
  "references/profile-schema.md",
] as const;
const EXPECTED_ENSOUL_FILES = [
  "LICENSE",
  "NOTICE.md",
  "SKILL.md",
  "VENDORED_FROM.md",
  "agents/openai.yaml",
  "references/ensoul-source-packet-v1.schema.json",
  "references/evidence-method.md",
  "references/output-blueprint.md",
  "references/source-packets.md",
  "scripts/prepare-x-archive.ts",
  "scripts/source-packet.ts",
  "scripts/validate-source-packet.ts",
  "scripts/x-zip-file.ts",
] as const;
const ENSOUL_SOURCE_COMMIT = "46c8b14d03fecdfe8d75e5a61d5f7bfcc255e674";
const ENSOUL_SOURCE_VERSION = "0.3.1";

const PLACEHOLDER = /(?:\b(?:change[ -]?me|coming soon|fixme|lorem ipsum|placeholder|tbd|todo)\b|<[^>\n]*(?:placeholder|todo)[^>\n]*>)/iu;
const SKILL_TEXT_EXTENSIONS = new Set([".json", ".md", ".ts", ".txt", ".yaml", ".yml"]);
const LEGACY_NON_BUN_REFERENCE = new RegExp([
  String.raw`\bpy`,
  String.raw`thon3?\b`,
  String.raw`|prepare_`,
  String.raw`x_archive\.p`,
  "y",
  String.raw`|validate_`,
  String.raw`source_packet\.p`,
  "y",
].join(""), "u");

type StringRecord = Record<string, string>;

function unquoteYamlScalar(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} must not be empty`);
  if (trimmed.startsWith('"')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error(`${label} must use a valid quoted YAML scalar`);
    }
    if (typeof parsed !== "string") throw new Error(`${label} must be text`);
    return parsed;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

export function parseSkillFrontmatter(source: string): StringRecord {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source);
  if (match === null) throw new Error("SKILL.md must start with YAML frontmatter");
  const result: StringRecord = {};
  for (const [index, line] of (match[1] ?? "").split("\n").entries()) {
    if (line.trim() === "") continue;
    const separator = line.indexOf(":");
    if (separator < 1 || /^\s/u.test(line)) {
      throw new Error(`SKILL.md frontmatter line ${String(index + 1)} is invalid`);
    }
    const key = line.slice(0, separator).trim();
    if (!/^[a-z][a-z0-9_]*$/u.test(key) || key in result) {
      throw new Error(`SKILL.md frontmatter key ${JSON.stringify(key)} is invalid or duplicated`);
    }
    result[key] = unquoteYamlScalar(
      line.slice(separator + 1),
      `SKILL.md frontmatter ${key}`,
    );
  }
  return result;
}

export function parseOpenAiInterface(source: string): StringRecord {
  const normalized = source.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "interface:") {
    throw new Error("agents/openai.yaml must contain one top-level interface mapping");
  }
  const result: StringRecord = {};
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    const match = /^  ([a-z][a-z0-9_]*):\s*(.+)$/u.exec(line);
    if (match === null) {
      throw new Error(`agents/openai.yaml line ${String(index + 1)} is invalid`);
    }
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined || key in result) {
      throw new Error(`agents/openai.yaml line ${String(index + 1)} is duplicated`);
    }
    result[key] = unquoteYamlScalar(value, `agents/openai.yaml ${key}`);
  }
  return result;
}

function exactKeys(value: StringRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.join("\n") !== sortedExpected.join("\n")) {
    throw new Error(`${label} must contain only ${sortedExpected.join(", ")}; received ${actual.join(", ")}`);
  }
}

function assertFinished(value: string, label: string): void {
  if (PLACEHOLDER.test(value)) throw new Error(`${label} contains placeholder text`);
}

function assertBunOnlyReference(value: string, label: string): void {
  if (LEGACY_NON_BUN_REFERENCE.test(value)) {
    throw new Error(`${label} contains a legacy non-Bun Ensoul script reference`);
  }
}

async function collectSkillFiles(path: string): Promise<string[]> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Skill must not contain a symlink: ${relative(PACKAGE_ROOT, path)}`);
  }
  if (metadata.isFile()) return [path];
  if (!metadata.isDirectory()) {
    throw new Error(`Skill contains a non-file entry: ${relative(PACKAGE_ROOT, path)}`);
  }
  const files: string[] = [];
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    files.push(...await collectSkillFiles(join(path, entry.name)));
  }
  return files;
}

function insideSkillRoot(path: string, skillRoot: string): boolean {
  const pathFromRoot = relative(skillRoot, path);
  return pathFromRoot !== ""
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`);
}

async function assertMarkdownLinks(sourcePath: string, skillRoot: string): Promise<void> {
  const source = await readFile(sourcePath, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (target === undefined || /^(?:[a-z]+:|#)/iu.test(target)) continue;
    const withoutFragment = target.split("#", 1)[0];
    if (withoutFragment === undefined || withoutFragment === "") continue;
    const resolved = normalize(resolve(dirname(sourcePath), withoutFragment));
    if (!insideSkillRoot(resolved, skillRoot)) {
      throw new Error(`${relative(PACKAGE_ROOT, sourcePath)} links outside the skill: ${target}`);
    }
    try {
      await access(resolved);
    } catch {
      throw new Error(`${relative(PACKAGE_ROOT, sourcePath)} has a missing link: ${target}`);
    }
  }
}

export async function validateSkill(): Promise<void> {
  const skillFiles = await collectSkillFiles(SKILL_ROOT);
  for (const path of skillFiles) {
    if (!SKILL_TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const source = await readFile(path, "utf8");
    const label = relative(PACKAGE_ROOT, path);
    assertFinished(source, label);
    assertBunOnlyReference(source, label);
  }
  const skill = await readFile(SKILL_PATH, "utf8");
  const frontmatter = parseSkillFrontmatter(skill);
  exactKeys(frontmatter, ["description", "name"], "SKILL.md frontmatter");
  if (frontmatter.name !== "message-like-me") {
    throw new Error("Skill name must be message-like-me");
  }
  const description = frontmatter.description ?? "";
  if (description.length < 40 || description.length > 1_024) {
    throw new Error("Skill description must contain 40-1024 characters");
  }
  assertFinished(description, "Skill description");

  for (const relativePath of REQUIRED_REFERENCES) {
    try {
      await access(join(SKILL_ROOT, relativePath));
    } catch {
      throw new Error(`Skill is missing ${relativePath}`);
    }
  }

  const ui = parseOpenAiInterface(await readFile(UI_PATH, "utf8"));
  exactKeys(
    ui,
    ["default_prompt", "display_name", "short_description"],
    "agents/openai.yaml interface",
  );
  if (ui.display_name !== "Message Like Me") {
    throw new Error("agents/openai.yaml display_name must be Message Like Me");
  }
  const shortDescription = ui.short_description ?? "";
  if (shortDescription.length < 10 || shortDescription.length > 100) {
    throw new Error("agents/openai.yaml short_description must contain 10-100 characters");
  }
  const defaultPrompt = ui.default_prompt ?? "";
  if (defaultPrompt.length < 20 || defaultPrompt.length > 500) {
    throw new Error("agents/openai.yaml default_prompt must contain 20-500 characters");
  }
  if (!defaultPrompt.includes("$message-like-me")) {
    throw new Error("agents/openai.yaml default_prompt must invoke $message-like-me");
  }
  for (const [key, value] of Object.entries(ui)) {
    assertFinished(value, `agents/openai.yaml ${key}`);
  }

  await Promise.all(skillFiles
    .filter((path) => extname(path).toLowerCase() === ".md")
    .map((path) => assertMarkdownLinks(path, SKILL_ROOT)));
}

export async function validateEnsoulSkill(): Promise<void> {
  const skillFiles = await collectSkillFiles(ENSOUL_SKILL_ROOT);
  const actualFiles = skillFiles.map((path) =>
    relative(ENSOUL_SKILL_ROOT, path).split(sep).join("/")
  ).sort();
  const expectedFiles = [...EXPECTED_ENSOUL_FILES].sort();
  if (actualFiles.join("\n") !== expectedFiles.join("\n")) {
    throw new Error([
      "Ensoul vendored inventory must exactly match the approved v0.3.1 copy.",
      `Expected: ${expectedFiles.join(", ")}`,
      `Received: ${actualFiles.join(", ")}`,
    ].join("\n"));
  }
  for (const path of skillFiles) {
    if (!SKILL_TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    const source = await readFile(path, "utf8");
    const label = relative(PACKAGE_ROOT, path);
    assertFinished(source, label);
    assertBunOnlyReference(source, label);
  }
  const skill = await readFile(join(ENSOUL_SKILL_ROOT, "SKILL.md"), "utf8");
  const frontmatter = parseSkillFrontmatter(skill);
  exactKeys(frontmatter, ["description", "name"], "Ensoul SKILL.md frontmatter");
  if (frontmatter.name !== "ensoul") throw new Error("Ensoul skill name must be ensoul");
  const description = frontmatter.description ?? "";
  if (description.length < 40 || description.length > 1_024) {
    throw new Error("Ensoul skill description must contain 40-1024 characters");
  }
  assertFinished(description, "Ensoul skill description");
  const provenance = await readFile(join(ENSOUL_SKILL_ROOT, "VENDORED_FROM.md"), "utf8");
  const expectedProvenance = `commit \`${ENSOUL_SOURCE_COMMIT}\` (version \`${ENSOUL_SOURCE_VERSION}\`)`;
  if (!provenance.includes(expectedProvenance)) {
    throw new Error(`Ensoul provenance must identify ${expectedProvenance}`);
  }
  const ui = parseOpenAiInterface(await readFile(
    join(ENSOUL_SKILL_ROOT, "agents", "openai.yaml"),
    "utf8",
  ));
  exactKeys(
    ui,
    ["default_prompt", "display_name", "short_description"],
    "Ensoul agents/openai.yaml interface",
  );
  if (ui.display_name !== "Ensoul") {
    throw new Error("Ensoul agents/openai.yaml display_name must be Ensoul");
  }
  const shortDescription = ui.short_description ?? "";
  if (shortDescription.length < 10 || shortDescription.length > 100) {
    throw new Error("Ensoul agents/openai.yaml short_description must contain 10-100 characters");
  }
  const defaultPrompt = ui.default_prompt ?? "";
  if (defaultPrompt.length < 20 || defaultPrompt.length > 500 || !defaultPrompt.includes("$ensoul")) {
    throw new Error("Ensoul agents/openai.yaml default_prompt must invoke $ensoul");
  }
  for (const [key, value] of Object.entries(ui)) {
    assertFinished(value, `Ensoul agents/openai.yaml ${key}`);
  }
  await Promise.all(skillFiles
    .filter((path) => extname(path).toLowerCase() === ".md")
    .map((path) => assertMarkdownLinks(path, ENSOUL_SKILL_ROOT)));
}

if (import.meta.main) {
  await validateSkill();
  await validateEnsoulSkill();
  console.log("message-like-me and ensoul skills are valid");
}
