import { expect, test } from "bun:test";
import { CODEX_MANAGED_ACCOUNT_FEATURES, codexManagedAccountConfiguration } from "../src/codex-managed-baseline.ts";
import { CODEX_DISABLED_FEATURES, codexTaskSettings } from "../src/codex-config.ts";
import { assertCodexManagedAccountResponse, assertCodexManagedConfigResponse, assertCodexManagedThreadResponse,
  codexManagedTaskConfiguration, codexManagedThreadConfiguration } from "../src/codex-managed-config.ts";

const settings = codexTaskSettings({ model: { id: "synthetic-model", reasoningEffort: "medium", serviceTier: "default" },
  instructions: { base: "Read the retained corpus.", developer: "Use only the supplied tools." } });
const expected = { settings, cwd: "/synthetic/owned/work" };
const configResponse = () => ({ config: {
  model: null, model_provider: "openai", model_reasoning_effort: null, service_tier: null,
  forced_login_method: "chatgpt", approval_policy: "never", sandbox_mode: "read-only", web_search: "disabled",
  instructions: null, developer_instructions: null, mcp_servers: {},
  features: Object.fromEntries(CODEX_MANAGED_ACCOUNT_FEATURES.map(name => [name, false])),
  apps: { _default: { enabled: false, destructive_enabled: false, open_world_enabled: false } },
}, origins: {}, layers: null });
const threadResponse = () => ({ model: settings.model.id, modelProvider: "openai", reasoningEffort: "medium", serviceTier: "default",
  cwd: expected.cwd, approvalPolicy: "never", approvalsReviewer: "user", sandbox: { type: "readOnly", networkAccess: false },
  runtimeWorkspaceRoots: [], instructionSources: [],
  thread: { id: "thread-one", cwd: expected.cwd, modelProvider: "openai", ephemeral: true, turns: [], environments: [] },
});

test("managed tasks preserve the admitted persistent account baseline bytes", () => {
  const other = codexTaskSettings({ model: { id: "another-synthetic-model", reasoningEffort: "high", serviceTier: "priority" },
    instructions: { base: "A different retained corpus.", developer: "A different task instruction." } });
  const first = codexManagedTaskConfiguration(settings), second = codexManagedTaskConfiguration(other);
  expect(first).toBe(second); expect(first).toBe(codexManagedAccountConfiguration());
  expect(new Bun.CryptoHasher("sha256").update(first).digest("hex"))
    .toBe("9833be747176d26b0915621439e2cbea1bff12aeca6f7854e45265777bb98ae8");
});

test("managed configuration keeps native authentication and disables inherited capabilities", () => {
  const config = Bun.TOML.parse(codexManagedTaskConfiguration(settings)) as Record<string, any>;
  expect(config.model_provider).toBe("openai"); expect(config.forced_login_method).toBe("chatgpt");
  expect(config.model).toBeUndefined(); expect(config.model_reasoning_effort).toBeUndefined(); expect(config.service_tier).toBeUndefined();
  expect(config.cli_auth_credentials_store).toBe("file"); expect(config.mcp_oauth_credentials_store).toBe("file");
  expect(config.history.persistence).toBe("none"); expect(config.check_for_update_on_startup).toBe(false);
  expect(config.allow_login_shell).toBe(false); expect(config.notify).toEqual([]); expect(config.plugins).toEqual({});
  expect(config.sandbox_mode).toBe("read-only"); expect(config.approval_policy).toBe("never");
  expect(config.web_search).toBe("disabled"); expect(config.project_doc_max_bytes).toBe(0);
  expect(config.mcp_servers).toEqual({}); expect(config.shell_environment_policy).toEqual({ inherit: "none" });
  expect(config.features).toEqual(Object.fromEntries(CODEX_MANAGED_ACCOUNT_FEATURES.map(name => [name, false])));
  expect(config.apps._default).toEqual({ enabled: false, destructive_enabled: false, open_world_enabled: false });
  expect(config.skills).toEqual({ include_instructions: false, bundled: { enabled: false } });
  expect(config.model_providers).toBeUndefined(); expect(config.openai_base_url).toBeUndefined();
  expect(config.chatgpt_base_url).toBeUndefined(); expect(config.auth).toBeUndefined();
  expect(() => codexManagedTaskConfiguration({ ...settings, instructionDigest: "0".repeat(64) })).toThrow("CODEX_TASK_SETTINGS_CHANGED");
});

test("task text never enters persistent TOML and unset selections preserve native defaults", () => {
  const unset = codexTaskSettings({ model: { id: 'model"\n[model_providers.evil]', reasoningEffort: null, serviceTier: null },
    instructions: settings.instructions });
  const parsed = Bun.TOML.parse(codexManagedTaskConfiguration(unset)) as Record<string, any>;
  expect(parsed.model).toBeUndefined();
  expect(codexManagedTaskConfiguration(unset)).not.toContain(unset.model.id); expect(parsed.model_providers).toBeUndefined();
  expect(parsed.model_reasoning_effort).toBeUndefined(); expect(parsed.service_tier).toBeUndefined();
  expect(codexManagedThreadConfiguration(unset).model_reasoning_effort).toBeUndefined();
  const defaults = { ...expected, settings: codexTaskSettings({ model: { id: settings.model.id, reasoningEffort: null, serviceTier: null },
    instructions: settings.instructions }) };
  expect(assertCodexManagedThreadResponse(threadResponse(), defaults)).toEqual({ model: settings.model.id, reasoningEffort: "medium", serviceTier: "default" });
  expect(assertCodexManagedThreadResponse({ ...threadResponse(), reasoningEffort: null, serviceTier: null }, defaults))
    .toEqual({ model: settings.model.id, reasoningEffort: null, serviceTier: null });
});

test("the trusted thread overlay retains every task denial and cannot forward arbitrary config", () => {
  const overlay = codexManagedThreadConfiguration(settings);
  expect(overlay).toEqual({
    features: Object.fromEntries([...new Set([...CODEX_MANAGED_ACCOUNT_FEATURES, ...CODEX_DISABLED_FEATURES])].map(name => [name, false])),
    tools: { experimental_request_user_input: { enabled: false }, update_plan: { enabled: false } },
    model_reasoning_effort: "medium",
  });
  for (const name of ["remote_control", "browser_use_external", "goals", "sleep_tool", "code_mode_host", "view_image"]) {
    expect(overlay.features[name]).toBe(false);
  }
  expect(Object.isFrozen(overlay)).toBe(true); expect(Object.isFrozen(overlay.features)).toBe(true);
  expect(Object.isFrozen(overlay.tools)).toBe(true); expect(Object.isFrozen(overlay.tools.update_plan)).toBe(true);
  expect(Object.isFrozen(overlay.tools.experimental_request_user_input)).toBe(true);
  expect(() => codexManagedThreadConfiguration({ ...settings, config: { features: { shell_tool: true } } } as never))
    .toThrow("CODEX_MANAGED_RECORD_INVALID");
  let reads = 0;
  const poisoned = { ...settings, model: Object.defineProperty({ ...settings.model }, "reasoningEffort",
    { enumerable: true, get() { reads++; return "medium"; } }) };
  expect(() => codexManagedThreadConfiguration(poisoned)).toThrow("CODEX_MANAGED_RECORD_INVALID");
  expect(() => codexManagedTaskConfiguration(poisoned)).toThrow("CODEX_MANAGED_RECORD_INVALID");
  expect(reads).toBe(0);
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

test("baseline projection rejects unsafe controls without treating defaults as task selections", () => {
  expect(assertCodexManagedConfigResponse(configResponse(), expected)).toBeUndefined();
  expect(assertCodexManagedConfigResponse({ ...configResponse(), config: { ...configResponse().config,
    model: "a-native-default", model_reasoning_effort: "low", service_tier: "priority" } }, expected)).toBeUndefined();
  for (const changes of [
    { model_provider: "custom" }, { model: {} }, { model_reasoning_effort: 1 }, { service_tier: [] },
    { cli_auth_credentials_store: "keyring" }, { mcp_oauth_credentials_store: "auto" }, { history: { persistence: "save-all" } },
    { check_for_update_on_startup: true }, { allow_login_shell: true }, { notify: ["command"] }, { plugins: { foreign: true } },
    { project_doc_max_bytes: 1 }, { shell_environment_policy: { inherit: "all" } }, { analytics: { enabled: true } },
    { feedback: { enabled: true } },
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
