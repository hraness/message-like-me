import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, query, tool, type SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { literalClaudePrompt, restrictedClaudeOptions } from "./claude-options.ts";
import { spawnBoundedProvider } from "./provider-process.ts";
import { type BrokerToolName, type ToolBroker } from "./broker.ts";
import { assertQualified, AgentStoppedError, type AgentAdapter, type AgentRunRequest, type RuntimeQualification } from "./runtime.ts";

export const CLAUDE_SDK_VERSION = "0.3.268";
export const CLAUDE_CODE_VERSION = "2.1.268";
const SERVER = "agentrouter";
const MAX_OUTPUT_BYTES = 512 * 1024;

/** Host-only credential use: never pass a subscription token, personal config home, or credential file. */
export interface ClaudeApiKeyResolver {
  withApiKey<T>(accountId: string, signal: AbortSignal, use: (apiKey: string) => Promise<T>): Promise<T>;
}
export interface ClaudeSdkAdapterOptions {
  runtime: Readonly<{ executablePath: string; executableSha256: string }>;
  /** Existing physical mode-0700 directory owned by this user, outside all contact folders. */
  stateRoot: string;
  credentials: ClaudeApiKeyResolver;
  qualification: RuntimeQualification;
  now?: () => number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  deadlineMs?: number;
}

const publicName = (name: BrokerToolName) => name.replaceAll(".", "_");
const fullName = (name: BrokerToolName) => `mcp__${SERVER}__${publicName(name)}`;
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

export async function inspectClaudeSdkRuntime(runtime: ClaudeSdkAdapterOptions["runtime"]): Promise<Readonly<{
  executablePath: string; executableSha256: string; sdkSha256: string; runtimeDigest: string; runtimeVersion: string;
}>> {
  if (!isAbsolute(runtime.executablePath) || !/^[a-f0-9]{64}$/u.test(runtime.executableSha256)) throw new Error("CLAUDE_RUNTIME_INVALID");
  const executablePath = await realpath(runtime.executablePath);
  const executableSha256 = hash(await readPinnedExecutable(executablePath));
  if (executableSha256 !== runtime.executableSha256) throw new Error("CLAUDE_RUNTIME_DIGEST_MISMATCH");
  const sdkPath = fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk"));
  const manifest = JSON.parse(await readFile(join(dirname(sdkPath), "package.json"), "utf8")) as Record<string, unknown>;
  if (manifest.name !== "@anthropic-ai/claude-agent-sdk" || manifest.version !== CLAUDE_SDK_VERSION || manifest.claudeCodeVersion !== CLAUDE_CODE_VERSION) {
    throw new Error("CLAUDE_SDK_VERSION_MISMATCH");
  }
  const sdkSha256 = hash(await readFile(sdkPath));
  const runtimeVersion = `claude-sdk/${CLAUDE_SDK_VERSION};claude-code/${CLAUDE_CODE_VERSION}`;
  return Object.freeze({ executablePath, executableSha256, sdkSha256, runtimeVersion,
    runtimeDigest: hash(JSON.stringify({ runtimeVersion, executableSha256, sdkSha256 })) });
}

async function readPinnedExecutable(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.uid !== process.getuid?.() && info.uid !== 0) || info.nlink !== 1
      || (info.mode & 0o022) !== 0 || (info.mode & 0o111) === 0 || info.size > 512 * 1024 * 1024) throw new Error("CLAUDE_RUNTIME_INVALID");
    const bytes = Buffer.alloc(info.size + 1);
    let received = 0;
    while (received < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, received, bytes.byteLength - received, received);
      if (bytesRead === 0) break;
      received += bytesRead;
    }
    const after = await handle.stat();
    if (received !== info.size || after.size !== info.size || after.dev !== info.dev || after.ino !== info.ino
      || after.uid !== info.uid || after.mode !== info.mode || after.nlink !== info.nlink
      || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) throw new Error("CLAUDE_RUNTIME_CHANGED");
    return bytes.subarray(0, received);
  } finally { await handle.close(); }
}

async function snapshotExecutable(source: string, expectedDigest: string, destination: string): Promise<void> {
  const bytes = await readPinnedExecutable(source);
  if (hash(bytes) !== expectedDigest) throw new Error("CLAUDE_RUNTIME_DIGEST_MISMATCH");
  const handle = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o500);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
}

function schemas(): Record<BrokerToolName, z.ZodRawShape> {
  const text = z.string().max(256 * 1024), identifier = z.string().min(1).max(160), path = z.string().min(1).max(1024);
  return {
    "files.read": { path },
    "files.write": { path, text, expectedRevision: identifier.nullable() },
    "web.fetch": { url: z.string().max(8192), maxBytes: z.number().int().min(1).max(256 * 1024) },
    "messages.propose_text": { text: z.string().min(1).max(16 * 1024), idempotencyKey: identifier },
    "messages.propose_reaction": { messageId: identifier, reaction: z.enum(["love", "like", "dislike", "laugh", "emphasize", "question"]), idempotencyKey: identifier },
    "messages.propose_attachment": { path, caption: z.string().max(16 * 1024), idempotencyKey: identifier },
  };
}
const descriptions: Record<BrokerToolName, string> = {
  "files.read": "Read a relative file in this contact's memory folder and its revision.",
  "files.write": "Conditionally write a relative file in this contact's memory folder using its last read revision, or null for a new file.",
  "web.fetch": "Fetch bounded public HTTPS text. Private addresses, authenticated requests and arbitrary ports are unavailable.",
  "messages.propose_text": "Stage a proposed message for this contact. The host decides whether to send it and adds the butler disclosure.",
  "messages.propose_reaction": "Stage a proposed supported reaction to an incoming message in this contact's conversation.",
  "messages.propose_attachment": "Stage a proposed attachment from this contact's memory folder, with a caption. This does not send it.",
};

export function assertClaudeInitialization(value: SDKSystemMessage, request: AgentRunRequest, broker: ToolBroker, cwd: string): void {
  const expected = broker.tools.map(fullName).sort();
  if (value.claude_code_version !== CLAUDE_CODE_VERSION || value.cwd !== cwd || value.model !== request.model
    || value.apiKeySource !== "ANTHROPIC_API_KEY" || value.permissionMode !== "dontAsk"
    || !Array.isArray(value.tools) || JSON.stringify([...value.tools].sort()) !== JSON.stringify(expected)
    || !Array.isArray(value.skills) || value.skills.length !== 0 || !Array.isArray(value.plugins) || value.plugins.length !== 0
    || !Array.isArray(value.mcp_servers) || value.mcp_servers.length !== (expected.length ? 1 : 0)
    || value.mcp_servers.some((server) => server.name !== SERVER || server.status !== "connected")) {
    throw new Error("CLAUDE_EFFECTIVE_BOUNDARY_MISMATCH");
  }
}

async function physicalPrivateDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error("CLAUDE_STATE_ROOT_INVALID");
  const actual = await realpath(path), stat = await lstat(path);
  if (actual !== path || !stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("CLAUDE_STATE_ROOT_INVALID");
  }
  return actual;
}
function boundedInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("CLAUDE_LIMIT_INVALID");
  return value;
}

/** A real SDK subprocess adapter. Qualification is independent host evidence, never inferred from a response. */
export function createClaudeSdkAdapter(options: ClaudeSdkAdapterOptions): AgentAdapter {
  const now = options.now ?? Date.now;
  const maxTurns = boundedInteger(options.maxTurns ?? 12, 1, 32);
  const deadlineMs = boundedInteger(options.deadlineMs ?? 120_000, 1_000, 300_000);
  const maxBudgetUsd = options.maxBudgetUsd ?? 0.25;
  if (!Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0 || maxBudgetUsd > 5) throw new Error("CLAUDE_LIMIT_INVALID");
  // Capture host inputs so a contact/plugin cannot mutate a qualification after admission.
  const qualification = structuredClone(options.qualification);
  if (qualification.status === "qualified") Object.freeze(qualification.controls);
  Object.freeze(qualification);
  const runtime = Object.freeze({ ...options.runtime });
  return Object.freeze({ provider: "claude", qualification,
    async run(request: AgentRunRequest, broker: ToolBroker) {
      try { assertQualified(qualification, now()); }
      catch { throw new AgentStoppedError("PROVIDER_UNQUALIFIED"); }
      if (request.provider !== "claude" || request.workspaceId !== broker.workspaceId || request.runId !== broker.runId
        || (request.purpose === "classify" && broker.tools.length !== 0)) throw new AgentStoppedError("CLAUDE_RUN_BINDING_INVALID");
      let inspected: Awaited<ReturnType<typeof inspectClaudeSdkRuntime>>;
      let stateRoot: string;
      try {
        request.signal.throwIfAborted();
        inspected = await inspectClaudeSdkRuntime(runtime);
        if (qualification.status !== "qualified" || qualification.runtimeDigest !== inspected.runtimeDigest
          || qualification.runtimeVersion !== inspected.runtimeVersion) throw new Error("CLAUDE_QUALIFICATION_RUNTIME_MISMATCH");
        stateRoot = await physicalPrivateDirectory(options.stateRoot);
      } catch { throw new AgentStoppedError("CLAUDE_RUNTIME_PREFLIGHT_FAILED"); }
      let directory: string;
      try { directory = await mkdtemp(join(stateRoot, "claude-")); }
      catch { throw new AgentStoppedError("CLAUDE_STATE_CREATE_FAILED"); }
      const controller = new AbortController();
      const abort = () => controller.abort(new Error("CLAUDE_RUN_CANCELLED"));
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
      const timer = setTimeout(abort, deadlineMs);
      let processStopped = true;
      try {
        const cwd = join(directory, "work"), home = join(directory, "home"), config = join(directory, "config"), temp = join(directory, "tmp");
        for (const path of [cwd, home, config, temp]) await mkdir(path, { mode: 0o700 });
        const executable = join(directory, "provider");
        await snapshotExecutable(inspected.executablePath, inspected.executableSha256, executable);
        return await options.credentials.withApiKey(request.accountId, controller.signal, async (apiKey) => {
          if (typeof apiKey !== "string" || !/^sk-ant-api03-[A-Za-z0-9_-]{16,512}$/u.test(apiKey)) throw new AgentStoppedError("CLAUDE_API_KEY_REQUIRED");
          controller.signal.throwIfAborted();
          const env: Record<string, string> = { HOME: home, CLAUDE_CONFIG_DIR: config, TMPDIR: temp, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8",
            ANTHROPIC_API_KEY: apiKey, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_AGENT_SDK_CLIENT_APP: "agentrouter/0.1.0", NO_COLOR: "1" };
          let child: ReturnType<typeof spawnBoundedProvider> | undefined;
          let admitted = false;
          const schema = schemas();
          const brokerTools = broker.tools.map((name) => tool(publicName(name), descriptions[name], schema[name], async (input) => {
            if (!admitted || controller.signal.aborted) return { isError: true, content: [{ type: "text", text: "RUN_NOT_ADMITTED" }] };
            try {
              const result = await broker.invoke(name, input);
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            } catch { return { isError: true, content: [{ type: "text", text: "TOOL_REQUEST_DENIED" }] }; }
          }));
          const sdkOptions = restrictedClaudeOptions({
            abortController: controller, cwd, env, model: request.model,
            brokerToolNames: broker.tools.map(fullName), maxTurns: request.purpose === "classify" ? 1 : maxTurns, maxBudgetUsd,
            pathToClaudeCodeExecutable: executable,
            mcpServers: brokerTools.length ? { [SERVER]: createSdkMcpServer({ name: SERVER, version: "1.0.0", tools: brokerTools }) } : {},
            spawnClaudeCodeProcess: (input) => {
              if (child !== undefined || input.command !== executable || input.cwd !== cwd) throw new Error("CLAUDE_SPAWN_MISMATCH");
              controller.signal.throwIfAborted();
              child = spawnBoundedProvider({ executable, args: input.args, cwd, env, onViolation: abort });
              processStopped = false;
              return child.process;
            },
          });
          let response: ReturnType<typeof query> | undefined;
          let output: unknown;
          let resultSeen = false;
          let failure = false;
          try {
            response = query({ prompt: literalClaudePrompt(request.prompt), options: sdkOptions });
            let received = 0;
            for await (const event of response) {
              controller.signal.throwIfAborted();
              received += Buffer.byteLength(JSON.stringify(event));
              if (received > 8 * 1024 * 1024) throw new Error("CLAUDE_OUTPUT_LIMIT");
              if (event.type === "system" && event.subtype === "init") {
                assertClaudeInitialization(event, request, broker, cwd); admitted = true;
              } else if (event.type === "result") {
                if (!admitted || resultSeen || event.subtype !== "success" || event.is_error || Buffer.byteLength(event.result) > MAX_OUTPUT_BYTES) throw new Error("CLAUDE_RESULT_INVALID");
                output = JSON.parse(event.result) as unknown; resultSeen = true;
              }
            }
            if (!resultSeen) throw new Error("CLAUDE_RESULT_MISSING");
          } catch { failure = true; }
          finally {
            admitted = false;
            try { response?.close(); } catch { failure = true; }
            try {
              if (child !== undefined) {
                await child.stopAndJoin();
                processStopped = child.isStopped();
              }
            } finally { delete env.ANTHROPIC_API_KEY; }
          }
          if (failure || controller.signal.aborted) throw new AgentStoppedError("CLAUDE_RUN_FAILED");
          return { output, processStopped: true as const };
        });
      } catch (error) {
        if (processStopped) throw error instanceof AgentStoppedError ? error : new AgentStoppedError("CLAUDE_RUN_FAILED");
        throw new Error("CLAUDE_PROCESS_EXIT_UNPROVEN");
      } finally {
        clearTimeout(timer); request.signal.removeEventListener("abort", abort);
        // Unknown children retain their private state and account lease for explicit custody recovery.
        if (processStopped) await rm(directory, { recursive: true, force: true });
      }
    },
  });
}
