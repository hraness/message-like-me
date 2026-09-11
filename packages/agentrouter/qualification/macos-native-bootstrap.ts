/** Synthetic native bootstrap diagnostic. Never sends a model prompt or reads an account. */
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticMacSandbox } from "./macos-sandbox-profile.ts";
const root = await realpath(await mkdtemp(join(tmpdir(), "textbutler-native-bootstrap-")));
try {
  const executable = await realpath(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk-darwin-arm64/claude")));
  const home = join(root, "home"), cwd = join(root, "work"), temp = join(root, "tmp");
  for (const path of [home, cwd, temp]) await mkdir(path, { mode: 0o700 });
  const profile = syntheticMacSandbox({ executable, scratch: [home, cwd, temp], port: 1 });
  const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile, executable, "--version"], { cwd,
    env: { HOME: home, CLAUDE_CONFIG_DIR: home, TMPDIR: temp, PATH: "/usr/bin:/bin", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  console.log(JSON.stringify({ code, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 4000), productionQualificationIssued: false }, null, 2));
  process.exitCode = code;
} finally { await rm(root, { recursive: true, force: true }); }
