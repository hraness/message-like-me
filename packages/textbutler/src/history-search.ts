/** Bounded search through one conversation's full history. The host pages
 * backwards through dated provider windows, filters locally, and returns at
 * most HISTORY_SEARCH_LIMITS.matches short excerpts plus a cursor for the next,
 * older page. Everything returned is untrusted quoted conversation text. */
export const HISTORY_SEARCH_LIMITS = Object.freeze({ matches: 20, pageSize: 200, pages: 5, excerptBytes: 300, queryBytes: 200, terms: 8 });

export type HistoryAuthor = "owner" | "contact" | "butler" | "self";
export type HistoryMessage = Readonly<{ id: string; at: number; author: HistoryAuthor; text: string }>;
/** One dated page, oldest first, of messages in [after, before). Fewer than
 * `limit` results means nothing older remains inside the window. */
export type HistoryPageReader = (window: Readonly<{ before: string | null; after: string | null; limit: number }>, signal: AbortSignal) => Promise<readonly HistoryMessage[]>;
export type HistorySearchRequest = Readonly<{ query?: string | null; from?: string | null; to?: string | null; author?: "owner" | "contact" | "any" | null; cursor?: string | null }>;
export type HistorySearchResult = Readonly<{
  matches: readonly Readonly<{ id: string; at: string; author: HistoryAuthor; text: string; truncated: boolean }>[];
  scanned: number; nextCursor: string | null; complete: boolean;
}>;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
/** A calendar day in the host's time zone, as the instant it starts. */
function dayStart(value: string, field: string): number {
  const match = DAY.exec(value);
  if (!match) throw new Error(`${field} must be a date like 2026-03-14`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) throw new Error(`${field} is not a real date`);
  return start.getTime();
}
function instant(value: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error("cursor must be a cursor returned by an earlier history-search");
  return time;
}
const fold = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("en-US");
const clip = (value: string, maximum: number): string => { let result = "", bytes = 0; for (const point of value) { const size = Buffer.byteLength(point); if (bytes + size > maximum) break; result += point; bytes += size; } return result; };

/** An excerpt that keeps the first matching term in view. */
function excerpt(text: string, terms: readonly string[]): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= HISTORY_SEARCH_LIMITS.excerptBytes) return { text, truncated: false };
  const folded = fold(text), hit = terms.length ? Math.min(...terms.map(term => folded.indexOf(term)).filter(index => index >= 0)) : 0;
  const points = [...text], start = Number.isFinite(hit) && hit > 120 ? Math.max(0, [...text.slice(0, hit)].length - 60) : 0;
  const body = clip(points.slice(start).join(""), HISTORY_SEARCH_LIMITS.excerptBytes - (start > 0 ? 6 : 3));
  return { text: `${start > 0 ? "…" : ""}${body}…`, truncated: true };
}

export function parseHistorySearchRequest(value: HistorySearchRequest, now: number): Readonly<{ terms: readonly string[]; author: "owner" | "contact" | "any"; after: number | null; before: number | null }> {
  const query = value.query?.trim() ?? "";
  if (Buffer.byteLength(query) > HISTORY_SEARCH_LIMITS.queryBytes || query.includes("\0")) throw new Error(`query is limited to ${HISTORY_SEARCH_LIMITS.queryBytes} bytes`);
  const terms = [...new Set(fold(query).split(/\s+/u).filter(Boolean))];
  if (terms.length > HISTORY_SEARCH_LIMITS.terms) throw new Error(`query is limited to ${HISTORY_SEARCH_LIMITS.terms} words`);
  const author = value.author ?? "any";
  if (!["owner", "contact", "any"].includes(author)) throw new Error("author must be owner, contact or any");
  const after = value.from ? dayStart(value.from, "from") : null;
  // `to` is inclusive: the window ends where the next local day starts.
  let before: number | null = null;
  if (value.to) { const next = new Date(dayStart(value.to, "to")); next.setDate(next.getDate() + 1); before = next.getTime(); }
  if (value.cursor) {
    const cursor = instant(value.cursor);
    if ((before !== null && cursor > before) || (after !== null && cursor <= after)) throw new Error("cursor is outside the requested dates");
    before = cursor;
  }
  if (before !== null && before > now) before = null;
  if (after !== null && before !== null && after >= before) throw new Error("from must be before to");
  return { terms, author, after, before };
}

/** Scans at most HISTORY_SEARCH_LIMITS.pages dated pages, newest first. */
export async function searchHistory(read: HistoryPageReader, request: HistorySearchRequest, options: Readonly<{ now: number; signal: AbortSignal }>): Promise<HistorySearchResult> {
  const { terms, author, after, before: initial } = parseHistorySearchRequest(request, options.now);
  const matches: { id: string; at: string; author: HistoryAuthor; text: string; truncated: boolean }[] = [];
  let before = initial, scanned = 0;
  for (let page = 0; page < HISTORY_SEARCH_LIMITS.pages; page++) {
    const messages = await read({ before: before === null ? null : new Date(before).toISOString(), after: after === null ? null : new Date(after).toISOString(), limit: HISTORY_SEARCH_LIMITS.pageSize }, options.signal);
    options.signal.throwIfAborted();
    const newestFirst = [...messages].sort((a, b) => b.at - a.at);
    for (const message of newestFirst) {
      scanned++;
      const folded = fold(message.text);
      // In a self chat each owner send lands twice: the outgoing copy ("self")
      // and its incoming echo ("contact"). The echo stands for both.
      if (message.author === "self" && newestFirst.some(other => other.author === "contact" && other.text === message.text && Math.abs(other.at - message.at) <= 120_000)) continue;
      const authorMatches = author === "any" ? message.author !== "self" : author === "owner" ? message.author === "owner" || message.author === "self" : message.author === author;
      if (authorMatches && terms.every(term => folded.includes(term))) {
        matches.push({ id: message.id, at: new Date(message.at).toISOString(), author: message.author, ...excerpt(message.text, terms) });
        // Resume strictly before the last returned match. Messages sharing its
        // exact millisecond are rare and may be skipped by the next page.
        if (matches.length === HISTORY_SEARCH_LIMITS.matches) return { matches, scanned, nextCursor: new Date(message.at).toISOString(), complete: false };
      }
    }
    const oldest = newestFirst.at(-1);
    if (messages.length < HISTORY_SEARCH_LIMITS.pageSize || oldest === undefined) return { matches, scanned, nextCursor: null, complete: true };
    if (before !== null && oldest.at >= before) throw new Error("History paging did not move backwards");
    before = oldest.at;
  }
  return { matches, scanned, nextCursor: before === null ? null : new Date(before).toISOString(), complete: false };
}
