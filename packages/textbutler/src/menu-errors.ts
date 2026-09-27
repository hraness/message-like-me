/** Plain-language results for menu actions that didn't work.
 *
 * The shared runner drops an action's thrown error, so a click that fails would
 * otherwise show nothing. The menu keeps the last failure and shows it as a
 * ⚠︎ row at the top until the next action or ACTION_ERROR_MS, whichever is
 * first. The label is a short sentence-case line (at most 48 characters, no
 * final period) and the detail is one sentence the person can act on. Neither
 * carries codes, IDs, paths or command lines. */

/** How long a failed action's ⚠︎ row stays, at least (desktop-foundation 0.8 uses the same). */
export const ACTION_ERROR_MS = 30_000;

/** A failed menu action. `message` keeps the stable code for tests and logs. */
export class MenuFailure extends Error {
  constructor(code: string, readonly sentence: string, readonly detail?: string) {
    super(code);
    this.name = "MenuFailure";
  }
}

/** The action was accepted and is still running. The pending row explains it,
 * so no ⚠︎ row is added. */
export class MenuPending extends Error {
  constructor(code: string) {
    super(code);
    this.name = "MenuPending";
  }
}

export interface ShownFailure { sentence: string; detail?: string }

/** One daemon sentence, flattened and bounded, or undefined when it is empty or
 * looks like a bare code. */
export function daemonDetail(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  const text = [...message].map(character => /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/u.test(character) ? " " : character)
    .join("").split(/\s+/u).filter(Boolean).join(" ");
  if (!text || !/\s/u.test(text)) return undefined;
  const scalars = [...text];
  return scalars.length > 160 ? `${scalars.slice(0, 159).join("")}…` : text;
}

const FALLBACK: ShownFailure = { sentence: "That didn't work", detail: "Try again. Setup & readiness in the guided terminal shows what's missing." };

/** What the menu shows for a thrown action error, or null for an action that
 * is still running. Unknown errors never show their own text. */
export function describeMenuFailure(error: unknown): ShownFailure | null {
  if (error instanceof MenuPending) return null;
  if (error instanceof MenuFailure) return error.detail === undefined ? { sentence: error.sentence } : { sentence: error.sentence, detail: error.detail };
  return FALLBACK;
}
