/** macOS permission notices and recovery copy for Textbutler, from the
 * desktop-foundation permissions kit so every Hraness product reads the same.
 * This file keeps Textbutler's two presets and its small rendering API.
 *
 * Nothing here triggers a macOS prompt. Opening System Settings happens only
 * for an explicit owner keypress, and only for the allowlisted URLs below. */
import { renderPrePrompt as kitPrePrompt, renderRecovery as kitRecovery, settingsPath as kitPath, settingsUrl as kitUrl, type PermissionNeed as KitNeed } from "@hraness/desktop-foundation";
import type { Symbols } from "./cli-style.ts";

export type TextbutlerPermissionKind = "full-disk-access" | "automation";

export const settingsUrl = (kind: TextbutlerPermissionKind): string => kitUrl(kind)!;
export const settingsPath = (kind: TextbutlerPermissionKind): string => kitPath(kind)!;
/** The only URLs Textbutler ever hands to /usr/bin/open for System Settings. */
export const SETTINGS_URLS: readonly string[] = (["full-disk-access", "automation"] as const).map(settingsUrl);

export interface PermissionNeed {
  kind: TextbutlerPermissionKind;
  /** Verb phrase after "let X", without a final period. */
  ask: string;
  /** One sentence ending with a period. */
  why: string;
  /** The name macOS shows in its dialog and in System Settings. */
  requester: string;
  product: string;
  next: string;
}

/** iMessage runs only through the local Textbutler app, whose display name is
 * "Textbutler", so it is the requester for both kinds. */
const REF = { product: "Textbutler", requester: "Textbutler", next: "textbutler doctor" } as const;

/** MESSAGES_FDA preset. */
export const MESSAGES_FDA: PermissionNeed = { ...REF, kind: "full-disk-access", ask: "read your Messages", why: "Only the chats you pick are read." };
/** AUTOMATION(ref, "Messages", why) preset. */
export const MESSAGES_AUTOMATION: PermissionNeed = { ...REF, kind: "automation", ask: "control Messages", why: "Textbutler only sends replies in chats you turn on." };

/** A fixed environment, so the requester is always the Textbutler app rather
 * than whichever terminal runs the command. */
const APP_ENV: NodeJS.ProcessEnv = {};
const kit = (need: PermissionNeed): KitNeed => ({ kind: need.kind, product: need.product, command: "textbutler", requester: need.requester, ask: need.ask, why: need.why, next: need.next });

export interface RenderedNotice { lines: string[]; confirm?: string }

/** The notice shown before a prompt (asks) or before sending the owner to
 * Settings (settings-only). `interactive` adds the confirm line; it is true
 * only when stdin and stderr are both terminals. */
export function renderPrePrompt(need: PermissionNeed, interactive: boolean): RenderedNotice {
  const shown = kitPrePrompt(kit(need), "cli", APP_ENV);
  return { lines: [shown.title, ...shown.lines], ...(interactive && shown.confirm ? { confirm: shown.confirm } : {}) };
}

/** Recovery after a denial, or when access can't be confirmed. */
export function renderRecovery(need: PermissionNeed, state: "denied" | "unknown", interactive: boolean): { headline: string; detail: string; next: string } {
  const shown = kitRecovery(kit(need), state, "cli", APP_ENV);
  const next = shown.next ?? need.next;
  return { headline: shown.title, detail: shown.lines.join(" "), next: interactive && shown.confirm ? `${next} · ${shown.confirm}` : next };
}

/** The headline and detail as one line, for status text (doctor, JSON detail). */
export function recoverySentence(need: PermissionNeed, state: "denied" | "unknown"): string {
  const shown = renderRecovery(need, state, false);
  return `${shown.headline} ${shown.detail}`;
}

export function formatNotice(notice: RenderedNotice, symbols: Pick<Symbols, "notice">): string {
  const [first, ...rest] = notice.lines;
  return [`${symbols.notice} ${first}`, ...rest.map(line => `   ${line}`), ...(notice.confirm ? [`   ${notice.confirm}`] : [])].join("\n") + "\n";
}

export function formatRecovery(need: PermissionNeed, state: "denied" | "unknown", interactive: boolean, symbols: Pick<Symbols, "fail" | "next">): string {
  const shown = renderRecovery(need, state, interactive);
  return `${symbols.fail} ${shown.headline}\n  ${shown.detail}\n${symbols.next} ${shown.next}\n`;
}
