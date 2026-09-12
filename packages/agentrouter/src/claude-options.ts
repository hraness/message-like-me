import type { Options } from "@anthropic-ai/claude-agent-sdk";

const BUILT_INS = ["Agent", "Task", "Bash", "Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "NotebookEdit",
  "WebFetch", "WebSearch", "Skill", "ToolSearch", "LSP", "Computer", "AskUserQuestion", "EnterPlanMode", "ExitPlanMode",
  "TodoWrite", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TaskOutput", "TaskStop", "CronCreate", "CronDelete", "CronList"];

type HostInputs = Pick<Options, "abortController" | "cwd" | "env" | "model" | "maxTurns" | "maxBudgetUsd"
  | "pathToClaudeCodeExecutable" | "spawnClaudeCodeProcess" | "mcpServers"> & { brokerToolNames: readonly string[] };

/** Shared with the explicit native qualification harness; never accepts model configuration. */
export function restrictedClaudeOptions({ brokerToolNames, ...host }: HostInputs): Options {
  return {
    ...host, tools: [], disallowedTools: [...BUILT_INS], allowedTools: [...brokerToolNames],
    permissionMode: "dontAsk", permissionPrompts: "none", settingSources: [], strictMcpConfig: true,
    agents: {}, skills: [], plugins: [], persistSession: false, enableFileCheckpointing: false,
    settings: JSON.stringify({ disableAllHooks: true, disableClaudeAiConnectors: true, autoMemoryEnabled: false,
      disableBundledSkills: true, disableSkillShellExecution: true, enableWorkflows: false, workflowKeywordTriggerEnabled: false, skillOverrides: { doctor: "off", checkup: "off" } }),
    systemPrompt: "You are a contact-scoped assistant. Use only the provided broker tools. File paths are relative to this contact's folder. Messaging tools stage intentions; the host applies disclosure and decides delivery. Return the requested JSON only.",
    stderr: () => {},
  };
}

/** Keep task text out of the native CLI's slash/bang command parser. */
export function literalClaudePrompt(prompt: string): string {
  return `Agentrouter task, supplied as plain text:\n\n${prompt}`;
}
