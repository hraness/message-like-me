/** Menu state fixtures (T5): each state rendered to an indented text tree and
 * checked against the menu standard. The v1 runner has no Option-key
 * alternates, so diagnostics live under Details; the kit v2 move puts them
 * behind ⌥ and runs the shared lintMenu --strict over these same states. */
import { describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { validateSnapshot, type MenuItem } from "@hraness/desktop-foundation";
import { snapshotItems, type MenuExtras } from "./menubar.ts";
import { TRAY_ICON } from "./menubar-icon.ts";
import { disconnectedSnapshot, type DesktopSnapshot } from "../../control/src/index.ts";

export function renderMenuTree(items: readonly MenuItem[], depth = 0): string {
  const pad = "  ".repeat(depth);
  return items.map(item => {
    if (item.kind === "separator") return `${pad}─────────`;
    if (item.kind === "quit") return `${pad}${item.label}  ⌘Q`;
    if (item.kind === "label") return `${pad}${item.label}`;
    if (item.kind === "submenu") return `${pad}${item.label} ▸\n${renderMenuTree(item.items, depth + 1)}`;
    return `${pad}${item.checked === true ? "✓ " : ""}${item.label}${item.enabled === false ? "  (dimmed)" : ""}`;
  }).join("\n");
}

const PROPER = /\b(?:Textbutler|macOS|Messages|iMessage|WhatsApp|Beeper|System Settings|Full Disk Access|Automation|Claude|Codex|Devin|Ghostget|Contact \d+|Alice Example|Account \d+|Messages)\b/gu;
/** The lintMenu rules a v1 snapshot can break. Returns findings; empty means clean. */
export function lintV1(items: readonly MenuItem[]): string[] {
  const findings: string[] = [];
  const top = items.filter(item => item.kind !== "separator");
  if (top.length > 10) findings.push(`top-level-count: ${top.length}`);
  const last = items.at(-1);
  if (last?.kind !== "quit" || last.label !== "Quit Textbutler") findings.push("quit");
  if (items[0]?.kind !== "label") findings.push("status: the first row is not the status line");
  const statusRows = items.slice(0, items.findIndex(item => item.kind === "separator"));
  if (statusRows.length > 3) findings.push("status-count");
  const visit = (rows: readonly MenuItem[], depth: number, topLevel: boolean): void => {
    if (!rows.length) findings.push("empty-submenu");
    for (const item of rows) {
      if (item.kind === "separator") continue;
      const label = item.label;
      if (item.kind === "action" && depth > 2) findings.push(`depth: ${label}`);
      if (/(?:^|\s)(?:~?\/)[\w.-]|https?:|[0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{8,}|(?:^|\s)--[a-z]/iu.test(label) || /\btextbutler [a-z]/u.test(label)) findings.push(`raw-text: ${label}`);
      const head = label.split(" · ")[0]!.replace(/^[^\p{L}\p{N}]+/u, "");
      if (topLevel && [...head].length > 48) findings.push(`length: ${label}`);
      if (/ [A-Z][a-z]/u.test(head.replace(PROPER, "").slice(1))) findings.push(`sentence-case: ${label}`);
      if (/\.{3}$/u.test(label)) findings.push(`glyph-in-label: ${label}`);
      if (item.kind === "submenu") visit(item.items, depth + 1, false);
    }
  };
  visit(items, 0, true);
  return findings;
}

const settings = (enabled: boolean) => ({ enabled, responseMode: "smart" as const, keyword: "butler", provider: "claude" as const, disclosure: { character: "🤖", begin: "{", end: "}" } });
const connected = (overrides: Partial<DesktopSnapshot> = {}): DesktopSnapshot => ({ ...disconnectedSnapshot(), connection: "connected", revision: 7, detail: "Connected.", ...overrides });
const live = { settings: { paused: false, activeContactLimit: 5 }, automation: { state: "running" as const, detail: "Replies are live." }, messagingProviders: ["imessage" as const, "beeper" as const] };
const alice = { id: "contact-1", name: "Alice Example", subtitle: "iMessage · Contact grant active", settings: { ...settings(true), accountId: "claude-main" } };
const accounts = [{ id: "claude-main", label: "Claude", provider: "claude" as const, route: "claude-api" as const, status: "ready" as const, detail: "Ready.", defaultReplyModel: "m", classifierModel: "c" }];
const many = <T,>(count: number, make: (index: number) => T): T[] => Array.from({ length: count }, (_, index) => make(index));

const STATES: Record<string, { snapshot: DesktopSnapshot; extras?: MenuExtras; age?: number | null }> = {
  "first-run": { snapshot: disconnectedSnapshot(), age: null },
  "needs-access": { snapshot: connected({ ...live, contacts: [alice], providerAccounts: accounts }), extras: { access: { needs: "full-disk-access" } } },
  empty: { snapshot: connected({ messagingProviders: ["imessage"] }) },
  running: { snapshot: connected({ ...live, contacts: [alice, { id: "contact-2", name: "Contact 2", subtitle: "Beeper", settings: settings(false) }], providerAccounts: accounts,
    replies: { scannedAt: "2026-09-19T00:00:00Z", pending: [{ contactId: "contact-1", name: "Alice Example", provider: "imessage", enabled: true, pendingCount: 2, lastInboundAt: "2026-09-19T00:00:00Z", preview: "Dinner at 7?", sendable: true, reason: null }], drafts: [] },
    activity: [{ id: "run-1", at: "2026-09-19T15:48:00Z", contactId: "contact-1", title: "submitted", detail: "Replied in one message." }],
    capabilities: [{ id: "messages", status: "available", detail: "Reads and sends in chats you turn on." }] }) },
  paused: { snapshot: connected({ ...live, settings: { paused: true, activeContactLimit: 5 }, contacts: [alice], providerAccounts: accounts }) },
  error: { snapshot: connected({ ...live, contacts: [alice], providerAccounts: accounts }), extras: { failure: { sentence: "Couldn't pause automatic replies", detail: "Settings changed. Try again." }, pending: true } },
  "max-accounts": { snapshot: connected({ ...live,
    contacts: many(24, index => ({ id: `contact-${index}`, name: `Contact ${index}`, subtitle: "Beeper · Butler off or grant unavailable", settings: settings(index % 3 === 0) })),
    providerAccounts: many(10, index => ({ id: `account-${index}`, label: `Account ${index}`, provider: "claude" as const, route: "claude-api" as const, status: index % 2 ? "ready" as const : "setup-required" as const,
      detail: "Account detail.", defaultReplyModel: "m", classifierModel: "c" })),
    replies: { scannedAt: "2026-09-19T00:00:00Z", pending: many(12, index => ({ contactId: `contact-${index}`, name: `Contact ${index}`, provider: "beeper", enabled: false, pendingCount: 1,
      lastInboundAt: "2026-09-19T00:00:00Z", preview: "See you then.", sendable: true, reason: null })),
      drafts: many(12, index => ({ id: `draft:${index}`, contactId: `contact-${index}`, name: `Contact ${index}`, summary: "Reply", preview: "Sounds good.", actionCount: 2, expiresAt: "2026-09-19T01:00:00Z" })) },
    activity: many(10, index => ({ id: `event-${index}`, at: `2026-09-19T0${index}:00:00Z`, contactId: null, title: index % 2 ? "submitted" : "ignored", detail: "Detail." })) }),
    extras: { failure: { sentence: "Couldn't check for replies" }, candidates: { detail: "Choose a conversation.", list: many(14, index => ({ id: `candidate-${index}`, name: `Contact ${index + 30}`, subtitle: "Beeper", eligible: index !== 1, reason: index === 1 ? "Already added" : "Ready to add" })) } } },
};

describe("menu state fixtures", () => {
  for (const [name, state] of Object.entries(STATES)) {
    test(`${name} renders the committed tree and passes the menu rules`, async () => {
      const items = snapshotItems(state.snapshot, { confirmedAgeSeconds: state.age === undefined ? 4 : state.age, fresh: state.age !== null }, state.extras);
      validateSnapshot({ version: 1, type: "snapshot", appId: "textbutler", name: "Textbutler", title: "\u{1f916}", icon: TRAY_ICON, revision: 1, items });
      const tree = `${renderMenuTree(items).replace(/\d{1,2}:\d{2} [AP]M/gu, "3:48 PM")}\n`;
      const path = new URL(`./__fixtures__/menu/${name}.txt`, import.meta.url);
      if (process.env.UPDATE_MENU_FIXTURES === "1") await writeFile(path, tree);
      expect(tree).toBe(await readFile(path, "utf8"));
      expect(lintV1(items)).toEqual([]);
    });
  }
  test("the lint catches what the standard forbids", () => {
    const bad: MenuItem[] = [{ kind: "action", id: "a", label: "Open Dashboard" }, ...many(10, index => ({ kind: "label" as const, label: `Row ${index} at ~/Library/x` })),
      { kind: "submenu", label: "Deep", items: [{ kind: "submenu", label: "Deeper", items: [{ kind: "submenu", label: "Deepest", items: [{ kind: "action", id: "b", label: "Run textbutler doctor" }] }] }] }];
    const findings = lintV1(bad).join("\n");
    for (const rule of ["top-level-count", "quit", "status:", "raw-text", "sentence-case", "depth"]) expect(findings).toContain(rule);
  });
});
