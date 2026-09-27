import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { join } from "node:path";

import { handleCompanionCommand, openBrowser, type CompanionOptions, type MenuItem } from "@hraness/desktop-foundation";
import { CONTROL_PROTOCOL, disconnectedSnapshot, type ControlRequest, type ControlResponse, type DesktopSnapshot, type ConversationCandidate } from "../../control/src/index.ts";
import { requestDaemon } from "./daemon.ts";
import { TRAY_ICON } from "./menubar-icon.ts";
import { awaitOwnerJob, type OwnerControlClient } from "./owner-cli.ts";
import { createLaunchAgentLifecycle, defaultLaunchAgentHost, isolatedBunInvocation } from "./launch-agent.ts";
import { settingsPath, settingsUrl } from "./permission-copy.ts";
import { terminalPromptIO } from "./permission-prompt.ts";
import { macosAccessStep } from "./permission-readiness.ts";
import { ACTION_ERROR_MS, daemonDetail, describeMenuFailure, MenuFailure, MenuPending, type ShownFailure } from "./menu-errors.ts";

const WEBSITE = "https://textbutler.app/";
const SUPPORT = "https://account.hraness.com/support?product=message-like-me&source=desktop#support";

/** Presentation never lets daemon text add lines, bidi overrides or unbounded menus. */
export function menuLabel(text: string, limit = 72): string {
  const clean = [...text]
    .map(character => /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(character) ? " " : character)
    .join("").split(/\s+/u).filter(part => part.length > 0).join(" ");
  const scalars = [...clean];
  return scalars.length > limit ? `${scalars.slice(0, Math.max(0, limit - 1)).join("")}…` : clean;
}

/** Long daemon prose becomes a few bounded read-only rows inside a submenu. */
function detailItems(detail: string): MenuItem[] {
  const words = menuLabel(detail, 216).split(" ");
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if ([...next].length <= 72) current = next;
    else { if (current) rows.push(current); current = word; }
  }
  if (current) rows.push(current);
  const bounded = rows.slice(0, 3);
  return bounded.length ? bounded.map(line => ({ kind: "label" as const, label: menuLabel(line, 72) })) : [{ kind: "label" as const, label: "No additional detail." }];
}

/** Local clock time for menu rows, never an ISO timestamp. */
export function menuTime(iso: string, zone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) }).format(date);
}

const RUN_TITLES: Readonly<Record<string, string>> = {
  submitted: "✓ Replied", ignored: "– Skipped", failed: "✗ Reply failed", partial: "⚠︎ Reply partly sent", indeterminate: "⚠︎ Reply not confirmed",
  cancelled: "– Cancelled", abandoned: "– Stopped", running: "↻ Working on a reply", dispatching: "↻ Sending a reply",
};

function contactItems(snapshot: DesktopSnapshot): MenuItem[] {
  const contacts = snapshot.contacts, accounts = snapshot.providerAccounts ?? [];
  const rows: MenuItem[] = contacts.slice(0, 20).map(contact => ({
    kind: "submenu" as const,
    label: menuLabel(contact.name, 48) || "Contact",
    items: [
      { kind: "action" as const, id: `contact.toggle:${contact.id}`, label: "Automatic replies", checked: contact.settings.enabled },
      ...detailItems(contact.subtitle),
      { kind: "separator" as const },
      { kind: "label" as const, label: contact.settings.enabled ? "Agent account (turn off replies to change)" : "Agent account" },
      ...(accounts.length ? accounts.slice(0, 10).map(account => ({ kind: "action" as const,
        id: `contact.account:${contact.id}:${account.id}`, label: menuLabel(`${account.label} · ${accountState(account.status)}`, 48), checked: contact.settings.accountId === account.id,
        enabled: !contact.settings.enabled && account.status === "ready" })) : [{ kind: "label" as const, label: "No agent account is ready" }]),
    ],
  }));
  if (!contacts.length) rows.push({ kind: "label", label: "No conversations added yet" });
  if (contacts.length > 20) rows.push({ kind: "label", label: `${contacts.length - 20} more in the guided terminal` });
  return rows;
}

const accountState = (status: string): string => status === "ready" ? "Ready" : status === "setup-required" ? "Needs setup" : "Unavailable";

/** Diagnostics the owner rarely needs: kept one level down, out of the way. */
function detailsItems(snapshot: DesktopSnapshot, updated: string): MenuItem[] {
  const accounts = snapshot.providerAccounts ?? [];
  const recent = [...snapshot.activity].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, 8);
  return [
    { kind: "label", label: menuLabel(updated) },
    ...detailItems(snapshot.automation?.detail ?? snapshot.detail),
    { kind: "separator" },
    { kind: "submenu", label: "Recent activity", items: recent.length ? recent.map(event => ({ kind: "submenu" as const,
      label: menuLabel(`${RUN_TITLES[event.title] ?? menuLabel(event.title, 32)} · ${menuTime(event.at)}`, 48) || "Activity", items: detailItems(event.detail) }))
      : [{ kind: "label" as const, label: "Nothing yet" }] },
    { kind: "submenu", label: "Agent accounts", items: accounts.length ? accounts.map(account => ({ kind: "submenu" as const,
      label: menuLabel(`${account.label} · ${accountState(account.status)}`, 48) || "Agent account", items: detailItems(account.detail) }))
      : [{ kind: "label" as const, label: "No agent accounts yet" }] },
    { kind: "submenu", label: "Capabilities", items: snapshot.capabilities.length ? snapshot.capabilities.map(capability => ({ kind: "submenu" as const,
      label: menuLabel(`${capability.id.charAt(0).toUpperCase()}${capability.id.slice(1)} · ${capability.status === "available" ? "Available" : capability.status === "setup-required" ? "Needs setup" : "Not supported"}`, 48),
      items: detailItems(capability.detail) })) : [{ kind: "label" as const, label: "None reported" }] },
    { kind: "action", id: "refresh", label: "Refresh now" },
    { kind: "action", id: "setup-guide", label: "Setup guide ↗" },
  ];
}

/** Conversations waiting for an answer and suggestions waiting for review.
 * The menu can check, suggest and discard; sending needs the full review in
 * the guided terminal. */
function replyItems(snapshot: DesktopSnapshot): MenuItem[] {
  const replies = snapshot.replies ?? { pending: [], drafts: [] };
  const rows: MenuItem[] = [];
  for (const item of replies.pending.slice(0, 10)) {
    const draft = replies.drafts.some(candidate => candidate.contactId === item.contactId);
    rows.push({ kind: "submenu", label: menuLabel(`${item.name} · ${item.pendingCount} to answer`, 48) || "Conversation", items: [
      ...(item.preview ? detailItems(item.preview) : []),
      ...(item.reason ? detailItems(item.reason) : []),
      ...(item.sendable ? [{ kind: "action" as const, id: `replies.suggest:${item.contactId}`, label: draft ? "Suggest a fresh reply" : "Suggest a reply" }] : []),
    ]});
  }
  for (const draft of replies.drafts.slice(0, 10)) {
    rows.push({ kind: "submenu", label: menuLabel(`Suggestion for ${draft.name}`, 48) || "Suggestion", items: [
      ...detailItems(draft.preview),
      ...(draft.actionCount > 1 ? [{ kind: "label" as const, label: `Includes ${draft.actionCount} actions` }] : []),
      { kind: "label" as const, label: menuLabel(`Expires at ${menuTime(draft.expiresAt)}`) },
      { kind: "label" as const, label: "Review and send it in the guided terminal" },
      { kind: "action" as const, id: `replies.discard:${draft.id}`, label: "Discard suggestion" },
    ]});
  }
  return rows;
}

/** The shared native runner accepts at most 256 nodes across the whole
 * tree. Every top-level row is kept, so pause and quit never drop out of a
 * large menu; submenus share what's left, and a cut submenu says so. */
export function boundedMenu(items: readonly MenuItem[]): MenuItem[] {
  const top = items.filter(row => row.kind !== "quit");
  let remaining = 250 - top.length;
  const trim = (rows: readonly MenuItem[]): MenuItem[] => {
    const result: MenuItem[] = [];
    for (const row of rows) {
      if (remaining < (row.kind === "submenu" ? 3 : 2)) { remaining--; result.push({ kind: "label", label: "More in the guided terminal" }); break; }
      remaining--;
      result.push(row.kind === "submenu" ? { ...row, items: trim(row.items) } : row);
    }
    return result;
  };
  return [...top.map(row => row.kind === "submenu" ? { ...row, items: trim(row.items) } : row), { kind: "quit", label: "Quit Textbutler" }];
}

export interface MenuExtras {
  /** macOS access for iMessage, from Textbutler's own records (T3). */
  access?: { needs: "full-disk-access" | "automation" | "app" } | undefined;
  /** The last action that didn't work (T6). */
  failure?: ShownFailure | undefined;
  /** An action is still running in the daemon. */
  pending?: boolean;
  /** Conversations found by the last search, when still current. */
  candidates?: { detail: string; list: readonly ConversationCandidate[] } | undefined;
  /** The last finished background action, in one sentence. */
  lastOperation?: string | null;
}

/** The status line: the fallback glyph for its state, the state, and one detail. */
function statusLine(snapshot: DesktopSnapshot, extras: MenuExtras): string {
  const connected = snapshot.connection === "connected";
  const on = snapshot.contacts.filter(contact => contact.settings.enabled).length;
  const chats = `${on} of ${snapshot.contacts.length} chats`;
  if (!connected) return "⊘ Textbutler isn't running";
  if (extras.access?.needs === "full-disk-access") return "🔒︎ Needs Full Disk Access";
  if (extras.access?.needs === "automation") return "🔒︎ Needs Automation for Messages";
  if (!(snapshot.messagingProviders?.length) || !snapshot.contacts.length) return "◐ Getting started";
  if (snapshot.settings.paused) return "⏸︎ Automatic replies paused";
  return snapshot.automation?.state === "running" ? `● Automatic replies on in ${chats}` : "⚠︎ Replies need setup";
}

/** Map one owner daemon snapshot onto the shared menu contract: a status line,
 * about ten top-level rows, daily actions at the top level, and diagnostics
 * one level down. The daemon stays the authority; browser and Settings pages
 * open only on an explicit click. */
export function snapshotItems(snapshot: DesktopSnapshot, status: { confirmedAgeSeconds: number | null; fresh: boolean }, extras: MenuExtras = {}): MenuItem[] {
  const connected = snapshot.connection === "connected";
  const paused = snapshot.settings.paused;
  const age = status.confirmedAgeSeconds;
  const ageText = age !== null && age < 60 ? `${age}s ago` : `${Math.floor((age ?? 0) / 60)}m ago`;
  const updated = age === null ? "Status not confirmed yet" : status.fresh ? `Updated ${ageText}` : `Last confirmed ${ageText}`;
  const waiting = snapshot.replies ? snapshot.replies.pending.reduce((count, item) => count + item.pendingCount, 0) : 0;
  const ready = connected && Boolean(snapshot.messagingProviders?.length) && snapshot.contacts.length > 0;
  const top: MenuItem[] = [{ kind: "label", label: menuLabel(statusLine(snapshot, extras)) }];
  if (extras.failure) top.push({ kind: "label", label: menuLabel(`⚠︎ ${extras.failure.sentence}${extras.failure.detail ? ` · ${extras.failure.detail}` : ""}`, 160) });
  if (extras.pending) top.push({ kind: "action", id: "job.refresh", label: "↻ An action is still running · Check again" });
  else if (extras.lastOperation) top.push({ kind: "label", label: menuLabel(extras.lastOperation, 160) });
  top.push({ kind: "separator" });

  // Exactly one primary action for the state.
  if (!connected) top.push({ kind: "action", id: "daemon.install", label: "Start Textbutler at login" });
  else if (extras.access?.needs === "full-disk-access" || extras.access?.needs === "automation")
    top.push({ kind: "action", id: `settings.${extras.access.needs}`, label: extras.access.needs === "full-disk-access" ? "Open Full Disk Access settings…" : "Open Automation settings…" });
  else if (!ready) top.push({ kind: "action", id: "open-guide", label: "Get started ↗" });
  else top.push({ kind: "action", id: "replies.scan", label: waiting ? `Check for replies · ${waiting} waiting` : "Check for replies" });

  if (connected) {
    if (snapshot.replies && (snapshot.replies.pending.length || snapshot.replies.drafts.length))
      top.push({ kind: "submenu", label: "Replies waiting", items: replyItems(snapshot) });
    const candidates = extras.candidates;
    top.push({ kind: "submenu", label: "Conversations", items: [
      ...contactItems(snapshot),
      { kind: "separator" },
      ...(candidates ? [{ kind: "submenu" as const, label: "Add a conversation", items: [
        ...detailItems(candidates.detail),
        { kind: "label" as const, label: "Added with automatic replies off" },
        ...candidates.list.slice(0, 12).map(candidate => ({ kind: "action" as const, id: `contact.add:${candidate.id}`,
          label: menuLabel(candidate.eligible ? candidate.name : `${candidate.name} · ${candidate.reason}`, 48) || "Conversation", enabled: candidate.eligible })),
        ...(candidates.list.length > 12 ? [{ kind: "label" as const, label: "More in the guided terminal" }] : []),
      ] }] : []),
      { kind: "action", id: "contacts.discover", label: "Find conversations to add" },
      ...(snapshot.messagingProviders ?? []).map(provider => ({ kind: "action" as const, id: `messaging.start:${provider}`,
        label: provider === "beeper" ? "Connect Beeper" : provider === "imessage" ? "Connect iMessage" : "Start WhatsApp sync" })),
    ] });
    top.push({ kind: "separator" });
    top.push({ kind: "action", id: "toggle-pause", label: paused ? "Resume automatic replies" : "Pause automatic replies" });
  } else top.push({ kind: "action", id: "open-guide", label: "Get started ↗" });
  top.push({ kind: "separator" });
  top.push({ kind: "submenu", label: "Details", items: detailsItems(snapshot, updated) });
  top.push({ kind: "action", id: "product.support", label: "Help & support ↗" });
  top.push({ kind: "quit", label: "Quit Textbutler" });
  return boundedMenu(top);
}

/** The Textbutler menu companion is a disposable client of the owner daemon.
 * All state reads and mutations use the existing owner-only control socket;
 * the shared runner renders them and enforces revision-checked dispatch. */
export function companionOptions(dataDir: string, open: typeof openBrowser = openBrowser, entrypoint: string = fileURLToPath(new URL("cli.ts", import.meta.url)), options: { request?: OwnerControlClient; jobWaitMs?: number; now?: () => number; access?: () => Promise<MenuExtras["access"]>; openSettings?: (url: string) => Promise<boolean> } = {}): CompanionOptions {
  const request = options.request ?? ((value: ControlRequest) => requestDaemon({ dataDir, request: value }));
  let lastSnapshot: DesktopSnapshot | null = null;
  let confirmedAt: number | null = null;
  let candidates: readonly ConversationCandidate[] = [];
  let candidateRevision: number | null = null;
  let discoveryDetail = "";
  let pendingJobId: string | null = null;
  let lastOperationDetail: string | null = null;
  /** The last action that didn't work, shown as a ⚠︎ row (T6). */
  let failure: (ShownFailure & { at: number }) | null = null;
  const now = options.now ?? Date.now;
  /** Job-backed control calls resolve their stored result before returning. */
  const daemonJob = async (operation: ControlRequest): Promise<ControlResponse> => {
    if (pendingJobId !== null) throw new MenuFailure("previous-operation-pending", "Another action is still running", "Wait for it to finish, then try again.");
    const response = await awaitOwnerJob(operation, request, { waitMs: options.jobWaitMs ?? 90_000 });
    if (response.ok && response.kind === "job") pendingJobId = response.jobId;
    return response;
  };
  return {
    appId: "textbutler",
    name: "Textbutler",
    title: "\u{1f916}",
    icon: TRAY_ICON,
    tooltip: "Textbutler status and controls",
    stateDir: join(dataDir, "menubar"),
    refreshMs: 15_000,
    snapshot: async () => {
      let snapshot: DesktopSnapshot, fresh = false;
      try {
        const response = await request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
        if (!response.ok) {
          snapshot = disconnectedSnapshot(menuLabel(response.message, 180));
        } else if (response.kind !== "snapshot" || lastSnapshot !== null && response.snapshot.revision < lastSnapshot.revision) {
          // A late or replayed response must never undo a newer owner revision.
          snapshot = disconnectedSnapshot("The daemon returned unreadable status.");
        } else {
          snapshot = response.snapshot;
          lastSnapshot = snapshot;
          confirmedAt = Date.now();
          fresh = true;
        }
      } catch {
        snapshot = disconnectedSnapshot();
        lastSnapshot = null;
      }
      if (failure !== null && now() - failure.at >= ACTION_ERROR_MS) failure = null;
      const access = await (options.access ?? (() => accessNeed(dataDir, snapshot)))().catch(() => undefined);
      return snapshotItems(snapshot, { confirmedAgeSeconds: confirmedAt === null ? null : Math.max(0, Math.floor((Date.now() - confirmedAt) / 1000)), fresh }, {
        access, failure: failure ?? undefined, pending: pendingJobId !== null, lastOperation: lastOperationDetail,
        candidates: candidateRevision !== null && candidateRevision === snapshot.revision ? { detail: discoveryDetail, list: candidates } : undefined,
      });
    },
    onAction: async (id, signal) => {
      try {
        await act(id, signal);
        failure = null;
      } catch (error) {
        const shown = describeMenuFailure(error);
        failure = shown === null ? null : { ...shown, at: now() };
        throw error;
      }
    },
  };

  async function act(id: string, _signal: AbortSignal): Promise<void> {
      if (id === "job.refresh" && pendingJobId) {
        const response = await request({ protocol: CONTROL_PROTOCOL, command: "owner.job.read", jobId: pendingJobId });
        if (response.ok && response.kind === "job" || !response.ok && response.code === "disconnected") throw new MenuPending("operation-not-yet-confirmed");
        pendingJobId = null;
        if (!response.ok) { lastOperationDetail = `⚠︎ The last action didn't finish · ${daemonDetail(response.message) ?? "Check its result before you repeat it."}`; return; }
        if (response.kind === "conversations") { candidates = response.candidates; candidateRevision = lastSnapshot?.revision ?? null; discoveryDetail = response.detail; }
        if (response.kind === "snapshot" || response.kind === "enrolled") { lastSnapshot = response.snapshot; candidates = []; candidateRevision = null; }
        lastOperationDetail = response.kind === "reply-sent" ? `✓ Reply ${response.state} · ${daemonDetail(response.detail) ?? ""}`.replace(/ · $/u, "") : "✓ The last action finished";
        return;
      }
      if (id === "open-guide" || id === "setup-guide") { await opened(open("https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md")); return; }
      if (id === "daemon.install") {
        try { await createLaunchAgentLifecycle(defaultLaunchAgentHost(entrypoint)).install(dataDir); }
        catch { throw new MenuFailure("daemon-install-failed", "Couldn't start the background service", "Setup & readiness in the guided terminal shows why."); }
        return;
      }
      if (id === "contacts.discover") {
        const response = await daemonJob({ protocol: CONTROL_PROTOCOL, command: "conversations.list" });
        if (!response.ok || response.kind !== "conversations") throw unconfirmed(response, "conversation-discovery-unconfirmed", "Couldn't find conversations");
        candidates = response.candidates; candidateRevision = lastSnapshot?.revision ?? null; discoveryDetail = response.detail;
        return;
      }
      if (id.startsWith("messaging.start:")) {
        const provider = id.slice(16);
        if (provider !== "imessage" && provider !== "whatsapp" && provider !== "beeper" || !lastSnapshot?.messagingProviders?.includes(provider)) return;
        const response = await daemonJob({ protocol: CONTROL_PROTOCOL, command: "messaging.start", provider });
        if (!response.ok || response.kind === "job") throw unconfirmed(response, "messaging-connection-unconfirmed", `Couldn't connect ${appName(provider)}`);
        return;
      }
      if (id.startsWith("contact.add:")) {
        const candidate = candidates.find(candidate => candidate.id === id.slice(12));
        if (!candidate?.eligible || !lastSnapshot || candidateRevision !== lastSnapshot.revision) throw new MenuFailure("refresh-conversation-selection", "The conversation list changed", "Find conversations again, then add the one you want.");
        const response = await daemonJob({ protocol: CONTROL_PROTOCOL, command: "contact.enroll", candidateId: candidate.id,
          expectedRevision: lastSnapshot.revision, initializeHistory: false });
        candidates = []; candidateRevision = null;
        if (!response.ok || response.kind !== "enrolled") throw unconfirmed(response, "contact-enrollment-unconfirmed", "Couldn't add the conversation");
        return;
      }
      if (id.startsWith("contact.toggle:") || id.startsWith("contact.account:")) {
        const snapshot = lastSnapshot;
        if (!snapshot) return;
        const contact = snapshot.contacts.find(contact => id === `contact.toggle:${contact.id}` ||
          snapshot.providerAccounts?.some(account => id === `contact.account:${contact.id}:${account.id}`));
        if (!contact) return;
        const account = snapshot.providerAccounts?.find(account => id === `contact.account:${contact.id}:${account.id}`);
        if (account && (contact.settings.enabled || account.status !== "ready")) return;
        const settings = account ? { ...contact.settings, accountId: account.id, provider: account.provider }
          : { ...contact.settings, enabled: !contact.settings.enabled };
        const response = await daemonJob({ protocol: CONTROL_PROTOCOL, command: "contact.settings.update", contactId: contact.id,
          expectedRevision: snapshot.revision, settings });
        if (!response.ok || response.kind === "job") throw unconfirmed(response, "contact-settings-unconfirmed", account ? "Couldn't change the agent account" : settings.enabled ? "Couldn't turn on automatic replies" : "Couldn't turn off automatic replies");
        return;
      }
      if (id === "open-website") { await opened(open(WEBSITE)); return; }
      if (id === "settings.full-disk-access" || id === "settings.automation") {
        const url = settingsUrl(id === "settings.automation" ? "automation" : "full-disk-access");
        if (!await (options.openSettings ?? terminalPromptIO().openUrl)(url).catch(() => false))
          throw new MenuFailure("settings-open-failed", "Couldn't open System Settings", `Open ${settingsPath(id === "settings.automation" ? "automation" : "full-disk-access")} yourself.`);
        return;
      }
      if (id === "product.support") { await opened(open(SUPPORT)); return; }
      if (id === "refresh") return; // the runner re-reads state after every action
      if (id === "replies.scan") {
        const response = await daemonJob({ protocol: CONTROL_PROTOCOL, command: "replies.scan" });
        if (!response.ok || response.kind === "job") throw unconfirmed(response, "replies-scan-unconfirmed", "Couldn't check for replies");
        return;
      }
      if (id.startsWith("replies.suggest:")) {
        const response = await daemonJob({ protocol: CONTROL_PROTOCOL, command: "replies.suggest", contactId: id.slice(16) });
        if (!response.ok || response.kind === "job") throw unconfirmed(response, "replies-suggest-unconfirmed", "Couldn't suggest a reply");
        return;
      }
      // The menu exposes previews only. Full ordered actions and their digest
      // are reviewed in the TUI/CLI before a draft can be sent.
      if (id.startsWith("replies.send:")) throw new MenuFailure("full-draft-review-required", "Review this reply in the terminal first", "The guided terminal shows every action before anything is sent.");
      if (id.startsWith("replies.discard:")) {
        const response = await request({ protocol: CONTROL_PROTOCOL, command: "replies.discard", draftId: id.slice(16) });
        if (!response.ok) throw new MenuFailure(`replies-discard-${response.code}`, "Couldn't discard the suggestion", daemonDetail(response.message));
        return;
      }
      if (id === "toggle-pause") {
        const current = lastSnapshot;
        if (!current || current.connection !== "connected") return;
        const response = await request({
            protocol: CONTROL_PROTOCOL, command: "global.settings.update",
            expectedRevision: current.revision,
            settings: { paused: !current.settings.paused, activeContactLimit: current.settings.activeContactLimit },
        });
        // The runner re-reads state after this callback; a daemon rejection or
        // indeterminate mutation is observed there, never retried here.
        if (!response.ok) throw new MenuFailure(`settings-update-${response.code}`, current.settings.paused ? "Couldn't resume automatic replies" : "Couldn't pause automatic replies", daemonDetail(response.message));
      }
  }
}

/** What macOS access iMessage still needs, from Textbutler's own records only. */
async function accessNeed(dataDir: string, snapshot: DesktopSnapshot): Promise<MenuExtras["access"]> {
  if (snapshot.connection !== "connected" || !snapshot.messagingProviders?.includes("imessage")) return undefined;
  const step = await macosAccessStep({ dataDir, imessageConfigured: true });
  if (step === undefined || step.status === "done") return undefined;
  if (step.command === "textbutler help permissions") return { needs: "app" };
  if (step.settingsUrl === settingsUrl("automation")) return { needs: "automation" };
  return step.settingsUrl === settingsUrl("full-disk-access") ? { needs: "full-disk-access" } : undefined;
}

const appName = (provider: string): string => provider === "imessage" ? "iMessage" : provider === "whatsapp" ? "WhatsApp" : "Beeper";

/** A job-backed call that didn't confirm. A job that is still running shows
 * the pending row instead of a ⚠︎ row. */
function unconfirmed(response: ControlResponse, code: string, sentence: string): Error {
  if (response.ok && response.kind === "job") return new MenuPending(code);
  return new MenuFailure(code, sentence, response.ok ? undefined : daemonDetail(response.message));
}

async function opened(result: Promise<unknown>): Promise<void> {
  try { await result; }
  catch { throw new MenuFailure("open-failed", "Couldn't open the page", "Check your default browser, then try again."); }
}

/** Delegate the product `menubar` command family to the shared lifecycle. */
export function companionForeground(dataDir: string, entrypoint: string, host: { home: string; runtime: string } = { home: homedir(), runtime: process.execPath }): { executable: string; args: readonly string[] } {
  return isolatedBunInvocation({ ...host, entrypoint, args: ["menubar", "--foreground", "--data-dir", dataDir] });
}
export async function runMenuBarCommand(args: readonly string[], dataDir: string, entrypoint: string, write: (result: unknown) => void,
  hooks: { handle?: typeof handleCompanionCommand; exit?: (code: number) => void } = {}): Promise<number> {
  const code = await (hooks.handle ?? handleCompanionCommand)(companionOptions(dataDir, openBrowser, entrypoint), {
    args,
    foreground: companionForeground(dataDir, entrypoint),
    write,
  });
  if (args[0] === "--foreground") exitSoon(code, hooks.exit ?? (value => process.exit(value)));
  return code;
}

/** Quit Textbutler ends the menu process. Once the menu has closed, an action
 * that is still waiting on the daemon (up to 90 seconds) must not keep it
 * alive: the daemon keeps the job, and the next menu reads its result. The
 * timer never holds the process open by itself. */
export function exitSoon(code: number, exit: (code: number) => void, delayMs = 1_000): void {
  const timer = setTimeout(() => exit(code), delayMs);
  (timer as { unref?: () => void }).unref?.();
}
