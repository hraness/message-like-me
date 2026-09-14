import { createHash } from "node:crypto";
import { boundedText, identifier } from "./validation.ts";

export type CodexManagedCatalogJson = null | boolean | number | string | readonly CodexManagedCatalogJson[] | CodexManagedCatalogObject;
export type CodexManagedCatalogObject = { readonly [key: string]: CodexManagedCatalogJson };
export type CodexManagedStaticCatalog = Readonly<{
  model: string;
  catalog: Readonly<{ models: readonly [CodexManagedCatalogObject] }>;
  /** Canonical ModelsResponse JSON for a host-owned static catalog file. */
  json: string;
  sha256: string;
}>;
export const CODEX_MANAGED_CATALOG_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, models: 256,
  depth: 32, nodes: 65_536, objectKeys: 256, arrayItems: 4096 });
const forced = Object.freeze({ tool_mode: "direct", shell_type: "disabled", apply_patch_tool_type: null,
  experimental_supported_tools: Object.freeze([]), supports_search_tool: false, supports_experimental_context: false,
  multi_agent_version: "disabled", node_repl_disabled: true });
const need = (condition: unknown, code: string): void => { if (!condition) throw Error(code); };

type Snapshot = Readonly<{ value: CodexManagedCatalogJson; text: string }>;
/** Copy JSON data only. Accessors, toJSON hooks, sparse arrays and exotic
 * prototypes never participate in the catalog or its digest. */
function snapshot(input: unknown): Snapshot {
  let nodes = 0, bytes = 0;
  const add = (text: string) => {
    bytes += Buffer.byteLength(text);
    need(bytes <= CODEX_MANAGED_CATALOG_LIMITS.bytes, "CODEX_MANAGED_CATALOG_LIMIT"); return text;
  };
  function visit(value: unknown, depth: number): Snapshot {
    need(++nodes <= CODEX_MANAGED_CATALOG_LIMITS.nodes && depth <= CODEX_MANAGED_CATALOG_LIMITS.depth, "CODEX_MANAGED_CATALOG_LIMIT");
    if (value === null) return { value, text: add("null") };
    if (typeof value === "boolean") return { value, text: add(String(value)) };
    if (typeof value === "number") {
      need(Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)), "CODEX_MANAGED_CATALOG_JSON_INVALID");
      return { value: Object.is(value, -0) ? 0 : value, text: add(JSON.stringify(value)) };
    }
    if (typeof value === "string") {
      need(Buffer.byteLength(value) <= CODEX_MANAGED_CATALOG_LIMITS.bytes, "CODEX_MANAGED_CATALOG_LIMIT");
      return { value, text: add(JSON.stringify(value)) };
    }
    need(value !== null && typeof value === "object", "CODEX_MANAGED_CATALOG_JSON_INVALID");
    const object = value as object, array = Array.isArray(object), proto = Object.getPrototypeOf(object);
    need(array ? proto === Array.prototype : proto === Object.prototype || proto === null, "CODEX_MANAGED_CATALOG_JSON_INVALID");
    const keys = Reflect.ownKeys(object);
    need(keys.every(key => typeof key === "string"), "CODEX_MANAGED_CATALOG_JSON_INVALID");
    if (array) {
      const length = Object.getOwnPropertyDescriptor(object, "length")?.value as number;
      need(Number.isSafeInteger(length) && length <= CODEX_MANAGED_CATALOG_LIMITS.arrayItems && keys.length === length + 1,
        "CODEX_MANAGED_CATALOG_LIMIT");
      const values: CodexManagedCatalogJson[] = [], texts: string[] = []; add("[");
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
        need(descriptor && "value" in descriptor && descriptor.enumerable, "CODEX_MANAGED_CATALOG_JSON_INVALID");
        if (index) add(","); const next = visit(descriptor!.value, depth + 1); values.push(next.value); texts.push(next.text);
      }
      add("]"); return { value: Object.freeze(values), text: `[${texts.join(",")}]` };
    }
    need(keys.length <= CODEX_MANAGED_CATALOG_LIMITS.objectKeys, "CODEX_MANAGED_CATALOG_LIMIT");
    const result: Record<string, CodexManagedCatalogJson> = Object.create(null), texts: string[] = []; add("{");
    for (const key of (keys as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      need(descriptor && "value" in descriptor && descriptor.enumerable, "CODEX_MANAGED_CATALOG_JSON_INVALID");
      need(Buffer.byteLength(key) <= 1024, "CODEX_MANAGED_CATALOG_LIMIT");
      if (texts.length) add(","); const encoded = add(JSON.stringify(key)); add(":");
      const next = visit(descriptor!.value, depth + 1); result[key] = next.value; texts.push(`${encoded}:${next.text}`);
    }
    add("}"); return { value: Object.freeze(result), text: `{${texts.join(",")}}` };
  }
  return visit(input, 0);
}
function record(value: CodexManagedCatalogJson | undefined): CodexManagedCatalogObject {
  need(value !== null && typeof value === "object" && !Array.isArray(value), "CODEX_MANAGED_CATALOG_SHAPE_INVALID");
  return value as CodexManagedCatalogObject;
}
function strings(value: CodexManagedCatalogJson | undefined): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}
function requiredModelInfo(row: CodexManagedCatalogObject): void {
  // Required ModelInfo wire fields in openai/codex rust-v0.154.0-alpha.6.2,
  // codex-rs/protocol/src/openai_models.rs. Optional and future metadata stays
  // byte-value equivalent; the native host must still validate its exact build.
  identifier(row.slug); boundedText(row.display_name, 16_384, true);
  need(Array.isArray(row.supported_reasoning_levels), "CODEX_MANAGED_CATALOG_MODEL_INVALID");
  for (const entry of row.supported_reasoning_levels as readonly CodexManagedCatalogJson[]) {
    const level = record(entry); boundedText(level.effort, 160); boundedText(level.description, 16_384, true);
  }
  need(typeof row.shell_type === "string" && ["unified_exec", "disabled"].includes(row.shell_type)
    && typeof row.visibility === "string" && ["list", "hide", "none"].includes(row.visibility)
    && typeof row.supported_in_api === "boolean" && typeof row.support_verbosity === "boolean"
    && typeof row.priority === "number" && Number.isInteger(row.priority) && row.priority >= -2_147_483_648 && row.priority <= 2_147_483_647
    && strings(row.experimental_supported_tools), "CODEX_MANAGED_CATALOG_MODEL_INVALID");
  const truncation = record(row.truncation_policy);
  need(typeof truncation.mode === "string" && ["bytes", "tokens"].includes(truncation.mode) && Number.isSafeInteger(truncation.limit), "CODEX_MANAGED_CATALOG_MODEL_INVALID");
}

/** Build a declarative catalog from host-supplied ModelsResponse data. Select
 * one exact slug; never resolve display names, prefixes, suffixes or aliases.
 * No discovery, auth, file I/O or network occurs here. The digest attests only
 * these catalog bytes: native tool inventory and confinement remain unqualified.
 * Other model metadata, including protocol, messages, limits and effort/tier
 * support, is preserved. The caller must independently admit its source/build.
 */
export function codexManagedStaticCatalog(input: { model: string; catalog: unknown }): CodexManagedStaticCatalog {
  const supplied = record(snapshot(input).value);
  need(Object.keys(supplied).length === 2 && "model" in supplied && "catalog" in supplied, "CODEX_MANAGED_CATALOG_SHAPE_INVALID");
  const model = identifier(supplied.model), source = record(supplied.catalog);
  need(Object.keys(source).length === 1 && Array.isArray(source.models) && source.models.length >= 1
    && source.models.length <= CODEX_MANAGED_CATALOG_LIMITS.models, "CODEX_MANAGED_CATALOG_SHAPE_INVALID");
  let selected: CodexManagedCatalogObject | undefined;
  const slugs = new Set<string>();
  for (const value of source.models as readonly CodexManagedCatalogJson[]) {
    const row = record(value), slug = identifier(row.slug);
    need(!slugs.has(slug), "CODEX_MANAGED_CATALOG_DUPLICATE_MODEL"); slugs.add(slug);
    if (slug === model) selected = row;
  }
  need(selected !== undefined, "CODEX_MANAGED_CATALOG_MODEL_NOT_FOUND"); requiredModelInfo(selected!);
  const result = snapshot({ models: [{ ...selected, ...forced }] });
  const catalog = result.value as CodexManagedStaticCatalog["catalog"];
  return Object.freeze({ model, catalog, json: result.text, sha256: createHash("sha256").update(result.text).digest("hex") });
}
