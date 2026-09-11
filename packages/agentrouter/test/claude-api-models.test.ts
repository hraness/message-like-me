import { expect, test } from "bun:test";
import { discoverWithClient, type ClaudePriceCatalog } from "../src/claude-api-models.ts";
import type { ClaudeApiClient } from "../src/claude-api-transport.ts";
import { selectClassifierModel } from "../src/models.ts";
const now = 3_000_000_000;
const prices: ClaudePriceCatalog = { observedAt: now, models: [
  { id: "expensive", inputUsdPerMillion: 10, outputUsdPerMillion: 30, classifierEligible: true },
  { id: "cheap", inputUsdPerMillion: 1, outputUsdPerMillion: 2, classifierEligible: true },
  { id: "unavailable", inputUsdPerMillion: 0.5, outputUsdPerMillion: 0.5, classifierEligible: true },
] };
const model = (id: string, supported = true) => ({ id, type: "model", capabilities: { structured_outputs: { supported } } });
function client(pages: unknown[]) {
  const calls: unknown[] = [];
  return { calls, api: { models: { list: async (input: unknown) => { calls.push(input); return pages[calls.length - 1]; } } } as unknown as ClaudeApiClient };
}
test("observed availability and exact owner prices choose the cheapest eligible model across bounded pages", async () => {
  const f = client([{ data: [model("expensive"), model("new-unpriced")], has_more: true, last_id: "new-unpriced" },
    { data: [model("cheap")], has_more: false, last_id: "cheap" }]);
  const catalog = await discoverWithClient(f.api, prices, new AbortController().signal, () => now);
  expect(selectClassifierModel(catalog, now).id).toBe("cheap");
  expect(catalog.models.find(row => row.id === "unavailable")?.available).toBe(false);
  expect(catalog.models.some(row => row.id === "new-unpriced")).toBe(false);
  expect(f.calls).toEqual([{ limit: 100 }, { limit: 100, after_id: "new-unpriced" }]);
});
test("stale prices, unknown capability, duplicate identities and malformed pagination fail closed", async () => {
  for (const [priceRows, pages] of [
    [{ ...prices, observedAt: 0 }, [{ data: [model("cheap")], has_more: false }]],
    [prices, [{ data: [model("cheap", false)], has_more: false }]],
    [prices, [{ data: [model("cheap"), model("cheap")], has_more: false }]],
    [prices, [{ data: [model("cheap")], has_more: true, last_id: "wrong" }]],
  ] as const) {
    await expect(discoverWithClient(client([...pages]).api, priceRows, new AbortController().signal, () => now)).rejects.toThrow();
  }
});
