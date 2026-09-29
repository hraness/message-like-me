/**
 * The film's numbers and status line, taken from the site's launch facts
 * (site/app/launch/facts.ts), which a site test pins to the product source.
 * film.json holds only words; nothing here is typed by hand.
 */
import { launchFacts, LAUNCH_STATUS } from "../site/app/launch/facts.ts";
import type { FilmCopy, FilmProofItem } from "./timeline.ts";

/** "5 minutes" → 5 with a short unit; "12" → 12. */
function proofItem(fact: string, unit: string, label: string): FilmProofItem {
  const value = Number.parseFloat(fact);
  if (!Number.isFinite(value)) throw new Error(`Launch fact "${fact}" has no number.`);
  return { value, suffix: unit, label };
}

export function launchFilmCopy(copy: FilmCopy): FilmCopy {
  return {
    ...copy,
    proof: {
      caption: copy.proof.caption,
      items: [
        proofItem(launchFacts.debounce.value, " s", "it waits for them to finish typing"),
        proofItem(launchFacts.cooldown.value, " min", "it stays quiet after you text them"),
        proofItem(launchFacts.hourlyCap.value, "", "replies an hour, at most"),
      ],
    },
    end: { line: `${LAUNCH_STATUS}. Runs on your Mac.` },
  };
}
