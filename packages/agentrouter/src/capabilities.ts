import { createHash } from "node:crypto";
import { boundedText, identifier, safeInteger } from "./validation.ts";

export type CapabilityJson = null | boolean | number | string | readonly CapabilityJson[] | CapabilityObject;
export type CapabilityObject = { readonly [key: string]: CapabilityJson };
export const CAPABILITY_LIMITS = Object.freeze({ tools: 64, schemaBytes: 32 * 1024, manifestBytes: 256 * 1024,
  inputBytes: 256 * 1024, outputBytes: 256 * 1024, depth: 16, nodes: 8192, objectKeys: 256,
  arrayItems: 4096, calls: 256, pendingCalls: 32 });
export type CapabilityDescriptor = Readonly<{ name: string; description: string; inputSchema: CapabilityObject }>;
export type CapabilityProfileIdentity = Readonly<{ id: string; version: number; digest: string }>;
export type CapabilityProfile = CapabilityProfileIdentity & Readonly<{ tools: readonly CapabilityDescriptor[] }>;
export type CapabilityContext = Readonly<{
  workspaceId: string;
  runId: string;
  signal: AbortSignal;
  /** Trusted handlers must recheck immediately before each effect, including
   * after their own awaits, and retain their conditional-write/authority gates. */
  assertActive(): void;
}>;
export type CapabilityTool = CapabilityDescriptor & Readonly<{
  /** Trusted code enforces the complete semantic contract. Schema descriptors
   * are not evaluated as a JSON Schema program by this broker. */
  parseInput(input: CapabilityObject): CapabilityJson;
  execute(input: CapabilityJson, context: CapabilityContext): unknown | Promise<unknown>;
}>;
export interface CapabilityBroker {
  readonly profile: CapabilityProfile;
  readonly workspaceId: string;
  readonly runId: string;
  invoke(name: unknown, input: unknown): Promise<CapabilityJson>;
  assertActive(): void;
  revoke(): void;
  /** Revoke immediately and join all admitted handlers. This does not prove
   * that an external provider process or controller has stopped. */
  close(): Promise<void>;
}

type Snapshot = { value: CapabilityJson; text: string };
/** Copy only bounded JSON data, without calling accessors or toJSON. Stable
 * sorted-key serialization binds descriptors independently of object key order. */
function snapshot(input: unknown, maximum: number): Snapshot {
  let nodes = 0, bytes = 0;
  const add = (text: string) => { bytes += Buffer.byteLength(text); if (bytes > maximum) throw Error("CAPABILITY_JSON_LIMIT"); return text; };
  function visit(value: unknown, depth: number): Snapshot {
    if (++nodes > CAPABILITY_LIMITS.nodes || depth > CAPABILITY_LIMITS.depth) throw Error("CAPABILITY_JSON_LIMIT");
    if (value === null) return { value, text: add("null") };
    if (typeof value === "boolean") return { value, text: add(String(value)) };
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw Error("CAPABILITY_JSON_INVALID");
      return { value: Object.is(value, -0) ? 0 : value, text: add(JSON.stringify(value)) };
    }
    if (typeof value === "string") {
      if (Buffer.byteLength(value) > maximum) throw Error("CAPABILITY_JSON_LIMIT");
      return { value, text: add(JSON.stringify(value)) };
    }
    if (!value || typeof value !== "object") throw Error("CAPABILITY_JSON_INVALID");
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw Error("CAPABILITY_JSON_INVALID");
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string")) throw Error("CAPABILITY_JSON_INVALID");
    if (array) {
      if (value.length > CAPABILITY_LIMITS.arrayItems || keys.length !== value.length + 1) throw Error("CAPABILITY_JSON_LIMIT");
      const values: CapabilityJson[] = [], texts: string[] = []; add("[");
      for (let i = 0; i < value.length; i++) {
        const property = Object.getOwnPropertyDescriptor(value, String(i));
        if (!property || !("value" in property) || !property.enumerable) throw Error("CAPABILITY_JSON_INVALID");
        if (i) add(","); const next = visit(property.value, depth + 1); values.push(next.value); texts.push(next.text);
      }
      add("]"); return { value: Object.freeze(values), text: `[${texts.join(",")}]` };
    }
    if (keys.length > CAPABILITY_LIMITS.objectKeys) throw Error("CAPABILITY_JSON_LIMIT");
    const result: Record<string, CapabilityJson> = Object.create(null), texts: string[] = []; add("{");
    for (const key of (keys as string[]).sort()) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !("value" in property) || !property.enumerable) throw Error("CAPABILITY_JSON_INVALID");
      if (Buffer.byteLength(key) > 1024) throw Error("CAPABILITY_JSON_LIMIT");
      if (texts.length) add(","); const encoded = add(JSON.stringify(key)); add(":");
      const next = visit(property.value, depth + 1); result[key] = next.value; texts.push(`${encoded}:${next.text}`);
    }
    add("}"); return { value: Object.freeze(result), text: `{${texts.join(",")}}` };
  }
  return visit(input, 0);
}
function jsonObject(value: CapabilityJson): CapabilityObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("CAPABILITY_OBJECT_REQUIRED");
  return value as CapabilityObject;
}
type RegisteredTool = { descriptor: CapabilityDescriptor; parseInput: CapabilityTool["parseInput"]; execute: CapabilityTool["execute"] };
const profiles = new WeakMap<CapabilityProfile, ReadonlyMap<string, RegisteredTool>>();

/** The digest covers this ordered declarative manifest, not executable handler
 * code, credentials or OS confinement. Runtime provenance is a separate gate. */
export function createCapabilityProfile(options: { id: string; version: number; tools: readonly CapabilityTool[] }): CapabilityProfile {
  const id = identifier(options.id), version = safeInteger(options.version, 1, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(options.tools) || options.tools.length > CAPABILITY_LIMITS.tools) throw Error("CAPABILITY_TOOL_LIMIT");
  const registered = new Map<string, RegisteredTool>();
  for (const tool of options.tools) {
    const name = boundedText(tool.name, 128), description = boundedText(tool.description, 4096);
    if (!/^[A-Za-z][A-Za-z0-9_.-]*$/u.test(name) || registered.has(name)
      || typeof tool.parseInput !== "function" || typeof tool.execute !== "function") throw Error("CAPABILITY_TOOL_INVALID");
    const inputSchema = jsonObject(snapshot(tool.inputSchema, CAPABILITY_LIMITS.schemaBytes).value);
    // The outer call object is always closed. Nested and other schema semantics
    // are enforced by the trusted parser, without fetching refs or executing code.
    const properties = jsonObject(inputSchema.properties ?? null), required = inputSchema.required ?? [];
    if (inputSchema.type !== "object" || inputSchema.additionalProperties !== false || !Array.isArray(required)
      || required.some(key => typeof key !== "string" || !Object.hasOwn(properties, key))
      || new Set(required).size !== required.length) throw Error("CAPABILITY_SCHEMA_INVALID");
    const descriptor = Object.freeze({ name, description, inputSchema });
    registered.set(name, { descriptor, parseInput: tool.parseInput, execute: tool.execute });
  }
  const tools = Object.freeze([...registered.values()].map(tool => tool.descriptor));
  const text = snapshot({ format: "agentrouter.capability-profile.v1", id, version, tools }, CAPABILITY_LIMITS.manifestBytes).text;
  const profile = Object.freeze({ id, version, digest: createHash("sha256").update(text).digest("hex"), tools });
  profiles.set(profile, registered); return profile;
}

/** Match the exact host-created profile against adapter qualification. A
 * deserialized lookalike has no registered trusted implementation authority. */
export function assertCapabilityProfile(profile: CapabilityProfile, expected: CapabilityProfileIdentity): void {
  if (!profiles.has(profile) || expected.id !== profile.id || expected.version !== profile.version || expected.digest !== profile.digest)
    throw Error("CAPABILITY_PROFILE_MISMATCH");
}

export function createCapabilityBroker(options: { profile: CapabilityProfile; workspaceId: string; runId: string;
  isActive(): boolean; signal?: AbortSignal }): CapabilityBroker {
  const { profile } = options;
  assertCapabilityProfile(profile, profile);
  const definitions = profiles.get(profile)!;
  const workspaceId = identifier(options.workspaceId), runId = identifier(options.runId), isActive = options.isActive;
  if (typeof isActive !== "function") throw Error("CAPABILITY_ACTIVE_CHECK_REQUIRED");
  const controller = new AbortController();
  const signal = options.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, options.signal]);
  const assertActive = () => {
    let active = false; try { active = !signal.aborted && isActive() === true; } catch { /* No raw host error crosses the broker. */ }
    if (!active || signal.aborted) throw Error("CAPABILITY_REVOKED");
  };
  const context: CapabilityContext = Object.freeze({ workspaceId, runId, signal, assertActive });
  let tail = Promise.resolve<unknown>(undefined), calls = 0, pending = 0;
  return Object.freeze({ profile, workspaceId, runId, assertActive,
    revoke() { controller.abort(); },
    async close() { controller.abort(); const joined = tail; await joined; },
    invoke(name: unknown, input: unknown): Promise<CapabilityJson> {
      let definition: RegisteredTool, raw: CapabilityObject;
      try {
        assertActive();
        if (typeof name !== "string" || !definitions.has(name)) throw Error("CAPABILITY_TOOL_DENIED");
        if (++calls > CAPABILITY_LIMITS.calls || pending >= CAPABILITY_LIMITS.pendingCalls) throw Error("CAPABILITY_CALL_LIMIT");
        definition = definitions.get(name)!;
        raw = jsonObject(snapshot(input, CAPABILITY_LIMITS.inputBytes).value);
        const properties = jsonObject(definition.descriptor.inputSchema.properties!);
        const required = definition.descriptor.inputSchema.required as readonly string[] | undefined;
        if (Object.keys(raw).some(key => !Object.hasOwn(properties, key)) || required?.some(key => !Object.hasOwn(raw, key)))
          throw Error("CAPABILITY_INPUT_INVALID");
      } catch (error) { return Promise.reject(error); }
      pending++;
      const result = tail.then(async () => {
        assertActive();
        let parsed: CapabilityJson;
        try { parsed = snapshot(definition.parseInput(raw), CAPABILITY_LIMITS.inputBytes).value; }
        catch { throw Error("CAPABILITY_INPUT_INVALID"); }
        assertActive();
        let output: unknown;
        try { output = await definition.execute(parsed, context); }
        catch { assertActive(); throw Error("CAPABILITY_TOOL_FAILED"); }
        assertActive();
        try { return snapshot(output, CAPABILITY_LIMITS.outputBytes).value; }
        catch { throw Error("CAPABILITY_OUTPUT_INVALID"); }
      });
      tail = result.then(() => { pending--; }, () => { pending--; });
      return result;
    },
  });
}
