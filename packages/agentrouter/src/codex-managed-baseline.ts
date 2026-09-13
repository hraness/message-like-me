/** Version-one persistent account configuration. Keep the exact serialized
 * bytes stable: admitted account homes are checked, never rewritten per task.
 * Native loading and effective isolation require separate runtime evidence. */
export const CODEX_MANAGED_ACCOUNT_FEATURES = Object.freeze([
  "apps", "auth_elicitation", "browser_use", "code_mode", "computer_use", "hooks", "image_generation", "in_app_browser",
  "memories", "multi_agent", "multi_agent_v2", "plugins", "plugin_sharing", "remote_plugin", "remote_control",
  "shell_snapshot", "shell_tool", "skill_mcp_dependency_install", "skill_search", "unified_exec", "workspace_dependencies",
] as const);

export function codexManagedAccountConfiguration(): string {
  return ['model_provider = "openai"', 'forced_login_method = "chatgpt"', 'cli_auth_credentials_store = "file"', 'mcp_oauth_credentials_store = "file"',
    'approval_policy = "never"', 'sandbox_mode = "read-only"', 'web_search = "disabled"', 'project_doc_max_bytes = 0', 'check_for_update_on_startup = false', 'allow_login_shell = false', 'notify = []', 'mcp_servers = {}', 'plugins = {}',
    '[shell_environment_policy]', 'inherit = "none"', '[analytics]', 'enabled = false', '[feedback]', 'enabled = false', '[history]', 'persistence = "none"',
    '[features]', ...CODEX_MANAGED_ACCOUNT_FEATURES.map(name => `${name} = false`),
    '[apps._default]', 'enabled = false', 'destructive_enabled = false', 'open_world_enabled = false', '[orchestrator.skills]', 'enabled = false', '[skills]', 'include_instructions = false', '[skills.bundled]', 'enabled = false', ''].join("\n");
}
