import { BROKER_TOOL_NAMES, type BrokerToolName } from "./broker.ts";
import { CODEX_TOOL_NAMES, canonicalJson, codexResponseTools, codexTools, type CodexTool } from "./codex-config.ts";

/** Pure, deliberately narrow Responses JSON admission. No transport or qualification.
 * Schema evidence: OpenAI's generated Python SDK Responses types for response,
 * function calls, output messages and usage, and
 * https://developers.openai.com/api/docs/guides/function-calling (2026-09-12).
 * Provider reasoning must be carried across turns; this slice rejects it, never drops it.
 */
export type CodexApiResponseBinding = Readonly<{
  /** An independently admitted concrete snapshot, not an availability or price proof. */
  modelSnapshot: string;
  purpose: "classify" | "respond";
  tools: readonly CodexTool[];
  maxOutputTokens: number;
}>;
export type CodexApiUsage = Readonly<{
  input_tokens: number;
  input_tokens_details: Readonly<{ cached_tokens: number; cache_write_tokens?: number }>;
  output_tokens: number;
  output_tokens_details: Readonly<{ reasoning_tokens: number }>;
  total_tokens: number;
}>;
export type CodexApiJson = null | boolean | number | string | readonly CodexApiJson[] | { readonly [key: string]: CodexApiJson };
export type CodexApiResult = Readonly<
  { kind: "tool"; callId: string; tool: BrokerToolName; arguments: Readonly<Record<string, CodexApiJson>> }
  | { kind: "final"; text: string; value: CodexApiJson }
>;
export type CodexApiResponse = Readonly<{
  productionQualified: false;
  responseId: string;
  model: string;
  usage: CodexApiUsage;
  result: CodexApiResult;
  /** Internal canonical protocol, not a verbatim public API stream. */
  sse: string;
}>;
export type CodexApiFailureCode = "CODEX_API_BINDING_INVALID" | "CODEX_API_JSON_INVALID" | "CODEX_API_BOUND_EXCEEDED"
  | "CODEX_API_UNKNOWN_FIELD" | "CODEX_API_RESPONSE_INVALID" | "CODEX_API_PROVIDER_NOT_COMPLETED"
  | "CODEX_API_USAGE_INVALID" | "CODEX_API_MODEL_MISMATCH" | "CODEX_API_MANIFEST_MISMATCH"
  | "CODEX_API_POLICY_MISMATCH" | "CODEX_API_REASONING_UNSUPPORTED" | "CODEX_API_OUTPUT_UNSUPPORTED"
  | "CODEX_API_TOOL_DENIED" | "CODEX_API_ARGUMENTS_INVALID" | "CODEX_API_FINAL_INVALID";
export type CodexApiFailureDetails = Readonly<{
  responseId: string | null;
  status: "completed" | "failed" | "in_progress" | "cancelled" | "queued" | "incomplete" | null;
  /** Untrusted private evidence. Never display, execute, or send it to the child. */
  providerError: CodexApiJson | null;
  incompleteDetails: CodexApiJson | null;
  usage: CodexApiUsage | null;
  usageStatus: "validated" | "missing" | "invalid";
}>;
export class CodexApiResponseError extends Error {
  readonly code: CodexApiFailureCode;
  declare readonly details: CodexApiFailureDetails;
  constructor(code: CodexApiFailureCode, details: CodexApiFailureDetails = EMPTY_DETAILS) {
    super(code); this.name = "CodexApiResponseError"; this.code = code;
    // Error messages/ordinary serialization stay content-free; explicit private access is required.
    Object.defineProperty(this, "details", { value: details, enumerable: false, writable: false });
  }
}
const EMPTY_DETAILS: CodexApiFailureDetails = Object.freeze({ responseId: null, status: null, providerError: null,
  incompleteDetails: null, usage: null, usageStatus: "missing" });
const MAX_JSON_BYTES = 2 * 1024 * 1024, MAX_VALUE_BYTES = 512 * 1024, MAX_NODES = 32_768, MAX_DEPTH = 32;
const RESPONSE_FIELDS = ["id", "object", "created_at", "completed_at", "status", "background", "error", "incomplete_details",
  "model", "output", "parallel_tool_calls", "tools", "tool_choice", "store", "usage", "max_output_tokens",
  "instructions", "metadata", "temperature", "top_p", "text", "reasoning", "truncation", "service_tier", "top_logprobs",
  "conversation", "previous_response_id", "max_tool_calls", "moderation", "prompt", "prompt_cache_diagnostics",
  "prompt_cache_key", "prompt_cache_options", "prompt_cache_retention", "safety_identifier", "user"] as const;
const NULL_FIELDS = ["conversation", "previous_response_id", "max_tool_calls", "moderation", "prompt",
  "prompt_cache_diagnostics", "prompt_cache_key", "prompt_cache_options", "prompt_cache_retention", "safety_identifier", "user"] as const;
const STATUSES = ["completed", "failed", "in_progress", "cancelled", "queued", "incomplete"] as const;
function requireValue(ok: unknown, code: CodexApiFailureCode): asserts ok { if (!ok) throw new CodexApiResponseError(code); }
function record(value: unknown, keys?: readonly string[], code: CodexApiFailureCode = "CODEX_API_RESPONSE_INVALID"): Record<string, any> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), code);
  if (keys) requireValue(Object.keys(value).every(key => keys.includes(key)), "CODEX_API_UNKNOWN_FIELD");
  return value as Record<string, any>;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function id(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value);
}
function text(value: unknown, bytes: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.length > 0) && !value.includes("\0")
    && value.length <= bytes && Buffer.byteLength(value, "utf8") <= bytes;
}
function checkTree(value: unknown): asserts value is CodexApiJson {
  const stack: [unknown, number][] = [[value, 0]]; let nodes = 0;
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    requireValue(++nodes <= MAX_NODES && depth <= MAX_DEPTH, "CODEX_API_BOUND_EXCEEDED");
    if (typeof item === "number") requireValue(Number.isFinite(item), "CODEX_API_JSON_INVALID");
    if (item !== null && typeof item === "object") {
      for (const child of Object.values(item)) stack.push([child, depth + 1]);
    }
  }
}
function parse(json: unknown, bytes: number): CodexApiJson {
  requireValue(text(json, bytes), "CODEX_API_BOUND_EXCEEDED");
  let result: unknown;
  try { result = JSON.parse(json); } catch { throw new CodexApiResponseError("CODEX_API_JSON_INVALID"); }
  // JSON.parse accepts last-key-wins. Refuse duplicate authority/output/usage keys,
  // including escaped spellings, rather than silently dropping an earlier effect.
  const objects: ({ keys: Set<string>; nextKey: boolean } | null)[] = [];
  for (let index = 0; index < json.length; index++) {
    const char = json[index];
    if (char === '"') {
      const start = index++;
      while (index < json.length && json[index] !== '"') { if (json[index] === "\\") index++; index++; }
      const top = objects.at(-1);
      if (top?.nextKey) {
        const key = JSON.parse(json.slice(start, index + 1)) as string;
        requireValue(!top.keys.has(key), "CODEX_API_JSON_INVALID"); top.keys.add(key); top.nextKey = false;
      }
    } else if (char === "{") objects.push({ keys: new Set(), nextKey: true });
    else if (char === "[") objects.push(null);
    else if (char === "}" || char === "]") objects.pop();
    else if (char === "," && objects.at(-1)) objects.at(-1)!.nextKey = true;
    requireValue(objects.length <= MAX_DEPTH, "CODEX_API_BOUND_EXCEEDED");
  }
  checkTree(result); return result;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function usage(raw: unknown): CodexApiUsage {
  const u = record(raw, ["input_tokens", "input_tokens_details", "output_tokens", "output_tokens_details", "total_tokens"], "CODEX_API_USAGE_INVALID");
  const input = record(u.input_tokens_details, ["cached_tokens", "cache_write_tokens"], "CODEX_API_USAGE_INVALID");
  const output = record(u.output_tokens_details, ["reasoning_tokens"], "CODEX_API_USAGE_INVALID");
  requireValue(integer(u.input_tokens) && integer(u.output_tokens) && integer(u.total_tokens)
    && Number.isSafeInteger(u.input_tokens + u.output_tokens) && u.total_tokens === u.input_tokens + u.output_tokens
    && integer(input.cached_tokens, u.input_tokens) && integer(output.reasoning_tokens, u.output_tokens)
    && (input.cache_write_tokens === undefined || integer(input.cache_write_tokens, u.input_tokens)), "CODEX_API_USAGE_INVALID");
  return freeze({ input_tokens: u.input_tokens, input_tokens_details: { cached_tokens: input.cached_tokens,
    ...(input.cache_write_tokens === undefined ? {} : { cache_write_tokens: input.cache_write_tokens }) },
  output_tokens: u.output_tokens, output_tokens_details: { reasoning_tokens: output.reasoning_tokens }, total_tokens: u.total_tokens });
}
function failureDetails(response: Record<string, any>): CodexApiFailureDetails {
  let validated: CodexApiUsage | null = null, usageStatus: CodexApiFailureDetails["usageStatus"] = "missing";
  if (response.usage !== undefined && response.usage !== null) {
    try { validated = usage(response.usage); usageStatus = "validated"; } catch { usageStatus = "invalid"; }
  }
  const retained = (value: CodexApiJson | undefined) => value === undefined ? null : value;
  return freeze({ responseId: id(response.id) ? response.id : null,
    status: STATUSES.includes(response.status) ? response.status : null,
    providerError: retained(response.error), incompleteDetails: retained(response.incomplete_details),
    usage: validated, usageStatus });
}
function admittedTools(binding: CodexApiResponseBinding): readonly CodexTool[] {
  requireValue(id(binding.modelSnapshot) && /-\d{4}-\d{2}-\d{2}$/u.test(binding.modelSnapshot)
    && (binding.purpose === "respond" || binding.purpose === "classify")
    && integer(binding.maxOutputTokens, 32_768) && binding.maxOutputTokens > 0
    && Array.isArray(binding.tools) && binding.tools.length <= BROKER_TOOL_NAMES.length, "CODEX_API_BINDING_INVALID");
  const names = binding.tools.map(tool => BROKER_TOOL_NAMES.find(name => CODEX_TOOL_NAMES[name] === tool?.name));
  requireValue(names.every(name => name !== undefined) && new Set(names).size === names.length
    && (binding.purpose !== "classify" || names.length === 0), "CODEX_API_BINDING_INVALID");
  const fixed = codexTools(names as BrokerToolName[]);
  // Only inspected fixed schemas are traversed later; caller-supplied schemas never become authority.
  let supplied: string;
  try { supplied = JSON.stringify(binding.tools); } catch { throw new CodexApiResponseError("CODEX_API_BINDING_INVALID"); }
  requireValue(text(supplied, 64 * 1024), "CODEX_API_BINDING_INVALID");
  const cloned = parse(supplied, 64 * 1024);
  requireValue(canonicalJson(cloned) === canonicalJson(fixed), "CODEX_API_BINDING_INVALID");
  return fixed;
}
/** The fixed six schemas use only this finite vocabulary. File/network authorization remains in ToolBroker. */
function matches(value: unknown, schema: Readonly<Record<string, any>>): boolean {
  if (schema.anyOf) return schema.anyOf.some((option: Record<string, unknown>) => matches(value, option));
  if (schema.type === "null") return value === null;
  if (schema.type === "string") return typeof value === "string" && !value.includes("\0")
    && [...value].length >= (schema.minLength ?? 0) && [...value].length <= (schema.maxLength ?? MAX_VALUE_BYTES)
    && (!schema.enum || schema.enum.includes(value));
  if (schema.type === "integer") return integer(value, schema.maximum) && value >= schema.minimum;
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const obj = value as Record<string, unknown>, properties = schema.properties as Record<string, Record<string, unknown>>;
    return Object.keys(obj).every(key => Object.hasOwn(properties, key))
      && schema.required.every((key: string) => Object.hasOwn(obj, key))
      && Object.entries(obj).every(([key, child]) => matches(child, properties[key]!));
  }
  return false;
}
function policy(response: Record<string, any>, binding: CodexApiResponseBinding, tools: readonly CodexTool[]): void {
  requireValue(response.object === "response" && id(response.id), "CODEX_API_RESPONSE_INVALID");
  requireValue(response.model === binding.modelSnapshot, "CODEX_API_MODEL_MISMATCH");
  requireValue(canonicalJson(response.tools) === canonicalJson(codexResponseTools(tools)), "CODEX_API_MANIFEST_MISMATCH");
  requireValue(response.background === false && response.store === false && response.parallel_tool_calls === false
    && response.tool_choice === "auto" && response.max_output_tokens === binding.maxOutputTokens, "CODEX_API_POLICY_MISMATCH");
  requireValue(NULL_FIELDS.every(key => response[key] === undefined || response[key] === null), "CODEX_API_POLICY_MISMATCH");
  requireValue(response.service_tier === undefined || response.service_tier === null || response.service_tier === "default", "CODEX_API_POLICY_MISMATCH");
  requireValue(response.truncation === undefined || response.truncation === "disabled", "CODEX_API_POLICY_MISMATCH");
  requireValue(response.top_logprobs === undefined || response.top_logprobs === null || response.top_logprobs === 0, "CODEX_API_POLICY_MISMATCH");
  if (response.metadata !== undefined && response.metadata !== null) requireValue(Object.keys(record(response.metadata)).length === 0, "CODEX_API_POLICY_MISMATCH");
  if (response.instructions !== undefined && response.instructions !== null) requireValue(text(response.instructions, MAX_VALUE_BYTES, true), "CODEX_API_POLICY_MISMATCH");
  for (const key of ["created_at", "completed_at"]) if (response[key] !== undefined && response[key] !== null)
    requireValue(typeof response[key] === "number" && Number.isFinite(response[key]) && response[key] >= 0, "CODEX_API_RESPONSE_INVALID");
  if (typeof response.completed_at === "number" && typeof response.created_at === "number")
    requireValue(response.completed_at >= response.created_at, "CODEX_API_RESPONSE_INVALID");
  for (const [key, max] of [["temperature", 2], ["top_p", 1]] as const) if (response[key] !== undefined && response[key] !== null)
    requireValue(typeof response[key] === "number" && Number.isFinite(response[key]) && response[key] >= 0 && response[key] <= max, "CODEX_API_RESPONSE_INVALID");
  if (response.reasoning !== undefined && response.reasoning !== null) {
    const r = record(response.reasoning, ["effort", "summary"]);
    requireValue(Object.values(r).every(value => value === null), "CODEX_API_REASONING_UNSUPPORTED");
  }
  if (response.text !== undefined && response.text !== null) {
    const t = record(response.text, ["format", "verbosity"]);
    if (t.format !== undefined && t.format !== null) {
      const format = record(t.format, ["type"]);
      requireValue(format.type === "text" || format.type === "json_object", "CODEX_API_POLICY_MISMATCH");
    }
    requireValue(t.verbosity === undefined || t.verbosity === null || ["low", "medium", "high"].includes(t.verbosity), "CODEX_API_POLICY_MISMATCH");
  }
}
/** Buffered provider JSON only. The caller still owns HTTP status/body custody, billing,
 * account generation, request binding, cross-response call-ID uniqueness and final schema admission.
 * Rejection does NOT mean no billable work occurred; inspect private details.usageStatus.
 */
export function normalizeCodexApiResponse(json: string, binding: CodexApiResponseBinding): CodexApiResponse {
  const tools = admittedTools(binding);
  const response = record(parse(json, MAX_JSON_BYTES));
  const details = failureDetails(response);
  try {
    // A failed/incomplete provider envelope can carry usage. Preserve it even though no SSE is emitted.
    requireValue(response.status === "completed" && response.error === null && response.incomplete_details === null,
      "CODEX_API_PROVIDER_NOT_COMPLETED");
    record(response, RESPONSE_FIELDS);
    policy(response, binding, tools);
    requireValue(details.usage !== null && details.usageStatus === "validated", "CODEX_API_USAGE_INVALID");
    const measured = details.usage;
    requireValue(measured.output_tokens <= binding.maxOutputTokens, "CODEX_API_USAGE_INVALID");
    requireValue(measured.output_tokens_details.reasoning_tokens === 0, "CODEX_API_REASONING_UNSUPPORTED");
    requireValue(Array.isArray(response.output) && response.output.length === 1, "CODEX_API_OUTPUT_UNSUPPORTED");
    const output = record(response.output[0]);
    let item: Record<string, unknown>, result: CodexApiResult;
    if (output.type === "function_call") {
      record(output, ["type", "id", "call_id", "name", "arguments", "status", "namespace", "async", "caller"]);
      const tool = tools.find(candidate => candidate.name === output.name);
      requireValue(tool && binding.purpose === "respond", "CODEX_API_TOOL_DENIED");
      requireValue(id(output.call_id) && (output.id === undefined || output.id === null || id(output.id))
        && (output.status === undefined || output.status === null || output.status === "completed")
        && (output.namespace === undefined || output.namespace === null)
        && (output.async === undefined || output.async === null || output.async === false), "CODEX_API_OUTPUT_UNSUPPORTED");
      if (output.caller !== undefined && output.caller !== null)
        requireValue(record(output.caller, ["type"]).type === "direct", "CODEX_API_OUTPUT_UNSUPPORTED");
      let args: CodexApiJson;
      try { args = parse(output.arguments, MAX_VALUE_BYTES); } catch { throw new CodexApiResponseError("CODEX_API_ARGUMENTS_INVALID"); }
      requireValue(matches(args, tool.inputSchema), "CODEX_API_ARGUMENTS_INVALID");
      item = { type: "function_call", ...(output.id == null ? {} : { id: output.id }), call_id: output.call_id,
        name: output.name, arguments: output.arguments };
      result = { kind: "tool", callId: output.call_id,
        tool: BROKER_TOOL_NAMES.find(name => CODEX_TOOL_NAMES[name] === tool.name)!, arguments: args as Record<string, CodexApiJson> };
    } else {
      requireValue(output.type === "message", output.type === "reasoning" ? "CODEX_API_REASONING_UNSUPPORTED" : "CODEX_API_OUTPUT_UNSUPPORTED");
      record(output, ["type", "id", "role", "status", "content", "phase"]);
      requireValue(id(output.id) && output.role === "assistant" && output.status === "completed"
        && (output.phase === undefined || output.phase === null || output.phase === "final_answer")
        && Array.isArray(output.content) && output.content.length === 1, "CODEX_API_OUTPUT_UNSUPPORTED");
      const content = record(output.content[0], ["type", "text", "annotations", "logprobs"]);
      requireValue(content.type === "output_text" && Array.isArray(content.annotations) && content.annotations.length === 0
        && (content.logprobs === undefined || content.logprobs === null || (Array.isArray(content.logprobs) && content.logprobs.length === 0)), "CODEX_API_OUTPUT_UNSUPPORTED");
      let value: CodexApiJson;
      try { value = parse(content.text, MAX_VALUE_BYTES); } catch { throw new CodexApiResponseError("CODEX_API_FINAL_INVALID"); }
      item = { type: "message", id: output.id, role: "assistant", content: [{ type: "output_text", text: content.text }] };
      result = { kind: "final", text: content.text, value };
    }
    const sse = [
      { type: "response.created", response: { id: response.id } },
      { type: "response.output_item.done", item },
      { type: "response.completed", response: { id: response.id, usage: measured } },
    ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    return freeze({ productionQualified: false, responseId: response.id, model: response.model, usage: measured, result, sse });
  } catch (error) {
    if (error instanceof CodexApiResponseError) throw new CodexApiResponseError(error.code, details);
    throw new CodexApiResponseError("CODEX_API_RESPONSE_INVALID", details);
  }
}
