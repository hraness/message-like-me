import { DEFAULT_DISCLOSURE, disclosedText, type ContactSettings } from "./config.ts";
import { keywordPresent } from "./decision.ts";
import type { RunJournal, SendOrigin } from "./journal.ts";
import type { AutomationMessage } from "../../transport/src/automation.ts";

export type MessageAuthor = "contact" | "owner" | "butler" | "self" | "unknown";

/** Bootstrap history has no contact settings yet, so the journal decides:
 * butler provenance is butler, operator provenance is the owner's own text.
 * Unjournaled text in the default visible wrap predates the journal and stays
 * butler output; everything else outgoing is the owner's. */
export function historyAuthor(message: { author: "owner" | "contact" | "butler"; text: string | null }, origin: SendOrigin | null,
  disclosure: ContactSettings["disclosure"] = DEFAULT_DISCLOSURE): "owner" | "contact" | "butler" {
  if (message.author !== "owner") return message.author;
  if (origin !== null) return origin === "butler" ? "butler" : "owner";
  return message.text !== null && disclosedText(message.text, disclosure) ? "butler" : "owner";
}

/** Trusted journal provenance covers disclosure-free sends; the configured
 * visible wrap covers sends that predate this journal. With every marker
 * cleared, journal provenance is the only distinction from owner text.
 * In a self chat the owner's own number is the participant: every send lands
 * twice, as an inbound copy and an outgoing echo. The echo is not an owner
 * answer, and the butler's own sends echo back inbound under fresh IDs. */
export function messageAuthor(message: { id: string; direction: "incoming" | "outgoing" | "unknown"; text: string | null; occurredAt?: string }, contact: ContactSettings, journal?: RunJournal): MessageAuthor {
  if (message.direction === "incoming") {
    if (contact.selfChat) {
      if (message.text !== null && disclosedText(message.text, contact.disclosure)) return "butler";
      if (message.text === null && message.occurredAt !== undefined) {
        const sent = journal?.lastButlerSendAt(contact.id);
        if (sent !== null && sent !== undefined && Math.abs(Date.parse(message.occurredAt) - sent) <= 60_000) return "butler";
      }
    }
    return "contact";
  }
  if (message.direction !== "outgoing") return "unknown";
  const origin = journal?.messageOrigin(contact.id, message.id) ?? null;
  if (origin === "butler") return "butler";
  // Operator sends are the owner's own words: never butler output for loop
  // guards or style, whatever their text looks like.
  if (origin === null && message.text !== null && disclosedText(message.text, contact.disclosure)) return "butler";
  return contact.selfChat ? "self" : "owner";
}

export interface PendingCluster {
  readonly messageIds: readonly string[];
  readonly latestId: string;
  readonly latestAt: number;
  readonly preview: string | null;
  readonly count: number;
}

/** The trailing same-author text run at the conversation tail. A contact run
 * is unanswered inbound text; an owner run is pending only when it contains an
 * explicit keyword invocation. Reactions, edits and deletes between texts do
 * not answer them; a different author ends the run. */
export function pendingCluster(messages: readonly AutomationMessage[], contact: ContactSettings, journal?: RunJournal, limit = 20): PendingCluster | null {
  const collected: AutomationMessage[] = [];
  let run: "contact" | "owner" | null = null;
  for (let index = messages.length - 1; index >= 0 && collected.length < limit; index -= 1) {
    const message = messages[index]!;
    if (message.kind !== "message") continue;
    const author = messageAuthor(message, contact, journal);
    if (author === "self") continue;
    if (author !== "contact" && author !== "owner") break;
    run ??= author;
    if (author !== run) break;
    collected.push(message);
  }
  if (!collected.length || (run === "owner" && !collected.some(message => message.text !== null && keywordPresent(message.text, contact.keyword)))) return null;
  const latest = collected[0]!;
  return { messageIds: collected.map(message => message.id).reverse(), latestId: latest.id, latestAt: Date.parse(latest.occurredAt), preview: latest.text, count: collected.length };
}
