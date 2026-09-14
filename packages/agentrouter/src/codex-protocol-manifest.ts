import { boundedText, safeInteger } from "./validation.ts";

/** Immutable identity emitted by a trusted host after it has inspected the
 * exact Codex executable and generated protocol schema. A digest supplied by
 * a caller is only an assertion until this manifest is host-produced. */
export type CodexProtocolManifest = Readonly<{
  protocol: "codex-app-server-experimental";
  protocolVersion: string;
  sourceVersion: string;
  executableSha256: string;
  schemaSha256: string;
  manifestSha256: string;
  generatedAtUnixMs: number;
}>;

const digest = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error(code);
  return value;
};

/** Protocol manifests cross a host boundary. Read only enumerable data
 * properties from a plain record so validation cannot invoke a provider getter
 * or accept a prototype-backed assertion as host evidence. */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("CODEX_PROTOCOL_MANIFEST_INVALID");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key)
    || !Object.getOwnPropertyDescriptor(value, key)?.enumerable
    || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error("CODEX_PROTOCOL_MANIFEST_INVALID");
  return value as Record<string, unknown>;
}

/** Bind a trusted host manifest to the runtime selected for a task. This does
 * not inspect files or execute Codex; those effects belong to the host that
 * created the manifest. */
export function assertCodexProtocolManifest(value: unknown, runtime: Readonly<{
  version: string; sha256: string; schemaSha256: string;
}>): CodexProtocolManifest {
  const keys = ["protocol", "protocolVersion", "sourceVersion", "executableSha256", "schemaSha256", "manifestSha256", "generatedAtUnixMs"];
  const raw = record(value, keys);
  if (raw.protocol !== "codex-app-server-experimental") throw new Error("CODEX_PROTOCOL_PROTOCOL_INVALID");
  const protocolVersion = boundedText(raw.protocolVersion, 160), sourceVersion = boundedText(raw.sourceVersion, 160);
  const executableSha256 = digest(raw.executableSha256, "CODEX_PROTOCOL_EXECUTABLE_DIGEST_INVALID");
  const schemaSha256 = digest(raw.schemaSha256, "CODEX_PROTOCOL_SCHEMA_DIGEST_INVALID");
  const manifestSha256 = digest(raw.manifestSha256, "CODEX_PROTOCOL_MANIFEST_DIGEST_INVALID");
  const generatedAtUnixMs = safeInteger(raw.generatedAtUnixMs, 0, Number.MAX_SAFE_INTEGER);
  if (sourceVersion !== runtime.version || executableSha256 !== runtime.sha256 || schemaSha256 !== runtime.schemaSha256)
    throw new Error("CODEX_PROTOCOL_RUNTIME_MISMATCH");
  return Object.freeze({ protocol: raw.protocol, protocolVersion, sourceVersion, executableSha256, schemaSha256, manifestSha256, generatedAtUnixMs });
}
