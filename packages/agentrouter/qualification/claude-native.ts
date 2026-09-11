/** Explicit Mac-native qualification fixture. No real credentials or paid model requests.
 * Run via the mac-native host lane; production adapters do not accept custom endpoints.
 * This is evidence for these exact model-visible controls, not an OS sandbox claim.
 */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, link, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { assertClaudeInitialization, inspectClaudeSdkRuntime } from "../src/claude-sdk.ts";
import { literalClaudePrompt, restrictedClaudeOptions } from "../src/claude-options.ts";
import { spawnBoundedProvider } from "../src/provider-process.ts";
import { createToolBroker, type BrokerToolName } from "../src/broker.ts";
import { ContactWorkspace } from "../../textbutler/src/workspace.ts";

if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("QUALIFICATION_REQUIRES_DARWIN_ARM64");
const executable = fileURLToPath(import.meta.resolve("@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"));
const inspected = await inspectClaudeSdkRuntime({ executablePath: executable, executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex") });
const root = await realpath(await mkdtemp(join(tmpdir(), "textbutler-native-scope-")));
const canary = "SYNTHETIC_OTHER_CONTACT_CANARY_483159";
const instructionCanary = "SYNTHETIC_INHERITED_INSTRUCTION_831405";
const dotenvCanary = "SYNTHETIC_DOTENV_932184";
const results: unknown[] = [];
const toolsUsed = ["files.read", "files.write", "messages.propose_text"] as const;
const full = (name: string) => `mcp__agentrouter__${name.replaceAll(".", "_")}`;
type Attempt = { name: string; input: Record<string, unknown> };

function streamMessage(model: string, attempts: Attempt[]): Response {
  const events: unknown[] = [{ type: "message_start", message: { id: "msg_synthetic", type: "message", role: "assistant", content: [], model,
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }];
  if (attempts.length) {
    for (const [index, attempt] of attempts.entries()) {
      events.push({ type: "content_block_start", index, content_block: { type: "tool_use", id: `toolu_synthetic_${index}`, name: attempt.name, input: {} } },
        { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(attempt.input) } },
        { type: "content_block_stop", index });
    }
  } else {
    events.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"fixture":"complete"}' } },
      { type: "content_block_stop", index: 0 });
  }
  events.push({ type: "message_delta", delta: { stop_reason: attempts.length ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }, { type: "message_stop" });
  return new Response(events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream", "request-id": "synthetic-local-only" } });
}
async function exists(path: string): Promise<boolean> { try { await stat(path); return true; } catch { return false; } }
function assert(value: unknown, error: string): asserts value { if (!value) throw new Error(error); }

async function scenario(name: string, attempted: (input: { sibling: string; marker: string; revision: string }) => Attempt[], classifier = false, taskText?: (input: { sibling: string; marker: string }) => string) {
  const directory = join(root, name); await mkdir(directory, { mode: 0o700 });
  const cwd = join(directory, "work"), home = join(directory, "home"), config = join(directory, "config"), temp = join(directory, "tmp");
  for (const path of [cwd, home, config, temp]) await mkdir(path, { mode: 0o700 });
  const memory = await ContactWorkspace.create(join(directory, "contact"));
  const sibling = join(directory, "other-contact.md"), marker = join(directory, "command-was-run");
  await writeFile(sibling, canary, { mode: 0o600 });
  await symlink(sibling, join(memory.root, "notes", "escape.md"));
  await link(sibling, join(memory.root, "notes", "hardlink.md"));
  const before = await memory.readVersioned("MEMORY.md");
  // Poisoned fixture-only settings, memory, hooks and MCP roots must remain unread/unexecuted.
  for (const path of [join(home, ".claude"), join(cwd, ".claude")]) await mkdir(path, { mode: 0o700 });
  const poisonedSettings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `/usr/bin/touch '${marker}'` }] }] } });
  for (const path of [join(home, ".claude", "settings.json"), join(config, "settings.json"), join(cwd, ".claude", "settings.json")]) await writeFile(path, poisonedSettings);
  for (const path of [join(home, ".claude", "CLAUDE.md"), join(config, "CLAUDE.md"), join(cwd, "CLAUDE.md")]) await writeFile(path, instructionCanary);
  await writeFile(join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { forbidden: { command: "/usr/bin/touch", args: [marker] } } }));
  await writeFile(join(cwd, ".env"), `ANTHROPIC_CUSTOM_HEADERS="x-synthetic-dotenv: ${dotenvCanary}"\n`);
  const attempts = attempted({ sibling, marker, revision: before.revision });
  let apiCalls = 0, loadedInstructions = false, leakedCanary = false, loadedDotenv = false;
  let advertisedTools: string[] = [], nativeToolResults: { id: string; isError: boolean }[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/messages" || request.method !== "POST") return new Response("Synthetic endpoint only", { status: 404 });
    const text = await request.text();
    assert(text.length <= 2 * 1024 * 1024, "FIXTURE_REQUEST_LIMIT");
    const body = JSON.parse(text);
    loadedDotenv ||= request.headers.get("x-synthetic-dotenv") === dotenvCanary;
    apiCalls++;
    assert(apiCalls <= 4, "FIXTURE_TURN_LIMIT");
    loadedInstructions ||= text.includes(instructionCanary);
    leakedCanary ||= text.includes(canary);
    advertisedTools = (body.tools ?? []).map((entry: { name: string }) => entry.name).sort();
    for (const message of body.messages ?? []) for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === "tool_result" && !nativeToolResults.some(result => result.id === block.tool_use_id)) nativeToolResults.push({ id: block.tool_use_id, isError: block.is_error === true });
    }
    return streamMessage(body.model, apiCalls === 1 ? attempts : []);
  } });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25_000);
  let child: ReturnType<typeof spawnBoundedProvider> | undefined;
  let stream: ReturnType<typeof query> | undefined;
  let initialized = false, resultSeen = false;
  const brokerCalls: string[] = [], staged: unknown[] = [];
  const broker = createToolBroker({ workspaceId: "synthetic-contact", runId: name, signal: controller.signal,
    isActive: () => !controller.signal.aborted, allowedTools: classifier ? [] : toolsUsed,
    files: { read: async (_id, path) => { brokerCalls.push(`read:${path}`); return memory.readVersioned(path); },
      write: async (_id, path, text, revision) => { brokerCalls.push(`write:${path}`); return memory.writeVersioned(path, text, revision); } },
    web: { fetchPublic: async () => { throw new Error("FIXTURE_WEB_UNAVAILABLE"); } },
    messaging: { stage: async (_id, _run, action) => { staged.push(action); return { intentId: "synthetic-staged-intent" }; } },
  });
  const names = broker.tools.map(full);
  const schema = {
    "files.read": { path: z.string() },
    "files.write": { path: z.string(), text: z.string(), expectedRevision: z.string().nullable() },
    "messages.propose_text": { text: z.string(), idempotencyKey: z.string() },
  };
  const mcpTools = broker.tools.map((name) => tool(name.replaceAll(".", "_"), "Synthetic qualification broker", schema[name as keyof typeof schema], async (input) => {
    if (!initialized) return { isError: true, content: [{ type: "text", text: "NOT_ADMITTED" }] };
    try { return { content: [{ type: "text", text: JSON.stringify(await broker.invoke(name as BrokerToolName, input)) }] }; }
    catch { return { isError: true, content: [{ type: "text", text: "DENIED" }] }; }
  }));
  const env = { HOME: home, CLAUDE_CONFIG_DIR: config, TMPDIR: temp, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8",
    ANTHROPIC_API_KEY: ["sk", "ant", "api03", "synthetic", "local", "fixture", "credential"].join("-"),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`, CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", CLAUDE_AGENT_SDK_CLIENT_APP: "agentrouter/0.1.0", NO_COLOR: "1" };
  const request = { runId: name, provider: "claude" as const, accountId: "synthetic-account", workspaceId: "synthetic-contact",
    model: "claude-sonnet-4-6", purpose: classifier ? "classify" as const : "respond" as const, prompt: taskText?.({ sibling, marker }) ?? "Synthetic qualification fixture. Return JSON.", signal: controller.signal };
  let observedTools: string[] = [];
  let observedInitialization: unknown;
  try {
    const options = restrictedClaudeOptions({ cwd, env, abortController: controller, model: request.model, maxTurns: 4, maxBudgetUsd: 0.01,
      pathToClaudeCodeExecutable: executable, brokerToolNames: names,
      mcpServers: mcpTools.length ? { agentrouter: createSdkMcpServer({ name: "agentrouter", version: "1.0.0", tools: mcpTools }) } : {},
      spawnClaudeCodeProcess(input) {
        assert(!child && input.command === executable && input.cwd === cwd, "FIXTURE_SPAWN_MISMATCH");
        child = spawnBoundedProvider({ executable, args: input.args, cwd, env, onViolation: () => controller.abort() });
        return child.process;
      } });
    stream = query({ prompt: literalClaudePrompt(request.prompt), options });
    for await (const event of stream) {
      if (event.type === "system" && event.subtype === "init") {
        observedTools = event.tools;
        observedInitialization = { version: event.claude_code_version, cwdMatches: event.cwd === cwd, model: event.model,
          apiKeySource: event.apiKeySource, permissionMode: event.permissionMode, skills: event.skills, plugins: event.plugins,
          mcpServers: event.mcp_servers, keys: Object.keys(event).sort() };
        assertClaudeInitialization(event, request, broker, cwd); initialized = true;
      } else if (event.type === "result") {
        assert(initialized && event.subtype === "success" && !event.is_error, "FIXTURE_NATIVE_RESULT_FAILED");
        resultSeen = true;
      }
    }
    assert(resultSeen && apiCalls > 0, "FIXTURE_RESULT_MISSING");
    assert(JSON.stringify(advertisedTools) === JSON.stringify([...names].sort()), "FIXTURE_API_TOOL_MANIFEST_MISMATCH");
    assert(!loadedInstructions && !loadedDotenv && !leakedCanary && !await exists(marker), "FIXTURE_CONFINEMENT_FAILED");
    assert(await readFile(sibling, "utf8") === canary, "FIXTURE_SIBLING_MODIFIED");
    if (name === "broker-allowed") {
      assert(await memory.read("MEMORY.md") === "synthetic revised memory" && staged.length === 1, "FIXTURE_ALLOWED_BROKER_FAILED");
    } else assert(await memory.read("MEMORY.md") === before.text && staged.length === 0, "FIXTURE_UNEXPECTED_BROKER_EFFECT");
    if (attempts.length) assert(nativeToolResults.length === attempts.length && nativeToolResults.every(result => result.isError === (name !== "broker-allowed")), "FIXTURE_TOOL_DENIAL_EVIDENCE_MISSING");
    results.push({ scenario: name, attempts: attempts.map(attempt => attempt.name), nativeTools: observedTools,
      advertisedTools, apiCalls, denied: nativeToolResults.filter(result => result.isError).length, staged: staged.length,
      inheritedInstructions: loadedInstructions, inheritedDotenv: loadedDotenv, escapedRead: leakedCanary, escapedWriteOrCommand: false });
  } catch (error) {
    results.push({ scenario: name, status: "failed", reason: error instanceof Error && /^FIXTURE_|^CLAUDE_/u.test(error.message) ? error.message : "NATIVE_CONTROL_OR_PROTOCOL_FAILED", observedTools,
      observedInitialization, advertisedTools, apiCalls, toolResults: nativeToolResults });
    throw error;
  } finally {
    clearTimeout(timer); broker.revoke(); stream?.close();
    if (child) await child.stopAndJoin();
    await server.stop(true);
  }
}
try {
  await scenario("classifier-zero-tools", () => [], true);
  await scenario("literal-slash-command", () => [], true, ({ sibling }) => `/add-dir ${dirname(sibling)}`);
  await scenario("literal-bang-command", () => [], true, ({ marker }) => `! /usr/bin/touch '${marker}'`);
  await scenario("workflow-keyword-disabled", () => [], true, () => "ultracode Run a workflow and return JSON.");
  await scenario("builtin-denials", ({ sibling, marker }) => [
    { name: "Bash", input: { command: `/usr/bin/touch '${marker}'` } },
    { name: "Read", input: { file_path: sibling } },
    { name: "Write", input: { file_path: sibling, content: "bad overwrite" } },
    { name: "Edit", input: { file_path: sibling, old_string: "SYNTHETIC", new_string: "bad" } },
    { name: "Glob", input: { pattern: "**", path: dirname(sibling) } },
    { name: "Grep", input: { pattern: "SYNTHETIC", path: sibling } },
    { name: "Agent", input: { description: "fixture", prompt: "Read unrelated files", subagent_type: "general-purpose" } },
    { name: "Skill", input: { skill: "fixture" } },
    { name: "WebFetch", input: { url: "https://example.com", prompt: "fixture" } },
    { name: "ToolSearch", input: { query: "Bash" } },
  ]);
  await scenario("broker-allowed", ({ revision }) => [
    { name: full("files.write"), input: { path: "MEMORY.md", text: "synthetic revised memory", expectedRevision: revision } },
    { name: full("messages.propose_text"), input: { text: "synthetic staged reply", idempotencyKey: "fixture-message" } },
  ]);
  await scenario("broker-escape-denials", ({ sibling }) => [
    { name: full("files.read"), input: { path: "../other-contact.md" } },
    { name: full("files.read"), input: { path: sibling } },
    { name: full("files.read"), input: { path: "notes/escape.md" } },
    { name: full("files.read"), input: { path: "notes/hardlink.md" } },
    { name: full("files.write"), input: { path: "../other-contact.md", text: "bad overwrite", expectedRevision: null } },
    { name: full("files.write"), input: { path: "MEMORY.md", text: "stale overwrite", expectedRevision: "0".repeat(64) } },
  ]);
  console.log(JSON.stringify({ profile: "native-synthetic-model-visible-tools", runtimeVersion: inspected.runtimeVersion, runtimeDigest: inspected.runtimeDigest,
    platform: `${process.platform}-${process.arch}`, realCredentialsUsed: false, paidModelRequests: 0, productionQualificationIssued: false, scenarios: results }, null, 2));
} catch {
  console.log(JSON.stringify({ profile: "native-synthetic-model-visible-tools", productionQualificationIssued: false, status: "failed", scenarios: results }, null, 2));
  process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true }); }
