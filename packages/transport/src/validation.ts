import type { ActionIntent, Capability, TransportErrorCode, TransportResult } from "./types";

export function success<T>(value: T): TransportResult<T> { return { ok: true, value }; }
export function failure<T = never>(code: TransportErrorCode, message: string, capability?: Capability): TransportResult<T> {
  return { ok: false, error: { code, message, ...(capability === undefined ? {} : { capability }), retryable: false } };
}
export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Expected object");
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(entry => !("value" in entry))) throw new Error("Accessor values are unsupported");
  return value as Record<string, unknown>;
}
export function string(value: unknown, maximum = 2048): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximum || value.includes("\0")) throw new Error("Expected bounded string");
  return value;
}
export function nullableString(value: unknown, maximum = 2048): string | null { return value === null ? null : string(value, maximum); }
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error("Expected bounded integer");
  return value;
}
export function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length) throw new Error("Expected bounded array");
  return value;
}
export function digest(value: unknown): string { const result = string(value, 64); if (!/^[0-9a-f]{64}$/u.test(result)) throw new Error("Expected digest"); return result; }
export function timestamp(value: unknown): string { const result = string(value, 40); if (!Number.isFinite(Date.parse(result)) || !/^\d{4}-\d\d-\d\dT/u.test(result)) throw new Error("Expected timestamp"); return result; }
export function exact(value: Record<string, unknown>, keys: readonly string[]): void { if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error("Unexpected fields"); }
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const item = object(value);
  return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(item[key])}`).join(",")}}`;
}
function relativeFile(value: unknown): string {
  const result = string(value, 1024);
  if (result.startsWith("/") || result.includes("\\") || result.split("/").some(part => part === "." || part === ".." || part === "")) throw new Error("Expected relative contact file");
  return result;
}
function https(value: unknown): string { const result = string(value); const url = new URL(result); if (url.protocol !== "https:" || url.username || url.password) throw new Error("Expected HTTPS URL"); return result; }
/** Validates intent syntax. The trusted file broker must bind relative paths to owned bytes. */
export function parseActionIntent(value: unknown): ActionIntent {
  const item = object(value);
  switch (item.kind) {
    case "text": exact(item, ["kind", "text"]); return { kind: "text", text: string(item.text, 65536) };
    case "attachment": exact(item, ["kind", "file", "mimeType", "name"]); return { kind: "attachment", file: relativeFile(item.file), mimeType: string(item.mimeType, 128), name: string(item.name, 255) };
    case "reaction": exact(item, ["kind", "messageId", "emoji", "action"]); if (item.action !== "add" && item.action !== "remove") throw new Error("Invalid reaction action"); return { kind: "reaction", messageId: string(item.messageId), emoji: string(item.emoji, 64), action: item.action };
    case "sticker": exact(item, ["kind", "file", "messageId"]); return { kind: "sticker", file: relativeFile(item.file), messageId: nullableString(item.messageId) };
    case "link": case "app-clip": exact(item, ["kind", "url"]); return { kind: item.kind, url: https(item.url) };
    case "poll": {
      exact(item, ["kind", "question", "options", "maximumSelections"]);
      const options = array(item.options, 12).map(option => string(option, 256));
      if (options.length < 2 || new Set(options).size !== options.length) throw new Error("Polls need distinct options");
      return { kind: "poll", question: string(item.question, 1024), options: Object.freeze(options), maximumSelections: item.maximumSelections === null ? null : integer(item.maximumSelections, 1, options.length) };
    }
    case "experience": {
      exact(item, ["kind", "experienceId", "parameters"]);
      const parameters = object(item.parameters);
      const inspect = (input: unknown, depth: number): void => {
        if (depth > 12) throw new Error("Experience parameters too deep");
        if (input === null || typeof input === "string" || typeof input === "boolean" || typeof input === "number" && Number.isFinite(input)) return;
        if (Array.isArray(input)) { for (const child of array(input, 256)) inspect(child, depth + 1); return; }
        for (const child of Object.values(object(input))) inspect(child, depth + 1);
      };
      inspect(parameters, 0);
      const bytes = JSON.stringify(parameters);
      if (Buffer.byteLength(bytes) > 16384) throw new Error("Experience parameters too large");
      return { kind: "experience", experienceId: string(item.experienceId, 128), parameters: JSON.parse(bytes) as Record<string, unknown> };
    }
    default: throw new Error("Unsupported intent kind");
  }
}
