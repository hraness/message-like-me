import { canonicalJson, type CodexCapabilityMapping } from "./codex-config.ts";
import { boundedText, identifier, object, safeInteger } from "./validation.ts";

type Call = { nativeName: string; capabilityName: string; arguments: string; claimed: boolean;
  response: { success: boolean; contentItems: { type: "inputText"; text: string }[] } | null; written: boolean; completed: boolean };
function assert(value: unknown, code: string): asserts value { if (!value) throw Error(code); }

/** Binds native callbacks to observed items, not to a model request manifest.
 * This is callback accounting only; it cannot qualify the native tool surface. */
export class CodexManagedCallLedger {
  private readonly calls = new Map<string, Call>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private closed = false;
  constructor(private readonly mapping: CodexCapabilityMapping, private readonly maximumCalls: number) {
    safeInteger(maximumCalls, 1, 1024);
  }
  bind(threadId: string, turnId: string) {
    assert(this.threadId === null && !this.closed, "CODEX_MANAGED_DUPLICATE_TURN");
    this.threadId = identifier(threadId); this.turnId = identifier(turnId);
  }
  private scope(value: unknown, keys: string[]) {
    const params = object(value, keys);
    assert(!this.closed && this.threadId !== null && params.threadId === this.threadId && params.turnId === this.turnId,
      "CODEX_MANAGED_CALL_SCOPE_MISMATCH");
    return params;
  }
  private identity(nativeName: unknown, namespace: unknown, args: unknown) {
    const name = identifier(nativeName), capabilityName = this.mapping.capabilityName(name);
    assert(capabilityName !== null && namespace == null, "CODEX_MANAGED_TOOL_DENIED");
    assert(args !== null && typeof args === "object" && !Array.isArray(args), "CODEX_MANAGED_ARGUMENTS_INVALID");
    return { nativeName: name, capabilityName, arguments: boundedText(canonicalJson(args), 256 * 1024) };
  }
  observe(value: unknown, phase: "started" | "completed") {
    const timestamp = phase === "started" ? "startedAtMs" : "completedAtMs";
    const params = this.scope(value, ["threadId", "turnId", "item", timestamp]);
    if (params[timestamp] !== undefined) safeInteger(params[timestamp], 0, Number.MAX_SAFE_INTEGER);
    const item = object(params.item, ["type", "id", "tool", "namespace", "arguments", "status", "contentItems", "success", "durationMs"]);
    assert(item.type === "dynamicToolCall", "CODEX_MANAGED_TOOL_ITEM_INVALID");
    const id = identifier(item.id), identity = this.identity(item.tool, item.namespace, item.arguments);
    if (item.durationMs != null) safeInteger(item.durationMs, 0, Number.MAX_SAFE_INTEGER);
    if (phase === "started") {
      assert(!this.calls.has(id) && this.calls.size < this.maximumCalls, "CODEX_MANAGED_CALL_LIMIT_OR_DUPLICATE");
      assert(item.status === "inProgress" && item.contentItems == null && item.success == null, "CODEX_MANAGED_START_INVALID");
      this.calls.set(id, { ...identity, claimed: false, response: null, written: false, completed: false });
    } else {
      const call = this.calls.get(id);
      assert(call && call.written && !call.completed && call.response, "CODEX_MANAGED_COMPLETION_ORDER");
      assert(call.nativeName === identity.nativeName && call.arguments === identity.arguments
        && item.status === (call.response.success ? "completed" : "failed") && item.success === call.response.success
        && canonicalJson(item.contentItems) === canonicalJson(call.response.contentItems), "CODEX_MANAGED_COMPLETION_CHANGED");
      call.completed = true;
    }
  }
  claim(value: unknown) {
    const params = this.scope(value, ["threadId", "turnId", "callId", "tool", "namespace", "arguments"]);
    const id = identifier(params.callId), identity = this.identity(params.tool, params.namespace, params.arguments), call = this.calls.get(id);
    assert(call && !call.claimed && !call.completed && call.nativeName === identity.nativeName && call.arguments === identity.arguments,
      "CODEX_MANAGED_CALLBACK_DENIED");
    call.claimed = true;
    return { id, name: call.capabilityName, input: JSON.parse(call.arguments) as Record<string, unknown> };
  }
  respond(id: string, text: string, success: boolean) {
    const call = this.calls.get(id);
    assert(!this.closed && call?.claimed && call.response === null && !call.completed, "CODEX_MANAGED_RESPONSE_ORDER");
    call.response = { success, contentItems: [{ type: "inputText", text: boundedText(text, 512 * 1024, true) }] };
    return structuredClone(call.response);
  }
  written(id: string) {
    const call = this.calls.get(id);
    assert(!this.closed && call?.response && !call.written, "CODEX_MANAGED_RESPONSE_WRITE_ORDER");
    call.written = true;
  }
  finish() {
    assert(!this.closed && [...this.calls.values()].every(call => call.completed && call.written), "CODEX_MANAGED_CALLS_INCOMPLETE");
    this.closed = true;
  }
  receipt() {
    return Object.freeze({ started: this.calls.size, claimed: [...this.calls.values()].filter(call => call.claimed).length,
      responsesWritten: [...this.calls.values()].filter(call => call.written).length,
      completed: [...this.calls.values()].filter(call => call.completed).length, closed: this.closed });
  }
}
