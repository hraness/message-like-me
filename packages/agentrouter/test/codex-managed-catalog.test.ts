import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { CODEX_MANAGED_CATALOG_LIMITS, codexManagedStaticCatalog } from "../src/codex-managed-catalog.ts";

const model = "synthetic-model-2026-09-13";
const nativeRow = (slug = model): Record<string, unknown> => ({ slug, display_name: "Synthetic Model",
  description: "Public synthetic model metadata only.", supported_reasoning_levels: [{ effort: "medium", description: "Normal work" },
    { effort: "future-custom-effort", description: "A model-specific setting" }], default_reasoning_level: "future-custom-effort",
  shell_type: "unified_exec", visibility: "list", supported_in_api: true, priority: 4, support_verbosity: true,
  default_verbosity: "low", truncation_policy: { mode: "tokens", limit: 12_000 }, experimental_supported_tools: ["native_fixture_tool"],
  tool_mode: "code_mode_only", apply_patch_tool_type: "freeform", supports_search_tool: true, supports_experimental_context: true,
  multi_agent_version: "v2", node_repl_disabled: false, context_window: 272_000, max_context_window: 400_000,
  auto_compact_token_limit: 244_800, effective_context_window_percent: 95, use_responses_lite: true,
  supports_reasoning_summary_parameter: false, default_reasoning_summary: "detailed", input_modalities: ["text", "image"],
  service_tiers: [{ id: "default", name: "Standard", description: "Normal priority" }], default_service_tier: "default",
  additional_speed_tiers: [], model_messages: { instructions_template: "Synthetic instructions. Café.", instructions_variables: null,
    tools: { send_user_message_async: { description: "Synthetic native prompt metadata" } } },
  base_instructions: "Synthetic legacy instruction metadata.", unknown_future_protocol: { value: [null, true, 1.25] },
});
const build = (row = nativeRow()) => codexManagedStaticCatalog({ model, catalog: { models: [row] } });
const controls = { tool_mode: "direct", shell_type: "disabled", apply_patch_tool_type: null, experimental_supported_tools: [],
  supports_search_tool: false, supports_experimental_context: false, multi_agent_version: "disabled", node_repl_disabled: true };

function assertFrozen(value: unknown): void {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) assertFrozen(child);
  }
}

test("static catalog keeps one exact native slug and changes only the declared controls", () => {
  const row = nativeRow(), result = codexManagedStaticCatalog({ model, catalog: { models: [nativeRow("another-model"), row] } });
  expect(result.model).toBe(model); expect(result.catalog.models).toHaveLength(1);
  expect(result.catalog.models[0]).toEqual({ ...row, ...controls });
  expect(JSON.parse(result.json)).toEqual({ models: [{ ...row, ...controls }] });
  expect(result.sha256).toBe(createHash("sha256").update(result.json).digest("hex"));
  expect(Object.keys(result).sort()).toEqual(["catalog", "json", "model", "sha256"]);
  expect(row.shell_type).toBe("unified_exec"); expect(row.experimental_supported_tools).toEqual(["native_fixture_tool"]);
});

test("catalog snapshot is deep, detached and canonical without changing protocol metadata", () => {
  const row = nativeRow(), result = build(row), before = result.json;
  assertFrozen(result);
  (row.model_messages as Record<string, unknown>).instructions_template = "changed";
  (row.service_tiers as Record<string, unknown>[])[0]!.id = "changed";
  row.context_window = 1; row.slug = "changed";
  expect(result.json).toBe(before); expect(result.catalog.models[0].context_window).toBe(272_000);
  expect(result.catalog.models[0].default_reasoning_level).toBe("future-custom-effort");
  expect(result.catalog.models[0].use_responses_lite).toBe(true);
  const reordered = Object.fromEntries(Object.entries(nativeRow()).reverse());
  expect(build(reordered).json).toBe(before); expect(build(reordered).sha256).toBe(result.sha256);
});

test("missing, duplicate and alias model selections never fall back", () => {
  for (const selected of ["synthetic-model", "Synthetic Model", `${model}-suffix`, `prefix-${model}`, model.toUpperCase()])
    expect(() => codexManagedStaticCatalog({ model: selected, catalog: { models: [nativeRow()] } })).toThrow();
  expect(() => codexManagedStaticCatalog({ model, catalog: { models: [nativeRow("foreign-model")] } }))
    .toThrow("CODEX_MANAGED_CATALOG_MODEL_NOT_FOUND");
  expect(() => codexManagedStaticCatalog({ model, catalog: { models: [nativeRow(), nativeRow()] } }))
    .toThrow("CODEX_MANAGED_CATALOG_DUPLICATE_MODEL");
  expect(() => codexManagedStaticCatalog({ model, catalog: { models: [nativeRow(), nativeRow("other"), nativeRow("other")] } }))
    .toThrow("CODEX_MANAGED_CATALOG_DUPLICATE_MODEL");
});

test("only the native ModelsResponse envelope is accepted", () => {
  for (const catalog of [null, [], nativeRow(), { models: [] }, { models: null }, { models: [null] },
    { models: [{}] }, { models: [nativeRow()], etag: "a cache envelope is not the native catalog" }])
    expect(() => codexManagedStaticCatalog({ model, catalog })).toThrow();
  expect(() => codexManagedStaticCatalog({ model, catalog: { models: [nativeRow()] }, extra: true } as never)).toThrow();
});

test("required native model metadata cannot be omitted or silently synthesized", () => {
  for (const key of ["slug", "display_name", "supported_reasoning_levels", "shell_type", "visibility", "supported_in_api", "priority",
    "support_verbosity", "truncation_policy", "experimental_supported_tools"]) {
    const row = nativeRow(); delete row[key]; expect(() => build(row)).toThrow();
  }
  for (const changes of [{ display_name: 1 }, { supported_reasoning_levels: null }, { supported_reasoning_levels: [{ effort: "", description: "" }] },
    { supported_reasoning_levels: [{ effort: "medium" }] }, { shell_type: "default" }, { shell_type: ["disabled"] }, { visibility: ["list"] },
    { supported_in_api: "true" }, { priority: 1.5 }, { priority: 2_147_483_648 }, { support_verbosity: 0 },
    { truncation_policy: { mode: ["tokens"], limit: 1 } }, { truncation_policy: { mode: "unknown", limit: 1 } },
    { truncation_policy: { mode: "bytes", limit: Number.MAX_SAFE_INTEGER + 1 } }, { experimental_supported_tools: [1] }])
    expect(() => build({ ...nativeRow(), ...changes })).toThrow();
});

test("optional metadata may be omitted and forced selectors are always explicit", () => {
  const row = nativeRow();
  for (const key of ["description", "default_verbosity", "default_reasoning_level", "model_messages", "base_instructions", "context_window",
    "tool_mode", "multi_agent_version", "apply_patch_tool_type", "supports_search_tool", "supports_experimental_context", "node_repl_disabled"])
    delete row[key];
  const output = build(row).catalog.models[0];
  expect(output).toEqual({ ...row, ...controls }); expect("model_messages" in output).toBe(false);
  expect(build({ ...nativeRow(), tool_mode: "future-selector", multi_agent_version: "future-selector" }).catalog.models[0]).toMatchObject(controls);
});

test("catalog construction does not invoke getters or serialization hooks", () => {
  let called = 0;
  const accessorRow = Object.defineProperty(nativeRow(), "slug", { enumerable: true, get() { called++; return model; } });
  const accessorArray = [nativeRow()];
  Object.defineProperty(accessorArray, "0", { enumerable: true, get() { called++; return nativeRow(); } });
  const accessorInput = Object.defineProperty({ catalog: { models: [nativeRow()] } }, "model", { enumerable: true, get() { called++; return model; } });
  const serialized = { ...nativeRow(), toJSON() { called++; return nativeRow(); } };
  for (const catalog of [{ models: [accessorRow] }, { models: accessorArray }, { models: [serialized] }])
    expect(() => codexManagedStaticCatalog({ model, catalog })).toThrow("CODEX_MANAGED_CATALOG_JSON_INVALID");
  expect(() => codexManagedStaticCatalog(accessorInput as never)).toThrow("CODEX_MANAGED_CATALOG_JSON_INVALID");
  expect(called).toBe(0);
});

test("non-JSON data, hidden properties, sparse arrays and foreign prototypes are refused", () => {
  for (const value of [undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1n, Symbol("synthetic"), () => null, new Date(0), Object.create({ inherited: true })])
    expect(() => build({ ...nativeRow(), extension: value })).toThrow();
  for (const row of [Object.defineProperty(nativeRow(), "hidden", { value: "synthetic" }), { ...nativeRow(), [Symbol("hidden")]: 1 },
    { ...nativeRow(), sparse: new Array(2) }, { ...nativeRow(), arrayExtra: Object.assign([1], { extra: 2 }) }])
    expect(() => build(row)).toThrow();
  const cycle = nativeRow(); cycle.self = cycle; expect(() => build(cycle)).toThrow("CODEX_MANAGED_CATALOG_LIMIT");
});

test("catalog bytes, model count, depth, object keys and array items are bounded", () => {
  expect(() => build({ ...nativeRow(), large: "\\".repeat(CODEX_MANAGED_CATALOG_LIMITS.bytes / 2) }))
    .toThrow("CODEX_MANAGED_CATALOG_LIMIT");
  expect(() => codexManagedStaticCatalog({ model, catalog: { models: Array.from({ length: CODEX_MANAGED_CATALOG_LIMITS.models + 1 },
    (_, index) => nativeRow(`model-${index}`)) } })).toThrow("CODEX_MANAGED_CATALOG_SHAPE_INVALID");
  let nested: unknown = null; for (let index = 0; index < CODEX_MANAGED_CATALOG_LIMITS.depth; index++) nested = { nested };
  expect(() => build({ ...nativeRow(), nested })).toThrow("CODEX_MANAGED_CATALOG_LIMIT");
  expect(() => build({ ...nativeRow(), many: Object.fromEntries(Array.from({ length: CODEX_MANAGED_CATALOG_LIMITS.objectKeys + 1 },
    (_, index) => [`key${index}`, null])) })).toThrow("CODEX_MANAGED_CATALOG_LIMIT");
  expect(() => build({ ...nativeRow(), many: Array(CODEX_MANAGED_CATALOG_LIMITS.arrayItems + 1).fill(null) }))
    .toThrow("CODEX_MANAGED_CATALOG_LIMIT");
});
