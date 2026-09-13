import { isAbsolute, resolve } from "node:path";
import { CODEX_DISABLED_FEATURES, codexTaskSettings, type CodexTaskSettings } from "./codex-config.ts";
import type { CodexProcessHandle } from "./codex-process.ts";
import { boundedText, identifier } from "./validation.ts";

export const CODEX_MANAGED_PROVIDER = "openai";

/** Trusted native host port, not an implementation or a qualification. The host
 * owns Codex-managed ChatGPT login/refresh in isolated state outside consumer
 * workspaces. It must not inject external tokens, inherit user configuration, or
 * expose auth state to model tools. Configuration text alone proves none of this.
 * Preserve the existing native process-custody receipt and stop/join contract.
 */
export interface CodexManagedProcessLauncher {
  launch(input: { runId: string; accountId: string; workspaceId: string; configuration: string;
    signal: AbortSignal }): Promise<CodexProcessHandle>;
}

type Expected = Readonly<{ settings: CodexTaskSettings; cwd: string }>;
export type CodexManagedObservedSettings = Readonly<{ model: string; reasoningEffort: string | null; serviceTier: string | null }>;
const fail = (code: string): never => { throw new Error(code); };
function record(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail("CODEX_MANAGED_RECORD_INVALID");
  const own = Reflect.ownKeys(value);
  if (own.length > 128 || own.some(key => typeof key !== "string" || keys && !keys.includes(key)
    || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
    || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) return fail("CODEX_MANAGED_RECORD_INVALID");
  return value as Record<string, unknown>;
}
function settingsSnapshot(settings: CodexTaskSettings): CodexTaskSettings {
  record(settings, ["model", "instructions", "instructionDigest"]);
  record(settings.model, ["id", "reasoningEffort", "serviceTier"]);
  record(settings.instructions, ["base", "developer"]);
  const admitted = codexTaskSettings({ model: settings.model, instructions: settings.instructions });
  if (admitted.instructionDigest !== settings.instructionDigest) return fail("CODEX_TASK_SETTINGS_CHANGED");
  return admitted;
}
function expectedPath(cwd: string): string {
  boundedText(cwd, 4096);
  if (!isAbsolute(cwd) || resolve(cwd) !== cwd || /[\x00-\x1f\x7f]/u.test(cwd)) return fail("CODEX_MANAGED_CWD_INVALID");
  return cwd;
}
function observedSetting(raw: unknown, expected: string | null): string | null {
  if (raw !== null && typeof raw !== "string") return fail("CODEX_MANAGED_SETTINGS_MISMATCH");
  const value = raw === null ? null : boundedText(raw, 160);
  if (expected !== null && value !== expected) return fail("CODEX_MANAGED_SETTINGS_MISMATCH");
  return value;
}
function emptyArray(value: unknown): boolean { return Array.isArray(value) && value.length === 0; }

/** Native OpenAI transport only: no custom endpoint, upstream or credential
 * field. The host must load this as an isolated configuration. Disabled flags
 * are requested controls, not an effective model-tool inventory attestation.
 */
export function codexManagedTaskConfiguration(settings: CodexTaskSettings): string {
  const admitted = settingsSnapshot(settings);
  return [
    `model_provider = "${CODEX_MANAGED_PROVIDER}"`, `model = ${JSON.stringify(admitted.model.id)}`,
    ...(admitted.model.reasoningEffort === null ? [] : [`model_reasoning_effort = ${JSON.stringify(admitted.model.reasoningEffort)}`]),
    ...(admitted.model.serviceTier === null ? [] : [`service_tier = ${JSON.stringify(admitted.model.serviceTier)}`]),
    'forced_login_method = "chatgpt"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
    'web_search = "disabled"', 'project_doc_max_bytes = 0', 'mcp_servers = {}',
    '[shell_environment_policy]', 'inherit = "none"', '[analytics]', 'enabled = false', '[feedback]', 'enabled = false',
    '[features]', ...CODEX_DISABLED_FEATURES.map(name => `${name} = false`),
    '[apps._default]', 'enabled = false', 'destructive_enabled = false', 'open_world_enabled = false',
    '[orchestrator.skills]', 'enabled = false', '[skills]', 'include_instructions = false',
    '[skills.bundled]', 'enabled = false', '[tools.experimental_request_user_input]', 'enabled = false',
    '[tools.update_plan]', 'enabled = false', '',
  ].join("\n");
}

/** account/read identifies ChatGPT, but its pinned Account union cannot
 * distinguish native-managed from externally supplied ChatGPT tokens. The
 * trusted launcher owns that distinction. Never return email or plan data.
 */
export function assertCodexManagedAccountResponse(raw: unknown): void {
  const response = record(raw, ["account", "requiresOpenaiAuth"]);
  if (response.requiresOpenaiAuth !== true) return fail("CODEX_MANAGED_ACCOUNT_REQUIRED");
  const account = record(response.account, ["type", "email", "planType"]);
  if (account.type !== "chatgpt") return fail("CODEX_MANAGED_ACCOUNT_REQUIRED");
  if (account.email !== null) boundedText(account.email, 512, true);
  boundedText(account.planType, 160);
}

/** Checks the public effective-config projection before a turn. Fields omitted
 * by that projection cannot establish complete configuration isolation, tool
 * inventory or OS confinement; those remain separate host qualification gates.
 */
export function assertCodexManagedConfigResponse(raw: unknown, expected: Expected): void {
  const settings = settingsSnapshot(expected.settings); expectedPath(expected.cwd);
  const response = record(raw, ["config", "layers", "origins"]), config = record(response.config);
  if (config.model !== settings.model.id || config.model_provider !== CODEX_MANAGED_PROVIDER
    || config.approval_policy !== "never" || config.sandbox_mode !== "read-only" || config.web_search !== "disabled"
    || config.forced_login_method !== "chatgpt") return fail("CODEX_MANAGED_CONFIG_MISMATCH");
  observedSetting(config.model_reasoning_effort ?? null, settings.model.reasoningEffort);
  observedSetting(config.service_tier ?? null, settings.model.serviceTier);
  for (const field of ["instructions", "developer_instructions"]) {
    if (config[field] != null && config[field] !== "") return fail("CODEX_MANAGED_INHERITED_INSTRUCTIONS");
  }
  if (config.mcp_servers !== undefined && Object.keys(record(config.mcp_servers)).length !== 0) return fail("CODEX_MANAGED_CONFIG_MISMATCH");
  if (config.features !== undefined) {
    const features = record(config.features);
    for (const name of CODEX_DISABLED_FEATURES) if (features[name] !== false) return fail("CODEX_MANAGED_CONFIG_MISMATCH");
  }
  const apps = record(config.apps), defaults = record(apps._default);
  if (defaults.enabled !== false || defaults.destructive_enabled !== false || defaults.open_world_enabled !== false
    || Object.keys(apps).some(name => name !== "_default")) return fail("CODEX_MANAGED_CONFIG_MISMATCH");
}

/** Validates the native thread's observable controls, not the full runtime tool
 * inventory. Null requested effort/tier preserve native defaults; return those
 * observations separately so callers do not mislabel defaults as user intent.
 */
export function assertCodexManagedThreadResponse(raw: unknown, expected: Expected): CodexManagedObservedSettings {
  const settings = settingsSnapshot(expected.settings), cwd = expectedPath(expected.cwd);
  const response = record(raw, ["activePermissionProfile", "approvalPolicy", "approvalsReviewer", "cwd", "instructionSources",
    "model", "modelProvider", "multiAgentMode", "reasoningEffort", "runtimeWorkspaceRoots", "sandbox", "serviceTier", "thread"]);
  const sandbox = record(response.sandbox, ["type", "networkAccess"]);
  if (response.model !== settings.model.id || response.modelProvider !== CODEX_MANAGED_PROVIDER || response.cwd !== cwd
    || response.approvalPolicy !== "never" || !["user", "auto_review", "guardian_subagent"].includes(String(response.approvalsReviewer))
    || sandbox.type !== "readOnly" || sandbox.networkAccess !== undefined && sandbox.networkAccess !== false
    || !emptyArray(response.runtimeWorkspaceRoots) || !emptyArray(response.instructionSources)) return fail("CODEX_MANAGED_THREAD_MISMATCH");
  const thread = record(response.thread);
  identifier(thread.id);
  if (thread.cwd !== cwd || thread.modelProvider !== CODEX_MANAGED_PROVIDER || thread.ephemeral !== true || !emptyArray(thread.turns)
    || thread.environments !== undefined && !emptyArray(thread.environments)) return fail("CODEX_MANAGED_THREAD_MISMATCH");
  return Object.freeze({ model: settings.model.id,
    reasoningEffort: observedSetting(response.reasoningEffort, settings.model.reasoningEffort),
    serviceTier: observedSetting(response.serviceTier, settings.model.serviceTier) });
}
