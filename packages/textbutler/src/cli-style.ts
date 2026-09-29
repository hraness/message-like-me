/** Hraness CLI style contract (desktop-foundation docs, SPEC § C and § D):
 * audience detection from the kit, status symbols with ASCII fallbacks, and
 * the one-line error shape. Textbutler prints no color, so NO_COLOR needs no
 * handling here. */
import { CLI_SYMBOLS } from "@hraness/desktop-foundation/cli-style";
import { detectAudience as kitAudience, type Audience } from "@hraness/desktop-foundation/audience";

export type { Audience };
type Env = Readonly<Record<string, string | undefined>>;

export function detectAudience(input: { env?: Env; stderrIsTTY?: boolean } = {}): Audience {
  return kitAudience({ ...(input.env ? { env: input.env as NodeJS.ProcessEnv } : {}), ...(input.stderrIsTTY === undefined ? {} : { stderrIsTTY: input.stderrIsTTY }) });
}

export interface Symbols { ok: string; fail: string; warn: string; next: string; on: string; off: string; skip: string; busy: string; notice: string }
const pick = (form: "glyph" | "ascii"): Symbols => ({ ok: CLI_SYMBOLS.ok[form], fail: CLI_SYMBOLS.fail[form], warn: CLI_SYMBOLS.warn[form], next: CLI_SYMBOLS.next[form],
  on: CLI_SYMBOLS.on[form], off: CLI_SYMBOLS.off[form], skip: CLI_SYMBOLS.skip[form], busy: CLI_SYMBOLS.progress[form], notice: CLI_SYMBOLS.notice[form] });
const UNICODE: Symbols = pick("glyph");
const ASCII: Symbols = pick("ascii");

/** ASCII when TERM=dumb, HRANESS_ASCII=1, or no locale variable names UTF-8. */
export function symbolsFor(env: Env = process.env): Symbols {
  if (env.HRANESS_ASCII === "1" || env.TERM === "dumb") return ASCII;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return /utf-?8/iu.test(locale) ? UNICODE : ASCII;
}

/** A usage or input error: one sentence, then exactly one next command. */
export class CliUsageError extends Error {
  constructor(message: string, readonly next: string, readonly code = "usage") { super(message); this.name = "CliUsageError"; }
}

export function renderError(message: string, next: string | undefined, symbols: Symbols): string {
  return `${symbols.fail} ${message}\n${next === undefined ? "" : `${symbols.next} ${next}\n`}`;
}

export function jsonError(code: string, message: string, next: string | undefined): string {
  return `${JSON.stringify({ ok: false, error: { code, message, ...(next === undefined ? {} : { next }) } })}\n`;
}

/** Levenshtein distance, bounded to short command words. */
function distance(a: string, b: string): number {
  if (a.length > 40 || b.length > 40) return Number.POSITIVE_INFINITY;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** The closest known word within two edits, or undefined. */
export function closest(input: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined, score = 3;
  for (const candidate of candidates) { const value = distance(input.toLowerCase(), candidate); if (value < score) { best = candidate; score = value; } }
  return best;
}

/** Terminal-safe single-line echo of user input inside an error. */
export function quoteInput(value: string): string {
  return JSON.stringify(value.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/gu, "").slice(0, 60));
}
