import { expect, test } from "bun:test";
import { CODEX_DISABLED_FEATURES, codexTaskSettings } from "../src/codex-config.ts";
import { assertCodexManagedAccountResponse, assertCodexManagedConfigResponse, assertCodexManagedThreadResponse,
  codexManagedTaskConfiguration } from "../src/codex-managed-config.ts";

const settings = codexTaskSettings({ model: { id: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" },
  instructions: { base: "Read the retained corpus.", developer: "Use only the supplied tools." } });
const expected = { settings, cwd: "/synthetic/owned/work" };
const configResponse = () => ({ config: {
  model: settings.model.id, model_provider: "openai", model_reasoning_effort: "medium", service_tier: "default",
  forced_login_method: "chatgpt", approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled",
  instructions: null, developer_instructions: null, mcp_servers: {},
  features: Object.fromEntries(CODEX_DISABLED_FEATURES.map(name => [name, false])),
  apps: { _default: { enabled: false, destructive_enabled: false, open_world_enabled: false } },
}, origins: {}, layers: null });
const threadResponse = () => ({ model: settings.model.id, modelProvider: "openai", reasoningEffort: "medium", serviceTier: "default",
  cwd: expected.cwd, approvalPolicy: "never", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false },
  runtimeWorkspaceRoots: [], instructionSources: [],
  thread: { id: "thread-one", cwd: expected.cwd, modelProvider: "openai", ephemeral: true, turns: [], environments: [] },
});

test("managed configuration keeps native authentication and disables inherited capabilities", () => {
  const config = Bun.TOML.parse(codexManagedTaskConfiguration(settings)) as Record<string, any>;
  expect(config.model_provider).toBe("openai"); expect(config.forced_login_method).toBe("chatgpt");
  expect(config.model_reasoning_effort).toBe("medium"); expect(config.service_tier).toBe("default");
  expect(config.sandbox_mode).toBe("read-only"); expect(config.approval_policy).toBe("never");
  expect(config.web_search).toBe("disabled"); expect(config.project_doc_max_bytes).toBe(0);
  expect(config.mcp_servers).toEqual({}); expect(config.shell_environment_policy).toEqual({ inherit: "none" });
  expect(config.features).toEqual(Object.fromEntries(CODEX_DISABLED_FEATURES.map(name => [name, false])));
  expect(config.apps._default).toEqual({ enabled: false, destructive_enabled: false, open_world_enabled: false });
  expect(config.skills).toEqual({ include_instructions: false, bundled: { enabled: false } });
  expect(config.model_providers).toBeUndefined(); expect(config.openai_base_url).toBeUndefined();
  expect(config.chatgpt_base_url).toBeUndefined(); expect(config.auth).toBeUndefined();
  expect(() => codexManagedTaskConfiguration({ ...settings, instructionDigest: "0".repeat(64) })).toThrow("CODEX_TASK_SETTINGS_CHANGED");
});

test("managed settings serialize inert TOML and preserve unset defaults", () => {
  const unset = codexTaskSettings({ model: { id: 'model"\n[model_providers.evil]', reasoningEffort: null, serviceTier: null },
    instructions: settings.instructions });
  const parsed = Bun.TOML.parse(codexManagedTaskConfiguration(unset)) as Record<string, any>;
  expect(parsed.model).toBe(unset.model.id); expect(parsed.model_providers).toBeUndefined();
  expect(parsed.model_reasoning_effort).toBeUndefined(); expect(parsed.service_tier).toBeUndefined();
  const defaults = { ...expected, settings: codexTaskSettings({ model: { id: settings.model.id, reasoningEffort: null, serviceTier: null },
    instructions: settings.instructions }) };
  expect(assertCodexManagedThreadResponse(threadResponse(), defaults)).toEqual({ model: settings.model.id, reasoningEffort: "medium", serviceTier: "default" });
  expect(assertCodexManagedThreadResponse({ ...threadResponse(), reasoningEffort: null, serviceTier: null }, defaults))
    .toEqual({ model: settings.model.id, reasoningEffort: null, serviceTier: null });
});

test("account response admits only the ChatGPT account shape without retaining identity", () => {
  expect(assertCodexManagedAccountResponse({ account: { type: "chatgpt", email: "fixture@example.invalid", planType: "pro" }, requiresOpenaiAuth: true })).toBeUndefined();
  expect(assertCodexManagedAccountResponse({ account: { type: "chatgpt", email: null, planType: "plus" }, requiresOpenaiAuth: true })).toBeUndefined();
  for (const raw of [
    { account: null, requiresOpenaiAuth: true }, { account: { type: "apiKey" }, requiresOpenaiAuth: true },
    { account: { type: "chatgptAuthTokens", email: null, planType: "pro" }, requiresOpenaiAuth: true },
    { account: { type: "chatgpt", email: null, planType: "pro" }, requiresOpenaiAuth: false },
    { account: { type: "chatgpt", email: null, planType: "pro", accessToken: "synthetic-never-admitted" }, requiresOpenaiAuth: true },
  ]) expect(() => assertCodexManagedAccountResponse(raw)).toThrow();
});

test("effective configuration rejects provider, settings, inherited instructions and projected tools drift", () => {
  expect(assertCodexManagedConfigResponse(configResponse(), expected)).toBeUndefined();
  for (const changes of [
    { model_provider: "custom" }, { model: "changed" }, { model_reasoning_effort: null }, { service_tier: "priority" },
    { forced_login_method: "api" }, { sandbox_mode: "workspace-write" }, { approval_policy: "on-request" },
    { web_search: "cached" }, { developer_instructions: "Inherited content" }, { instructions: "Inherited content" },
    { mcp_servers: { foreign: {} } }, { features: { ...configResponse().config.features, shell_tool: true } },
    { apps: { _default: { enabled: true, destructive_enabled: false, open_world_enabled: false } } },
    { apps: { ...configResponse().config.apps, foreign: { enabled: true } } },
  ]) expect(() => assertCodexManagedConfigResponse({ ...configResponse(), config: { ...configResponse().config, ...changes } }, expected)).toThrow();
});

test("thread admission binds exact model, settings, scratch and read-only controls", () => {
  expect(assertCodexManagedThreadResponse(threadResponse(), expected)).toEqual({ model: settings.model.id, reasoningEffort: "medium", serviceTier: "default" });
  for (const changes of [
    { model: "changed" }, { modelProvider: "custom" }, { reasoningEffort: "high" }, { reasoningEffort: undefined },
    { serviceTier: "priority" }, { serviceTier: null }, { cwd: "/foreign" }, { approvalPolicy: "on-request" },
    { sandbox: { type: "workspaceWrite", networkAccess: false } }, { sandbox: { type: "readOnly", networkAccess: true } },
    { sandbox: { type: "readOnly", writableRoots: ["/foreign"] } },
    { runtimeWorkspaceRoots: ["/foreign"] }, { runtimeWorkspaceRoots: undefined }, { instructionSources: ["/foreign/AGENTS.md"] },
    { thread: { ...threadResponse().thread, ephemeral: false } }, { thread: { ...threadResponse().thread, turns: [{}] } },
    { thread: { ...threadResponse().thread, cwd: "/foreign" } }, { thread: { ...threadResponse().thread, environments: [{}] } },
  ]) expect(() => assertCodexManagedThreadResponse({ ...threadResponse(), ...changes }, expected)).toThrow();
  expect(() => assertCodexManagedThreadResponse(threadResponse(), { ...expected, cwd: "/synthetic/../work" })).toThrow("CODEX_MANAGED_CWD_INVALID");
});

test("native reply validators do not execute accessors", () => {
  let reads = 0;
  const poisoned = Object.defineProperty({}, "account", { enumerable: true, get() { reads++; return {}; } });
  expect(() => assertCodexManagedAccountResponse(poisoned)).toThrow("CODEX_MANAGED_RECORD_INVALID");
  const response = threadResponse();
  Object.defineProperty(response, "model", { enumerable: true, get() { reads++; return "synthetic-model"; } });
  expect(() => assertCodexManagedThreadResponse(response, expected)).toThrow("CODEX_MANAGED_RECORD_INVALID");
  expect(reads).toBe(0);
});
