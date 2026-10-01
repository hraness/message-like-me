import { MemoryStore } from "@hraness/algal";
import { AgentContextHost, putAgentContext, type AgentContextEntryInput } from "@hraness/algal/agent-context";
import { parseAgentContextQuery, queryAgentContext } from "@hraness/algal/agent-context-tools";

/** The caller supplies this reply's already-authorized contact material before
 * projection. The model receives a bound query, never the host or another ref. */
export async function createReplyContextAccess(entries: readonly AgentContextEntryInput[]) {
  const store = new MemoryStore(), snapshot = await putAgentContext(store, entries), host = new AgentContextHost(store);
  const reader = host.bind(await host.grant(snapshot, undefined, { maxReadBytes: 2048, maxSearchResults: 8 }));
  return { query: async (query: unknown) => {
    const parsed = parseAgentContextQuery(query), value = await queryAgentContext(reader, query);
    if (Buffer.byteLength(JSON.stringify(value)) > 4096) throw new Error("Context response exceeds reply budget; request fewer entries or a smaller slice");
    const indices = parsed.op === "read" || parsed.op === "slice" ? [parsed.index]
      : parsed.op === "search" ? (value as { matches: Array<{ index: number }> }).matches.map(match => match.index) : [];
    return { value, indices: [...new Set(indices)] };
  } };
}
