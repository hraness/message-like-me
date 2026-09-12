import type { ClaudeApiKeyResolver } from "./claude-sdk.ts";
import { claudeApiClient, type ClaudeApiClient } from "./claude-api-transport.ts";
import { selectClassifierModel, type ModelCatalog } from "./models.ts";
import { boundedText, identifier, object, safeInteger } from "./validation.ts";

export type ClaudePriceCatalog = Readonly<{
  observedAt: number;
  models: readonly Readonly<{ id: string; inputUsdPerMillion: number; outputUsdPerMillion: number; classifierEligible: boolean }>[];
}>;
export type ClaudeModelDiscoveryOptions = Readonly<{
  credentials: ClaudeApiKeyResolver;
  accountId: string;
  priceCatalog: ClaudePriceCatalog;
  signal: AbortSignal;
  now?: () => number;
}>;

/** Lists availability only. It never sends a model prompt or invents provider prices. */
export async function discoverClaudeModels(options: ClaudeModelDiscoveryOptions): Promise<ModelCatalog> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const signal = AbortSignal.any([options.signal, controller.signal]);
  try {
    return await options.credentials.withApiKey(identifier(options.accountId), signal,
      key => discoverWithClient(claudeApiClient(key, signal), options.priceCatalog, signal, options.now ?? Date.now));
  } catch { throw new Error("CLAUDE_MODEL_DISCOVERY_FAILED"); }
  finally { clearTimeout(timer); }
}

/** Internal test seam: transport cannot be selected by owner/contact configuration. */
export function parseClaudePriceCatalog(value: unknown, now = Date.now()): ClaudePriceCatalog {
  const at = safeInteger(now, 0, Number.MAX_SAFE_INTEGER);
  const input = object(value, ["observedAt", "models"]);
  const observed = safeInteger(input.observedAt, 0, at);
  if (at - observed > 30 * 86_400_000 || !Array.isArray(input.models) || input.models.length > 256) throw new Error("CLAUDE_PRICES_STALE_OR_INVALID");
  const priceRows = input.models.map(raw => {
    const row = object(raw, ["id", "inputUsdPerMillion", "outputUsdPerMillion", "classifierEligible"]);
    const id = boundedText(row.id, 160);
    if (!/^[A-Za-z0-9_-]+$/u.test(id) || typeof row.classifierEligible !== "boolean") throw new Error("CLAUDE_PRICE_INVALID");
    for (const name of ["inputUsdPerMillion", "outputUsdPerMillion"] as const) {
      if (typeof row[name] !== "number" || !Number.isFinite(row[name]) || row[name] <= 0 || row[name] > 1_000_000) throw new Error("CLAUDE_PRICE_INVALID");
    }
    return { id, inputUsdPerMillion: row.inputUsdPerMillion as number, outputUsdPerMillion: row.outputUsdPerMillion as number, classifierEligible: row.classifierEligible };
  });
  if (new Set(priceRows.map(row => row.id)).size !== priceRows.length) throw new Error("CLAUDE_DUPLICATE_PRICE");
  return Object.freeze({ observedAt: observed, models: Object.freeze(priceRows.map(row => Object.freeze(row))) });
}

export async function discoverWithClient(client: ClaudeApiClient, prices: ClaudePriceCatalog, signal: AbortSignal, now: () => number): Promise<ModelCatalog> {
  const at = safeInteger(now(), 0, Number.MAX_SAFE_INTEGER);
  const priceRows = parseClaudePriceCatalog(prices, at).models;
  const seen = new Set<string>(), available = new Map<string, boolean>();
  let after: string | undefined;
  for (let page = 0; page < 3; page++) {
    signal.throwIfAborted();
    const response = await client.models.list({ limit: 100, ...(after ? { after_id: after } : {}) }, { signal });
    if (!Array.isArray(response.data) || response.data.length > 100 || typeof response.has_more !== "boolean") throw new Error("CLAUDE_MODEL_RESPONSE_INVALID");
    for (const model of response.data) {
      const id = boundedText(model.id, 160);
      if (model.type !== "model" || !/^[A-Za-z0-9_-]+$/u.test(id) || seen.has(id) || seen.size >= 256) throw new Error("CLAUDE_MODEL_RESPONSE_INVALID");
      seen.add(id); available.set(id, model.capabilities?.structured_outputs?.supported === true);
    }
    if (!response.has_more) {
      signal.throwIfAborted();
      const catalog = { provider: "claude" as const, observedAt: safeInteger(now(), at, Number.MAX_SAFE_INTEGER),
        models: priceRows.map(row => Object.freeze({ ...row, available: available.has(row.id), supportsStructuredOutput: available.get(row.id) === true })) };
      selectClassifierModel(catalog, catalog.observedAt);
      return Object.freeze({ ...catalog, models: Object.freeze(catalog.models) });
    }
    const last = response.data.at(-1)?.id;
    if (!last || last !== response.last_id || page === 2) throw new Error("CLAUDE_MODEL_PAGINATION_INVALID");
    after = last;
  }
  throw new Error("CLAUDE_MODEL_PAGINATION_INVALID");
}
