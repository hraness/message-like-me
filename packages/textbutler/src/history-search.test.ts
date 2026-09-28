import { expect, test } from "bun:test";
import { HISTORY_SEARCH_LIMITS, searchHistory, type HistoryMessage, type HistoryPageReader } from "./history-search.ts";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const signal = new AbortController().signal;
const msg = (id: string, daysAgo: number, author: HistoryMessage["author"], text: string): HistoryMessage =>
  ({ id, at: NOW - daysAgo * 86_400_000, author, text });

/** A paged source serving `all` (newest first), honoring before/after/limit. */
function source(all: HistoryMessage[]): HistoryPageReader & { windows: { before: string | null; after: string | null; limit: number }[] } {
  const windows: { before: string | null; after: string | null; limit: number }[] = [];
  const read: HistoryPageReader = async (window, _signal) => {
    windows.push(window);
    const before = window.before === null ? Infinity : Date.parse(window.before);
    const after = window.after === null ? -Infinity : Date.parse(window.after);
    return all.filter(m => m.at < before && m.at >= after).sort((a, b) => a.at - b.at).slice(-window.limit);
  };
  return Object.assign(read, { windows });
}

test("a query returns newest matches first, each with date, author and a ≤300-byte excerpt", async () => {
  const read = source([msg("m1", 40, "contact", "let's meet on the bridge again"), msg("m2", 30, "owner", "the bridge at noon"), msg("m3", 20, "butler", "🤖{ bridge confirmed }"), msg("m4", 10, "contact", "dinner instead")]);
  const result = await searchHistory(read, { query: "Bridge" }, { now: NOW, signal });
  expect(result.matches.map(m => m.id)).toEqual(["m3", "m2", "m1"]);
  expect(result.matches[0]).toMatchObject({ at: new Date(NOW - 20 * 86_400_000).toISOString(), author: "butler" });
  expect(result.complete).toBe(true);
  expect(result.nextCursor).toBeNull();
  expect(result.scanned).toBe(4);
});

test("all query words must appear; matching is case-insensitive and folded", async () => {
  const read = source([msg("a", 5, "contact", "the Blue Bridge is done"), msg("b", 4, "contact", "bridge only"), msg("c", 3, "contact", "blue only")]);
  const result = await searchHistory(read, { query: "blue bridge" }, { now: NOW, signal });
  expect(result.matches.map(m => m.id)).toEqual(["a"]);
});

test("author filter: owner covers the owner's self-chat copy; contact excludes it", async () => {
  // Self chat: an owner send exists as an outgoing "self" row plus an incoming
  // "contact" echo within two minutes; only one should surface.
  const echoed = msg("in", 5, "contact", "butler status");
  const copy = { ...echoed, id: "out", author: "self" as const, at: echoed.at - 2000 };
  const read = source([copy, echoed, msg("b", 3, "butler", "ok")]);
  const all = await searchHistory(read, { author: "any" }, { now: NOW, signal });
  expect(all.matches.map(m => m.id)).toEqual(["b", "in"]);
  expect(await searchHistory(read, { author: "owner" }, { now: NOW, signal })).toMatchObject({ matches: [], scanned: 3 });
  expect((await searchHistory(read, { author: "contact" }, { now: NOW, signal })).matches.map(m => m.id)).toEqual(["in"]);
  // In an ordinary chat the owner's own messages are "owner" rows.
  const owner = await searchHistory(source([msg("o", 2, "owner", "mine"), msg("c", 1, "contact", "yours")]), { author: "owner" }, { now: NOW, signal });
  expect(owner.matches.map(m => m.id)).toEqual(["o"]);
});

test("dates bound the window locally, and a cursor continues strictly older", async () => {
  const all = Array.from({ length: HISTORY_SEARCH_LIMITS.pageSize * 2 + 5 }, (_, i) => msg(`m${i}`, 400 - i, "contact", `note ${i}`));
  const read = source(all);
  const from = new Date(NOW - 400 * 86_400_000).toISOString().slice(0, 10), to = new Date(NOW - 100 * 86_400_000).toISOString().slice(0, 10);
  const first = await searchHistory(read, { from, to }, { now: NOW, signal });
  expect(first.matches.length).toBe(20);
  expect(first.complete).toBe(false);
  // `to` is inclusive: the window ends where the next local day starts.
  const [ty, tm, td] = to.split("-").map(Number);
  const [fy, fm, fd] = from.split("-").map(Number);
  expect(read.windows[0]!.before).toBe(new Date(ty!, tm! - 1, td! + 1).toISOString());
  expect(read.windows[0]!.after).toBe(new Date(fy!, fm! - 1, fd!).toISOString());
  expect(first.matches[0]!.id).toBe("m300"); // newest inside the window
  const second = await searchHistory(read, { from, to, cursor: first.nextCursor }, { now: NOW, signal });
  expect(second.matches.every(m => m.at < first.matches.at(-1)!.at)).toBe(true);
  // Keep paging: no duplicates, and the window eventually ends.
  const seenIds = new Set([...first.matches, ...second.matches].map(m => m.id));
  let page = second;
  for (let i = 0; i < 20 && !page.complete; i++) {
    page = await searchHistory(read, { from: "2025-01-01", to, cursor: page.nextCursor }, { now: NOW, signal });
    for (const m of page.matches) { expect(seenIds.has(m.id)).toBe(false); seenIds.add(m.id); }
  }
  expect(page.complete).toBe(true);
});

test("a full scan with no matches reports complete; a page-cap scan returns a cursor", async () => {
  const miss = await searchHistory(source([msg("a", 1, "contact", "hello")]), { query: "missing" }, { now: NOW, signal });
  expect(miss).toMatchObject({ matches: [], complete: true, scanned: 1 });
  const dense = source(Array.from({ length: HISTORY_SEARCH_LIMITS.pageSize * HISTORY_SEARCH_LIMITS.pages }, (_, i) => msg(`x${i}`, 900 - i, "contact", "hit")));
  const capped = await searchHistory(dense, { query: "misspelled" }, { now: NOW, signal });
  expect(capped.matches).toEqual([]);
  expect(capped.complete).toBe(false);
  expect(capped.nextCursor).not.toBeNull();
  expect(dense.windows.length).toBe(HISTORY_SEARCH_LIMITS.pages);
});

test("long matches are excerpted around the first term hit, never beyond 300 bytes", async () => {
  const long = `${"prefix ".repeat(80)}needle ${"suffix ".repeat(80)}`;
  const result = await searchHistory(source([msg("m", 1, "contact", long)]), { query: "needle" }, { now: NOW, signal });
  expect(result.matches[0]!.truncated).toBe(true);
  expect(Buffer.byteLength(result.matches[0]!.text)).toBeLessThanOrEqual(HISTORY_SEARCH_LIMITS.excerptBytes);
  expect(result.matches[0]!.text).toContain("needle");
});

test("malformed requests fail before any page is read", async () => {
  let calls = 0;
  const read: HistoryPageReader = async () => { calls++; return []; };
  for (const request of [
    { from: "last week" }, { from: "2026-02-30" }, { to: "09/01/2026" },
    { from: "2026-09-10", to: "2026-09-01" },
    { cursor: "yesterday" }, { cursor: "2026-01-01T00:00:00Z" },
    { query: "a".repeat(HISTORY_SEARCH_LIMITS.queryBytes + 1) },
    { query: Array.from({ length: 9 }, (_, i) => `w${i}`).join(" ") },
    { author: "everyone" as never },
    { cursor: "2027-01-01T00:00:00.000Z", to: "2026-09-01" }, // cursor outside the window
  ]) await expect(searchHistory(read, request, { now: NOW, signal })).rejects.toThrow();
  expect(calls).toBe(0);
});

test("a provider page that cannot move backwards fails instead of looping forever", async () => {
  const stuck: HistoryPageReader = async () => Array.from({ length: HISTORY_SEARCH_LIMITS.pageSize }, (_, i) => msg(`s${i}`, 1, "contact", "x"));
  // No matches, so it keeps paging — and a page that cannot move is refused.
  await expect(searchHistory(stuck, { query: "misspelled" }, { now: NOW, signal })).rejects.toThrow();
});
