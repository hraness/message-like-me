import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";

const PACKAGE_NAME = "@hraness/message-like-me";
const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const TYPESCRIPT_CLI = join(PACKAGE_ROOT, "node_modules", "typescript", "bin", "tsc");
const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const DATABASE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const FORBIDDEN_PACKAGE_TEXT = [
  { label: "private package name", pattern: /@jungle\//u },
  { label: "private source-repository name", pattern: /\bJungle\b/u },
  { label: "private source path", pattern: /(?:projects|packages)\/message-like-me/u },
  { label: "private repository identity", pattern: /0thernet\/jungle/iu },
  { label: "developer home path", pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\//u },
  { label: "private key material", pattern: /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/u },
  { label: "GitHub token", pattern: /\bgh[opusr]_[A-Za-z0-9_]{20,}\b/u },
  { label: "OpenAI secret", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u },
] as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonRecord;
}

function isWithin(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

async function startsWithSqliteHeader(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(16);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytesRead === bytes.length && bytes.toString("utf8") === "SQLite format 3\u0000";
  } finally {
    await handle.close();
  }
}

async function scanPackedPackage(root: string): Promise<void> {
  const problems: string[] = [];
  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    const packagePath = relative(root, path).split(sep).join("/") || ".";
    if (info.isSymbolicLink()) {
      problems.push(`${packagePath} is a symlink`);
      return;
    }
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(join(path, entry.name));
      }
      return;
    }
    if (!info.isFile()) {
      problems.push(`${packagePath} is not a regular file`);
      return;
    }
    if (DATABASE_EXTENSIONS.has(extname(path).toLowerCase()) || await startsWithSqliteHeader(path)) {
      problems.push(`${packagePath} contains a database artifact`);
    }
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase()) && basename(path) !== "LICENSE") return;
    const source = await readFile(path, "utf8");
    for (const rule of FORBIDDEN_PACKAGE_TEXT) {
      if (rule.pattern.test(source)) problems.push(`${packagePath} contains ${rule.label}`);
    }
  }
  await visit(root);
  if (problems.length > 0) {
    throw new Error(`Packed standalone boundary failed:\n${[...new Set(problems)].sort().join("\n")}`);
  }
}

async function run(
  command: readonly string[],
  cwd: string,
  options: Readonly<{ capture?: boolean }> = {},
): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd,
    stderr: options.capture === true ? "pipe" : "inherit",
    stdout: options.capture === true ? "pipe" : "inherit",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    options.capture === true ? new Response(child.stdout).text() : Promise.resolve(""),
    options.capture === true ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  if (exitCode !== 0) {
    throw new Error([
      `Command failed (${String(exitCode)}): ${command.join(" ")}`,
      stdout.trim(),
      stderr.trim(),
    ].filter((line) => line !== "").join("\n"));
  }
  return stdout;
}

function packagePaths(value: unknown, label: string): string[] {
  if (typeof value === "string") {
    return value.startsWith("./") ? [value.slice(2)] : [];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain package-relative paths`);
  }
  return Object.entries(value).flatMap(([key, nested]) =>
    packagePaths(nested, `${label}.${key}`)
  );
}

async function requirePublishedPaths(packageRoot: string, manifest: JsonRecord): Promise<void> {
  const bin = record(manifest.bin, "installed package.json bin");
  const exported = [
    ...packagePaths(manifest.exports, "installed package.json exports"),
    ...packagePaths(bin, "installed package.json bin"),
  ];
  for (const path of [...new Set(exported)].sort()) {
    const resolved = resolve(packageRoot, path);
    if (!isWithin(packageRoot, resolved)) {
      throw new Error(`Published path escapes the installed package: ${path}`);
    }
    try {
      await access(resolved);
    } catch {
      throw new Error(`Published path is missing from the installed package: ${path}`);
    }
  }
}

export async function packageSmoke(): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "message-like-me-package-"));
  try {
    const archive = join(work, "package.tgz");
    const cache = join(work, "cache");
    const consumer = join(work, "consumer");
    await Promise.all([mkdir(cache), mkdir(consumer)]);
    await run([
      process.execPath,
      "pm",
      "pack",
      "--filename",
      archive,
      "--ignore-scripts",
      "--quiet",
    ], PACKAGE_ROOT);
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await run([
      process.execPath,
      "add",
      archive,
      "--ignore-scripts",
      "--offline",
      "--cache-dir",
      cache,
      "--backend",
      "copyfile",
    ], consumer);

    const installedPackage = await realpath(
      join(consumer, "node_modules", "@hraness", "message-like-me"),
    );
    await scanPackedPackage(installedPackage);
    const manifest = record(
      JSON.parse(await readFile(join(installedPackage, "package.json"), "utf8")) as unknown,
      "installed package.json",
    );
    if (manifest.name !== PACKAGE_NAME) {
      throw new Error(`Packed package name is ${JSON.stringify(manifest.name)}, expected ${PACKAGE_NAME}`);
    }
    await requirePublishedPaths(installedPackage, manifest);
    await run([process.execPath, "-e", `await import(${JSON.stringify(PACKAGE_NAME)})`], consumer);
    await run([
      process.execPath,
      "-e",
      `const contract = await import(${JSON.stringify(`${PACKAGE_NAME}/message-bundle-v1`)}); if (contract.LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION !== "1.1.0") throw new Error("wrong bundle contract")`,
    ], consumer);
    await run([
      process.execPath,
      "-e",
      `const contract = await import(${JSON.stringify(`${PACKAGE_NAME}/agentic-messaging-v1`)}); if (contract.WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH !== "5e64da6a3d826e7f6fa3db7dca0a4ba92c10cfb784981e71a25aed9513a5c687" || contract.WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH !== "7f6cf724f0200b2399e4f4641c637b20b48914fc5c9b13755127a8ec69fe66f4") throw new Error("wrong agentic messaging contract")`,
    ], consumer);
    await writeFile(
      join(consumer, "index.ts"),
      [
        `import { canonicalJson, sha256 } from ${JSON.stringify(PACKAGE_NAME)};`,
        `import type { ContactMetrics, StyleProfileV2 } from ${JSON.stringify(PACKAGE_NAME)};`,
        `import { LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS, parseLocalMessageBundleV1Record } from ${JSON.stringify(`${PACKAGE_NAME}/message-bundle-v1`)};`,
        `import type { LocalMessageBundleV1Manifest } from ${JSON.stringify(`${PACKAGE_NAME}/message-bundle-v1`)};`,
        `import { parseAgentMessageHandoffV1, WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH, WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH } from ${JSON.stringify(`${PACKAGE_NAME}/agentic-messaging-v1`)};`,
        `import type { AgentMessageHandoffV1 } from ${JSON.stringify(`${PACKAGE_NAME}/agentic-messaging-v1`)};`,
        "const digest: string = sha256(canonicalJson({ fixture: true }));",
        "const profile = null as unknown as StyleProfileV2;",
        "const metrics = null as unknown as ContactMetrics;",
        "const manifest = null as unknown as LocalMessageBundleV1Manifest;",
        "const parseRecord: typeof parseLocalMessageBundleV1Record = parseLocalMessageBundleV1Record;",
        "const handoff = null as unknown as AgentMessageHandoffV1;",
        "const parseHandoff: typeof parseAgentMessageHandoffV1 = parseAgentMessageHandoffV1;",
        "void [digest, profile, metrics, manifest, parseRecord, handoff, parseHandoff, LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS, WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH, WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH];",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    await writeFile(
      join(consumer, "tsconfig.json"),
      `${JSON.stringify({
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: "ES2024",
          types: [],
        },
        include: ["index.ts"],
      }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await run([
      process.execPath,
      TYPESCRIPT_CLI,
      "--project",
      join(consumer, "tsconfig.json"),
    ], consumer);

    const binary = join(consumer, "node_modules", ".bin", "messagelikeme");
    const help = await run([binary, "--help"], consumer, { capture: true });
    if (!help.includes("messagelikeme")) {
      throw new Error("Packed CLI help does not identify messagelikeme");
    }
    const reportedVersion = (await run([binary, "--version"], consumer, { capture: true })).trim();
    if (reportedVersion !== manifest.version) {
      throw new Error(
        `Packed CLI reports version ${JSON.stringify(reportedVersion)}, expected ${JSON.stringify(manifest.version)}`,
      );
    }
    const reportedSkill = (await run([binary, "skill", "path"], consumer, { capture: true })).trim();
    const installedSkill = await realpath(reportedSkill);
    const expectedSkill = await realpath(join(installedPackage, "skills", "message-like-me"));
    if (installedSkill !== expectedSkill || !isWithin(installedPackage, installedSkill)) {
      throw new Error(`Packed CLI resolved skill outside its install: ${reportedSkill}`);
    }
    await access(join(installedSkill, "SKILL.md"));
    const schema = record(
      JSON.parse(
        await readFile(join(installedPackage, "schema", "style-profile-v1.schema.json"), "utf8"),
      ) as unknown,
      "installed style profile schema",
    );
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error("Packed style profile schema must use JSON Schema draft 2020-12");
    }
    const bundleSchema = record(
      JSON.parse(
        await readFile(
          join(installedPackage, "schema", "local-message-bundle-v1.schema.json"),
          "utf8",
        ),
      ) as unknown,
      "installed local message bundle schema",
    );
    if (
      bundleSchema.$schema !== "https://json-schema.org/draft/2020-12/schema"
      || bundleSchema.$id !== "https://messagelikeme.com/schema/local-message-bundle-v1.schema.json"
    ) {
      throw new Error("Packed local message bundle schema has the wrong identity");
    }
  } finally {
    await rm(work, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  await packageSmoke();
  console.log("Packed install, consumer types, library import, CLI identity, and bundled skill path verified.");
}
