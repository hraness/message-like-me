import { boundedText, object, provider, safeInteger, type AgentProvider } from "./validation.ts";

export type ModelEntry = Readonly<{
  id: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  supportsStructuredOutput: boolean;
  available: boolean;
  classifierEligible: boolean;
}>;
export type ModelCatalog = Readonly<{ provider: AgentProvider; observedAt: number; models: readonly ModelEntry[] }>;

/** Host-supplied catalog; no invented model identifiers or unobserved availability. */
export function selectClassifierModel(value: unknown, now: number, maxAgeMs = 86_400_000): ModelEntry {
  const catalog = object(value, ["provider", "observedAt", "models"]);
  provider(catalog.provider);
  safeInteger(now, 0, Number.MAX_SAFE_INTEGER);
  safeInteger(maxAgeMs, 1, 86_400_000);
  const observedAt = safeInteger(catalog.observedAt, 0, now);
  if (now - observedAt > maxAgeMs) throw new Error("MODEL_CATALOG_STALE");
  if (!Array.isArray(catalog.models) || catalog.models.length > 256) throw new Error("INVALID_MODEL_CATALOG");
  const seen = new Set<string>();
  const eligible: ModelEntry[] = [];
  for (const raw of catalog.models) {
    const entry = object(raw, ["id", "inputUsdPerMillion", "outputUsdPerMillion", "supportsStructuredOutput", "available", "classifierEligible"]);
    const id = boundedText(entry.id, 160);
    if (seen.has(id)) throw new Error("DUPLICATE_MODEL");
    seen.add(id);
    for (const key of ["inputUsdPerMillion", "outputUsdPerMillion"] as const) {
      if (typeof entry[key] !== "number" || !Number.isFinite(entry[key]) || entry[key] < 0 || entry[key] > 1_000_000) throw new Error("INVALID_MODEL_PRICE");
    }
    for (const key of ["supportsStructuredOutput", "available", "classifierEligible"] as const) {
      if (typeof entry[key] !== "boolean") throw new Error("INVALID_MODEL_CAPABILITY");
    }
    if (entry.supportsStructuredOutput && entry.available && entry.classifierEligible) eligible.push(entry as unknown as ModelEntry);
  }
  // Classification is input-heavy: compare a bounded 2k-input / 128-output workload.
  eligible.sort((a, b) => (a.inputUsdPerMillion * 2_000 + a.outputUsdPerMillion * 128)
    - (b.inputUsdPerMillion * 2_000 + b.outputUsdPerMillion * 128) || a.id.localeCompare(b.id));
  const selected = eligible[0];
  if (selected === undefined) throw new Error("NO_CLASSIFIER_MODEL");
  return Object.freeze({ ...selected });
}

export type Classification = Readonly<{
  respond: boolean;
  confidence: number;
  reason: "requested" | "helpful" | "human_active" | "not_needed" | "uncertain";
}>;

/** Strict JSON only: prose, fenced JSON, unknown fields and contradictory decisions fail closed. */
export function parseClassification(value: unknown): Classification {
  const parsed = typeof value === "string" ? JSON.parse(boundedText(value, 4_096)) as unknown : value;
  const record = object(parsed, ["respond", "confidence", "reason"]);
  if (typeof record.respond !== "boolean" || typeof record.confidence !== "number"
    || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) throw new Error("INVALID_CLASSIFICATION");
  if (typeof record.reason !== "string" || !["requested", "helpful", "human_active", "not_needed", "uncertain"].includes(record.reason)) throw new Error("INVALID_CLASSIFICATION_REASON");
  if (record.respond && record.reason !== "requested" && record.reason !== "helpful") throw new Error("CONTRADICTORY_CLASSIFICATION");
  return Object.freeze(record as Classification);
}
