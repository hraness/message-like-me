/** Synthetic native bootstrap diagnostic. Never sends a model prompt or reads an account. */
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { restrictedClaudeOptions } from "../src/claude-options.ts";
import { syntheticMacSandbox } from "./macos-sandbox-profile.ts";
if (process.argv.slice(2).some(argument => argument !== "--initialize")) throw new Error("INVALID_DIAGNOSTIC_ARGUMENT");
const root = await realpath(await mkdtemp(join(tmpdir(), "textbutler-native-bootstrap-")));
try {
  const executable = await realpath(fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk-darwin-arm64/claude")));
  const home = join(root, "home"), cwd = join(root, "work"), temp = join(root, "tmp");
  for (const path of [home, cwd, temp]) await mkdir(path, { mode: 0o700 });
  const profile = syntheticMacSandbox({ executable, scratch: [home, cwd, temp], port: 1 });
  if (process.argv.includes("--initialize")) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    let native: ChildProcessWithoutNullStreams | undefined, stderr = "", bytes = 0, release!: () => void, joined = false;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const prompt = async function* (): AsyncGenerator<SDKUserMessage> { await waiting; };
    const stop = () => { if (native?.pid) { try { process.kill(-native.pid, "SIGKILL"); } catch {} } };
    const env = { HOME: home, CLAUDE_CONFIG_DIR: home, TMPDIR: temp, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8",
      ANTHROPIC_API_KEY: ["sk", "ant", "api03", "synthetic", "local", "fixture", "credential"].join("-"),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
    const stream = query({ prompt: prompt(), options: restrictedClaudeOptions({ cwd, env, abortController: controller,
      model: "claude-sonnet-4-6", brokerToolNames: [], maxTurns: 1, maxBudgetUsd: 0.01, mcpServers: {}, pathToClaudeCodeExecutable: executable,
      spawnClaudeCodeProcess(input) {
        if (native || input.command !== executable || input.cwd !== cwd) throw new Error("DIAGNOSTIC_SPAWN_MISMATCH");
        native = spawn("/usr/bin/sandbox-exec", ["-p", profile, executable, ...input.args], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
        native.on("error", () => { joined = true; }); native.on("exit", () => { joined = true; });
        native.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; stderr = `${stderr}${chunk.toString()}`.slice(-4000); if (bytes > 64 * 1024) { controller.abort(); stop(); } });
        return native;
      } }) });
    try {
      const result = await stream.initializationResult();
      console.log(JSON.stringify({ initialized: true, keys: Object.keys(result).sort(), productionQualificationIssued: false, paidModelRequests: 0 }));
    } catch (error) {
      console.log(JSON.stringify({ initialized: false, error: String(error).replaceAll(root, "<synthetic-root>").slice(0, 2000), code: native?.exitCode, signal: native?.signalCode,
        stderr: stderr.replaceAll(root, "<synthetic-root>"), productionQualificationIssued: false, paidModelRequests: 0 }, null, 2)); process.exitCode = 1;
    } finally {
      clearTimeout(timer); release(); controller.abort(); stream.close(); stop();
      const deadline = Date.now() + 2000; while (!joined && native && Date.now() < deadline) await Bun.sleep(10);
      if (native && !joined) throw new Error("SYNTHETIC_NATIVE_EXIT_UNPROVEN");
    }
  } else {
  const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", profile, executable, "--version"], { cwd,
    env: { HOME: home, CLAUDE_CONFIG_DIR: home, TMPDIR: temp, PATH: "/usr/bin:/bin", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    stdout: "pipe", stderr: "pipe", timeout: 10_000 });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  console.log(JSON.stringify({ code, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 4000), productionQualificationIssued: false }, null, 2));
  process.exitCode = code;
  }
} finally { await rm(root, { recursive: true, force: true }); }
