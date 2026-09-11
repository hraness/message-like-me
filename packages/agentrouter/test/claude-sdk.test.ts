import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AgentRouter, CONTACT_TOOL_PROFILE, SqliteAccountLeases, createClaudeSdkAdapter, createToolBroker,
  inspectClaudeSdkRuntime, type RuntimeQualification, type ClaudeApiKeyResolver } from "../src/index.ts";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const fakeKey = ["sk", "ant", "api03", "synthetic", "test", "key", "never", "valid"].join("-");
const credentials: ClaudeApiKeyResolver = { withApiKey: async (_id, signal, use) => { signal.throwIfAborted(); return use(fakeKey); } };

// This is a synthetic CLI peer of the REAL pinned SDK. It never contacts a provider,
// and proves adapter protocol/lifecycle behavior only, not native runtime qualification.
const cliSource = `#!${process.execPath}
import { createInterface } from 'node:readline';
const args=process.argv.slice(2), get=(name)=>args.indexOf(name)===-1?undefined:args[args.indexOf(name)+1];
const output=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');
let request, calls=[], nextId=1, pending=new Map();
const sendMcp=(message)=>new Promise(resolve=>{const id='fixture-'+nextId++; pending.set(id,resolve); output({type:'control_request',request_id:id,request:{subtype:'mcp_message',server_name:'agentrouter',message}})});
const init=()=>({type:'system',subtype:'init',session_id:'synthetic-session',uuid:'synthetic-init',claude_code_version:'2.1.268',cwd:process.cwd(),
  model:request.badModel?'wrong-model':get('--model'),apiKeySource:'ANTHROPIC_API_KEY',permissionMode:'dontAsk',
  tools:request.extraTool?['Bash']:(get('--allowedTools')||'').split(',').filter(Boolean),
  skills:[],plugins:[],mcp_servers:get('--allowedTools')?[{name:'agentrouter',status:'connected'}]:[],slash_commands:[],output_style:'default'});
async function run(frame){
 const plain=typeof frame.message.content==='string'?frame.message.content:frame.message.content[0].text;
 if(!plain.startsWith('Agentrouter task, supplied as plain text:'))throw new Error('MISSING_LITERAL_GUARD');
 request=JSON.parse(plain.slice(plain.indexOf('\\n\\n')+2));
 output(init());
 if(request.hang){process.on('SIGTERM',()=>{});return;}
 for(const call of request.calls||[]){
  const result=await sendMcp({jsonrpc:'2.0',id:nextId,method:'tools/call',params:{name:call.name,arguments:call.input}});
  calls.push(result);
 }
 const result={calls,toolsEmpty:get('--tools')==='',settingsSourcesEmpty:args.includes('--setting-sources='),strictMcp:args.includes('--strict-mcp-config'),persisted:!args.includes('--no-session-persistence'),
  ambient:process.env.AGENTROUTER_SYNTHETIC_SECRET??null,authMatches:process.env.ANTHROPIC_API_KEY==='${fakeKey}',cwd:process.cwd(),home:process.env.HOME,
  settings:JSON.parse(get('--settings')||'{}')};
 output({type:'result',subtype:'success',session_id:'synthetic-session',uuid:'synthetic-result',is_error:false,result:JSON.stringify(result),num_turns:1,total_cost_usd:0,duration_ms:1,duration_api_ms:0,usage:{},modelUsage:{},permission_denials:[],stop_reason:'end_turn'});
}
for await(const line of createInterface({input:process.stdin})){
 let frame;try{frame=JSON.parse(line)}catch{process.exit(2)}
 if(frame.type==='control_request'){
  output({type:'control_response',response:{subtype:'success',request_id:frame.request_id,response:{commands:[],agents:[],models:[],account:{},output_style:'default',available_output_styles:['default']}}});
 }else if(frame.type==='control_response'){
  const response=frame.response;pending.get(response.request_id)?.(response);pending.delete(response.request_id);
 }else if(frame.type==='user')void run(frame).catch(error=>{console.error(error.message);process.exit(3)});
}
`;

async function setup() {
  const original = await mkdtemp(join(tmpdir(), "agentrouter-claude-")); directories.push(original);
  const root = await realpath(original), executablePath = join(root, "synthetic-cli");
  await writeFile(executablePath, cliSource, { mode: 0o700 });
  const executableSha256 = createHash("sha256").update(await readFile(executablePath)).digest("hex");
  const runtime = { executablePath, executableSha256 };
  const inspected = await inspectClaudeSdkRuntime(runtime);
  const qualification: RuntimeQualification = { status: "qualified", profile: CONTACT_TOOL_PROFILE,
    runtimeVersion: inspected.runtimeVersion, runtimeDigest: inspected.runtimeDigest,
    evidenceDigest: "1".repeat(64), expiresAt: 10_000,
    controls: { noCommandTools: true, exactToolInventory: true, contactReadIsolation: true, contactWriteIsolation: true,
      isolatedConfiguration: true, authOutsideWorkspace: true, hostBrokerOnly: true } };
  return { root, runtime, qualification };
}
function makeBroker(signal = new AbortController().signal, classifier = false) {
  const calls: unknown[] = [];
  const broker = createToolBroker({ workspaceId: "contact-one", runId: "run-one", signal, isActive: () => !signal.aborted,
    ...(classifier ? { allowedTools: [] } : {}),
    files: { read: async (...args) => { calls.push(args.slice(0, 2)); return { text: "synthetic memory", revision: "rev-one" }; },
      write: async (...args) => { calls.push(args.slice(0, 4)); return { revision: "rev-two" }; } },
    web: { fetchPublic: async () => { throw new Error("NO_NETWORK_IN_FIXTURE"); } },
    messaging: { stage: async (...args) => { calls.push(args.slice(0, 3)); return { intentId: "staged-one" }; } },
  });
  return { broker, calls };
}
const makeRequest = (payload: unknown, signal = new AbortController().signal) => ({
  provider: "claude" as const, accountId: "account-one", workspaceId: "contact-one", runId: "run-one", model: "synthetic-model",
  purpose: "respond" as const, prompt: JSON.stringify(payload), signal,
});

test("real SDK classifier has zero tools, fresh state, no inherited config or credentials, and confirmed process exit", async () => {
  const setupValue = await setup();
  const before = process.env.AGENTROUTER_SYNTHETIC_SECRET;
  process.env.AGENTROUTER_SYNTHETIC_SECRET = "should-not-cross";
  try {
    const adapter = createClaudeSdkAdapter({ ...setupValue, stateRoot: setupValue.root, credentials, now: () => 1 });
    const { broker } = makeBroker(undefined, true);
    const result = await adapter.run({ ...makeRequest({}), purpose: "classify" }, broker);
    const output = result.output as Record<string, unknown>;
    expect(output.toolsEmpty).toBe(true); expect(output.settingsSourcesEmpty).toBe(true); expect(output.strictMcp).toBe(true);
    expect(output.persisted).toBe(false); expect(output.ambient).toBeNull(); expect(output.authMatches).toBe(true);
    expect(output.settings).toMatchObject({ disableAllHooks: true, disableClaudeAiConnectors: true, autoMemoryEnabled: false,
      disableBundledSkills: true, disableSkillShellExecution: true, enableWorkflows: false, workflowKeywordTriggerEnabled: false, skillOverrides: { doctor: "off", checkup: "off" } });
    expect(result.processStopped).toBe(true);
    await expect(stat(String(output.cwd))).rejects.toThrow();
  } finally {
    if (before === undefined) delete process.env.AGENTROUTER_SYNTHETIC_SECRET; else process.env.AGENTROUTER_SYNTHETIC_SECRET = before;
  }
}, 10_000);

test("real SDK MCP bridge conditionally edits and stages messaging only within its fixed broker", async () => {
  const value = await setup(); const { broker, calls } = makeBroker();
  const adapter = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials, now: () => 1 });
  await adapter.run(makeRequest({ calls: [
    { name: "files_write", input: { path: "memory.md", text: "remember this", expectedRevision: "rev-one" } },
    { name: "messages_propose_text", input: { text: "hello", idempotencyKey: "message-one" } },
    { name: "files_read", input: { path: "../other-contact/memory.md" } },
  ] }), broker);
  expect(calls).toEqual([
    ["contact-one", "memory.md", "remember this", "rev-one"],
    ["contact-one", "run-one", { kind: "text", text: "hello", idempotencyKey: "message-one" }],
  ]);
}, 10_000);

test.each([{ extraTool: true }, { badModel: true }])("unexpected native tool inventory or model fails closed and releases a joined account", async (payload) => {
  const value = await setup(); const { broker, calls } = makeBroker(); const db = new Database(":memory:");
  try {
    const leases = new SqliteAccountLeases(db);
    const adapter = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials, now: () => 1 });
    const router = new AgentRouter({ adapters: [adapter], leases, now: () => 1 });
    await expect(router.run(makeRequest(payload), broker)).rejects.toThrow("CLAUDE_RUN_FAILED");
    expect(calls).toEqual([]); expect(leases.inspect("claude", "account-one")).toBeNull();
  } finally { db.close(); }
}, 10_000);

test("unqualified and changed executables fail before resolving an API key", async () => {
  const value = await setup(); let resolves = 0;
  const guarded: ClaudeApiKeyResolver = { withApiKey: async () => { resolves++; throw new Error("MUST_NOT_RESOLVE"); } };
  const unqualified = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials: guarded, now: () => 1,
    qualification: { status: "unqualified", reason: "fixture" } });
  await expect(unqualified.run(makeRequest({}), makeBroker().broker)).rejects.toThrow("PROVIDER_UNQUALIFIED");
  await writeFile(value.runtime.executablePath, "changed", { mode: 0o700 });
  const changed = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials: guarded, now: () => 1 });
  await expect(changed.run(makeRequest({}), makeBroker().broker)).rejects.toThrow("PREFLIGHT_FAILED");
  expect(resolves).toBe(0);
});

test("revocation kills and joins a stalled SDK child before releasing account custody", async () => {
  const value = await setup(); const controller = new AbortController(); const { broker } = makeBroker(controller.signal);
  const db = new Database(":memory:");
  try {
    const leases = new SqliteAccountLeases(db), adapter = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials, now: () => 1 });
    const pending = new AgentRouter({ adapters: [adapter], leases, now: () => 1 }).run(makeRequest({ hang: true }, controller.signal), broker);
    const timer = setTimeout(() => controller.abort(), 250);
    try { await expect(pending).rejects.toThrow("CLAUDE_RUN_FAILED"); } finally { clearTimeout(timer); }
    expect(leases.inspect("claude", "account-one")).toBeNull();
  } finally { db.close(); }
}, 10_000);

test("non-executable runtime files fail preflight without stranding a lease", async () => {
  const value = await setup(); await chmod(value.runtime.executablePath, 0o600); const db = new Database(":memory:");
  try {
    const leases = new SqliteAccountLeases(db), adapter = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials, now: () => 1 });
    await expect(new AgentRouter({ adapters: [adapter], leases, now: () => 1 }).run(makeRequest({}), makeBroker().broker)).rejects.toThrow("CLAUDE_RUNTIME_PREFLIGHT_FAILED");
    expect(leases.inspect("claude", "account-one")).toBeNull();
  } finally { db.close(); }
}, 10_000);


test("credential resolution cannot substitute the checked private executable snapshot", async () => {
  const value = await setup();
  const swapping: ClaudeApiKeyResolver = { withApiKey: async (_id, _signal, use) => {
    await writeFile(value.runtime.executablePath, "changed after checked snapshot");
    return use(fakeKey);
  } };
  const adapter = createClaudeSdkAdapter({ ...value, stateRoot: value.root, credentials: swapping, now: () => 1 });
  expect(Object.isFrozen(adapter.qualification)).toBe(true);
  if (adapter.qualification.status === "qualified") expect(Object.isFrozen(adapter.qualification.controls)).toBe(true);
  const result = await adapter.run({ ...makeRequest({}), purpose: "classify" }, makeBroker(undefined, true).broker);
  expect((result.output as { authMatches: boolean }).authMatches).toBe(true);
  expect(result.processStopped).toBe(true);
}, 10_000);


test("a FIFO runtime path is rejected without waiting for a writer", async () => {
  const value = await setup();
  const executablePath = join(value.root, "synthetic-fifo");
  execFileSync("/usr/bin/mkfifo", ["-m", "600", executablePath]);
  await expect(inspectClaudeSdkRuntime({ executablePath, executableSha256: "0".repeat(64) })).rejects.toThrow("CLAUDE_RUNTIME_INVALID");
}, 2_000);
