/** The shared hraness command grammar (desktop-foundation 0.9 registry):
 * `status`, `commands`, `tui`, `doctor`, `control …`, `approvals …` and
 * `permissions …`, each answering in the shared envelope with `--json`.
 *
 * TextButler's owner is the existing daemon on `daemon.sock` (one owner-only
 * socket through @hraness/local-custody). Op classes and human gates are
 * enforced here, in the CLI, before any request reaches that socket; there is
 * no separate agent socket (docs/cli-parity.md).
 *
 * Every other TextButler verb keeps its name and behaviour and is listed in
 * the registry with its op class, so `textbutler commands --json` describes the
 * whole CLI. Verbs that already let an agent loosen or send (`replies send`,
 * `contacts enable`, `resume`, …) are `decide-legacy`: they keep today's
 * digest- and revision-bound behaviour until the owner decides otherwise. */
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  defineRegistry, HranessError, okEnvelope, runCli, type CliIO, type Envelope, type ParsedArgs, type Registry, type Verb,
} from "@hraness/desktop-foundation/registry";
import { box, chooseMode, clean, renderSnapshot, runTui, table, type View } from "@hraness/desktop-foundation/tui";
import type { Contact, ControlRequest, ControlResponse, DesktopSnapshot, ReplyDraftDetail } from "../../control/src/index.ts";
import { TEXTBUTLER_CONTROL_PROTOCOL } from "./control-service.ts";
import type { LaunchAgentLifecycle, LaunchAgentStatus } from "./launch-agent.ts";
import type { Readiness } from "./onboarding.ts";
import { OwnerCliError, resolveOwnerContact } from "./owner-cli.ts";

export const PRODUCT = "textbutler";
/** First words that the shared grammar owns. Everything else is a product verb. */
export const GRAMMAR_FAMILIES: ReadonlySet<string> = new Set(["commands", "status", "tui", "doctor", "control", "approvals", "permissions"]);
/** The login item the retired menu companion used; doctor reports it read-only. */
export const LEGACY_MENU_LOGIN_ITEM = "app.hraness.companion.textbutler";

export interface GrammarDeps {
  request(request: ControlRequest): Promise<ControlResponse>;
  /** Sends one request and waits for a job it starts (bounded), like the product CLI. */
  awaitJob(request: ControlRequest): Promise<ControlResponse>;
  launchAgent(): LaunchAgentLifecycle;
  dataDir: string;
  readiness(): Promise<Readiness>;
  readinessText(value: Readiness): string;
  /** Runs the owner in this process until it is stopped; returns the exit status. */
  serve(): Promise<number>;
  /** The guided terminal for a person at a TTY. */
  interactiveTui(): Promise<number>;
  stdoutIsTerminal: boolean;
  home?: string;
  now?: () => Date;
}

// ── Status: the one-screen health that `tui` renders ─────────────────────────
export interface StatusData {
  owner: { state: "running" | "stopped"; detail: string };
  automaticReplies: "running" | "paused" | "unavailable";
  paused: boolean | null;
  messaging: readonly string[];
  contacts: readonly { id: string; name: string; replies: "on" | "off"; mode: "smart" | "keyword"; provider: string; account: string | null }[];
  waiting: readonly { contactId: string; name: string; pending: number; sendable: boolean }[];
  approvals: readonly ApprovalSummary[];
  accounts: readonly { id: string; label: string; provider: string; status: string }[];
  activity: readonly { at: string; title: string; detail: string }[];
}
export interface ApprovalSummary { id: string; contactId: string; name: string; summary: string; actions: number; expiresAt: string }

export function statusFromSnapshot(snapshot: DesktopSnapshot | null, ownerDetail = "The background service isn't running."): StatusData {
  if (snapshot === null) {
    return { owner: { state: "stopped", detail: ownerDetail }, automaticReplies: "unavailable", paused: null, messaging: [], contacts: [], waiting: [], approvals: [], accounts: [], activity: [] };
  }
  return {
    owner: { state: "running", detail: snapshot.detail },
    automaticReplies: snapshot.automation?.state ?? "unavailable",
    paused: snapshot.settings.paused,
    messaging: [...snapshot.messagingProviders ?? []],
    contacts: snapshot.contacts.map(contact => ({ id: contact.id, name: contact.name, replies: contact.settings.enabled ? "on" : "off",
      mode: contact.settings.responseMode, provider: contact.settings.provider, account: contact.settings.accountId ?? null })),
    waiting: (snapshot.replies?.pending ?? []).map(item => ({ contactId: item.contactId, name: item.name, pending: item.pendingCount, sendable: item.sendable })),
    approvals: (snapshot.replies?.drafts ?? []).map(draft => ({ id: draft.id, contactId: draft.contactId, name: draft.name, summary: draft.summary, actions: draft.actionCount, expiresAt: draft.expiresAt })),
    accounts: (snapshot.providerAccounts ?? []).map(account => ({ id: account.id, label: account.label, provider: account.provider, status: account.status })),
    activity: snapshot.activity.slice(0, 5).map(event => ({ at: event.at, title: event.title, detail: event.detail })),
  };
}

const APP_NAMES: Readonly<Record<string, string>> = { imessage: "iMessage", whatsapp: "WhatsApp", beeper: "Beeper" };
const cut = (text: string, limit: number): string => { const value = clean(text).replace(/\s+/gu, " ").trim(); return value.length > limit ? `${value.slice(0, limit - 1)}…` : value; };

/** Views shared by `tui --snapshot`, the plain `status` text and the goldens. */
export const STATUS_VIEWS: readonly View<StatusData>[] = [
  { id: "status", title: "Status", render: (state, width) => box("TextButler", [
    `Service: ${state.owner.state === "running" ? "running" : "stopped"}`,
    `Automatic replies: ${state.automaticReplies}`,
    `Messaging: ${state.messaging.length ? state.messaging.map(app => APP_NAMES[app] ?? app).join(", ") : "none connected"}`,
    `Chats: ${state.contacts.length} added, ${state.contacts.filter(contact => contact.replies === "on").length} answering`,
    `Waiting: ${state.waiting.reduce((sum, item) => sum + item.pending, 0)} messages, ${state.approvals.length} suggestions`,
    ...state.owner.state === "stopped" ? [`Next: textbutler control serve (or daemon install)`] : [],
  ], width) },
  { id: "contacts", title: "Chats", render: (state, width) => state.contacts.length
    ? table(["Chat", "Replies", "Mode", "Account"], state.contacts.map(contact => [cut(contact.name, Math.max(8, Math.min(32, width - 30))), contact.replies, contact.mode, contact.account ?? "-"]), width)
    : ["No chats added. Add one: textbutler conversations list"] },
  { id: "approvals", title: "Suggestions", render: (state, width) => state.approvals.length
    ? table(["Id", "Chat", "Expires", "Summary"], state.approvals.map(draft => [draft.id, cut(draft.name, Math.max(8, Math.min(24, width - 40))), draft.expiresAt.slice(0, 16).replace("T", " "), cut(draft.summary, 80)]), width)
    : ["No suggestions waiting."] },
  { id: "accounts", title: "AI accounts", render: (state, width) => state.accounts.length
    ? table(["Account", "AI", "Status"], state.accounts.map(account => [cut(account.label, 32), account.provider, account.status]), width)
    : ["No AI accounts yet."] },
  { id: "activity", title: "Recent activity", render: (state, width) => state.activity.length
    ? table(["When", "What"], state.activity.map(event => [event.at.slice(0, 16).replace("T", " "), cut(`${event.title}: ${event.detail}`, 120)]), width)
    : ["Nothing yet."] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
const ownerUnavailable = (): HranessError => new HranessError("owner-unavailable", "The TextButler background service isn't running.", undefined,
  [{ command: "textbutler control serve", why: "Start the service in a terminal", audience: "human" }, { command: "textbutler control status --json", why: "Check the service", audience: "agent" }]);

/** One owner request; transport and owner failures become shared error codes. */
async function ask(deps: GrammarDeps, request: ControlRequest): Promise<Exclude<ControlResponse, { ok: false }>> {
  let response: ControlResponse;
  try { response = await deps.request(request); } catch { throw ownerUnavailable(); }
  if (response.ok) return response;
  if (response.code === "disconnected" || response.code === "unavailable") throw new HranessError("owner-unavailable", response.message);
  if (response.code === "conflict") throw new HranessError("conflict", response.message, undefined, [{ command: "textbutler status --json", why: "Read the current revision", audience: "agent" }]);
  throw new HranessError(`textbutler.${response.code}`, response.message);
}
/** True when the socket is missing or refuses connections: no owner is listening. */
export function socketAbsent(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ECONNREFUSED" || error.message === "The control socket is unavailable.";
}
async function snapshotOrNull(deps: GrammarDeps): Promise<DesktopSnapshot | null> {
  try { const response = await deps.request({ protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "snapshot" }); return response.ok && response.kind === "snapshot" ? response.snapshot : null; }
  catch { return null; }
}
async function snapshot(deps: GrammarDeps): Promise<DesktopSnapshot> {
  const response = await ask(deps, { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "snapshot" });
  if (response.kind !== "snapshot") throw new HranessError("internal", "The service answered with an unexpected shape.");
  return response.snapshot;
}
function one(args: ParsedArgs, name: string): string {
  if (args.positionals.length !== 1 || !args.positionals[0]) throw new HranessError("usage", `Name one ${name}.`);
  return args.positionals[0];
}
function none(args: ParsedArgs): void { if (args.positionals.length) throw new HranessError("usage", `Unexpected argument ${JSON.stringify(args.positionals[0])}.`); }
function contactFor(state: DesktopSnapshot, name: string): Contact {
  try { return resolveOwnerContact(state, name); }
  catch (error) { throw new HranessError("not-found", error instanceof OwnerCliError ? error.message : "No such contact."); }
}
export const digestOf = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const loginState = (status: LaunchAgentStatus): { installation: LaunchAgentStatus["installation"]; service: LaunchAgentStatus["service"]; detail: string } =>
  ({ installation: status.installation, service: status.service, detail: status.detail });

/** A product verb that the existing CLI still runs; listed here for `commands --json`. */
function productVerb(path: string, opClass: "read" | "operate" | "decide-legacy", summary: string): Verb<null, unknown> {
  return { path: path.split(" "), opClass, schema: `textbutler.${path.split(" ")[0]}/1`, summary,
    input: () => null, run: () => Promise.reject(new HranessError("internal", "This verb runs through the TextButler CLI.")) };
}
/** Existing verbs, their op classes and one-line summaries (docs/cli-parity.md). */
export const PRODUCT_VERBS: readonly Verb<null, unknown>[] = [
  productVerb("setup", "operate", "Create private settings (paused) or add a connection"),
  productVerb("init", "operate", "Create private settings without the checklist"),
  productVerb("pause", "operate", "Pause automatic replies for every chat"),
  productVerb("resume", "decide-legacy", "Resume automatic replies (chats that are off stay off)"),
  productVerb("inbox", "read", "List chats waiting for your reply"),
  productVerb("replies suggest", "decide-legacy", "Write a reply suggestion (spends model credits); never sends"),
  productVerb("replies show", "read", "Show every action and the digest of a suggestion"),
  productVerb("replies send", "decide-legacy", "Send a reviewed suggestion by digest, or your own text"),
  productVerb("replies discard", "operate", "Throw a suggestion away"),
  productVerb("replies reconcile", "operate", "Record whether an uncertain send arrived"),
  productVerb("conversations list", "read", "List recent one-to-one chats you can add"),
  productVerb("contacts list", "read", "Show added chats and their settings"),
  productVerb("contacts add", "operate", "Add a chat with automatic replies off"),
  productVerb("contacts enable", "decide-legacy", "Turn on automatic replies for a chat"),
  productVerb("contacts disable", "operate", "Turn off automatic replies and remove send access"),
  productVerb("contacts account", "operate", "Choose the AI account for a chat"),
  productVerb("contacts mode", "decide-legacy", "Answer everything (smart) or only on a keyword"),
  productVerb("contacts self", "operate", "Mark a chat with yourself"),
  productVerb("contacts label", "operate", "Rename a chat"),
  productVerb("messaging list", "read", "Show configured messaging apps"),
  productVerb("messaging start", "decide-legacy", "Connect iMessage, WhatsApp or Beeper"),
  productVerb("providers gateway-key", "decide-legacy", "Save a Vercel AI Gateway key from a pipe"),
  productVerb("providers local", "operate", "Write replies with a model on this Mac"),
  productVerb("providers list", "read", "Show connected AI accounts"),
  productVerb("providers check", "read", "Check that one AI account is ready"),
  productVerb("daemon status", "read", "Show whether the service is running"),
  productVerb("daemon run", "operate", "Run the service in this terminal (same as control serve)"),
  productVerb("jobs show", "read", "Read the result of a long operation"),
  productVerb("habitats show", "read", "Show a chat's reply style, memory and budget"),
  productVerb("habitats configure", "operate", "Replace a chat's habitat (replies paused)"),
  productVerb("habitats rollback", "operate", "Go back to an earlier habitat revision"),
  productVerb("habitats memory-clear", "operate", "Forget a chat's learned excerpts"),
  productVerb("habitats task-stage", "operate", "Stage a shadow task (replies paused)"),
  productVerb("habitats task-rollback", "operate", "Roll back a shadow task"),
  productVerb("messages history", "read", "Read one chat's recent messages"),
  productVerb("messages summarize", "decide-legacy", "Summarize one chat (spends model credits)"),
  productVerb("messages capabilities", "read", "Show what a chat can send"),
  productVerb("messages compose", "operate", "Draft a reply from text or actions"),
  productVerb("messages react", "operate", "Draft a reaction"),
  productVerb("messages attach", "operate", "Draft an attachment"),
  productVerb("messages send", "decide-legacy", "Send your own text in a chat"),
  productVerb("campaign run", "decide-legacy", "Send your own texts at a slow pace"),
  productVerb("campaign status", "read", "Show a campaign's progress"),
  productVerb("support", "read", "See optional ways to support TextButler"),
];

// ── The registry ─────────────────────────────────────────────────────────────
export function textbutlerRegistry(deps: GrammarDeps): Registry {
  const status = async (): Promise<StatusData> => statusFromSnapshot(await snapshotOrNull(deps));
  const statusEnvelope = async (): Promise<Envelope<StatusData>> => okEnvelope("textbutler.status/1", await status(), undefined, deps.now?.());

  const verbs: Verb<any, any>[] = [
    { path: ["status"], opClass: "read", schema: "textbutler.status/1", summary: "One-screen health: service, chats, suggestions, accounts",
      input: none, run: status, text: state => renderSnapshot(STATUS_VIEWS.slice(0, 1), state).trimEnd() },
    { path: ["tui"], opClass: "read", schema: "textbutler.status/1", summary: "Guided terminal; --snapshot or --json print the views without a terminal",
      flags: ["snapshot"], valueFlags: ["width"], output: "raw",
      input: (args: ParsedArgs) => {
        none(args);
        const width = args.flags.width === undefined ? undefined : Number(args.flags.width);
        if (width !== undefined && (!Number.isSafeInteger(width) || width < 20 || width > 400)) throw new HranessError("usage", "--width takes a number from 20 to 400.");
        return { snapshot: args.flags.snapshot === true, width };
      },
      run: async (input: { snapshot: boolean; width: number | undefined }, ctx) => {
        const mode = chooseMode(ctx.json, input.snapshot, deps.stdoutIsTerminal);
        if (mode === "interactive" && input.width === undefined) return await deps.interactiveTui();
        return await runTui({ load: statusEnvelope, views: STATUS_VIEWS, mode: mode === "interactive" ? "snapshot" : mode,
          ...(input.width === undefined ? {} : { width: input.width }), io: { stdout: ctx.io.stdout } });
      } },
    { path: ["doctor"], opClass: "read", schema: "textbutler.readiness/1", summary: "Check setup, macOS access, the service and legacy login items",
      output: "raw", input: none,
      run: async (_input, ctx) => {
        const value = await deps.readiness();
        const legacy = await legacyLoginItems(deps.home ?? homedir());
        if (ctx.json) {
          const { snapshot: _snapshot, dataDir: _dataDir, ...report } = value;
          // doctor is a read verb: it answered, so the envelope is ok and the
          // exit is 0. Readiness itself is data.ok, with the next step to run.
          const next = value.ok ? [] : value.steps.filter(step => (step.status === "action-needed" || step.status === "blocked") && step.command).slice(0, 1)
            .map(step => ({ command: step.command!, why: step.title, audience: "human" as const }));
          ctx.io.stdout.write(`${JSON.stringify(okEnvelope("textbutler.readiness/1", { ...report, legacyLoginItems: legacy }, next, deps.now?.()))}\n`);
          return 0;
        } else {
          // Plain text keeps the old exit: 1 until setup is done (cli-parity.md).
          ctx.io.stdout.write(deps.readinessText(value));
          if (legacy.length) ctx.io.stdout.write(`\nAn old menu login item is still present. Reinstall with bun run textbutler:install to retire it.\n`);
        }
        return value.ok ? 0 : 1;
      } },
    { path: ["control", "serve"], opClass: "operate", schema: "textbutler.control/1", summary: "Run the background service in this terminal until control stop",
      flags: ["foreground"], output: "raw", input: none,
      run: async () => {
        // A live owner answers on the socket; custody refuses a second one.
        if (await snapshotOrNull(deps)) throw new HranessError("control-already-running", "The TextButler service is already running. Nothing changed.", undefined, [{ command: "textbutler control status --json", why: "Check the service", audience: "agent" }]);
        try { return await deps.serve(); }
        catch (error) {
          if (error instanceof Error && /already exists|still active/u.test(error.message)) throw new HranessError("control-already-running", "Another TextButler service owns this data folder. Nothing changed.");
          throw error;
        }
      } },
    { path: ["control", "status"], opClass: "read", schema: "textbutler.control/1", summary: "Show whether the service is running and whether it starts at login",
      input: none,
      run: async () => {
        const [state, login] = await Promise.all([snapshotOrNull(deps), deps.launchAgent().status(deps.dataDir).catch(() => null)]);
        return { state: state ? "running" : "stopped", automaticReplies: state?.automation?.state ?? "unavailable", loginItem: login ? loginState(login) : null };
      },
      text: (value: { state: string; loginItem: { installation: string } | null }) => `Service: ${value.state}\nStarts at login: ${value.loginItem?.installation === "installed" ? "yes" : "no"}` },
    { path: ["control", "stop"], opClass: "operate", schema: "textbutler.control/1", summary: "Ask the running service to finish and exit; never signals a process",
      input: none,
      run: async () => {
        let response: ControlResponse;
        try { response = await deps.request({ protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "owner.stop" }); }
        catch (error) {
          // Only a missing or refused socket means nothing is running; a timeout
          // or permission problem leaves the service's state unknown.
          if (socketAbsent(error)) return { state: "not-running" };
          throw new HranessError("owner-unavailable", "Couldn't reach the TextButler service, so it may still be running.", undefined,
            [{ command: "textbutler control status --json", why: "Check the service", audience: "agent" }]);
        }
        if (response.ok && response.kind === "stopping") return { state: "stopping" };
        throw new HranessError("owner-unavailable", response.ok ? "The service answered with an unexpected shape." : response.message);
      },
      text: (value: { state: string }) => value.state === "stopping" ? "The service is stopping. A login item starts it again at the next login." : "The service isn't running." },
  ];
  // `daemon install|uninstall` are the older names for the same login-item
  // change. They run through the same person-only gate, so the older name is
  // never a way around `control install` (docs/textbutler/cli-parity.md).
  for (const [family, action] of [["control", "install"], ["control", "uninstall"], ["daemon", "install"], ["daemon", "uninstall"]] as const) {
    verbs.push({ path: [family, action], opClass: "decide", schema: "textbutler.control/1",
      summary: family === "daemon"
        ? action === "install" ? "Start the service now and at login (same as control install)" : "Stop the service and remove it from login (same as control uninstall)"
        : action === "install" ? "Start the service at login (a persistent login item)" : "Stop the service and remove its login item",
      input: none,
      gate: { tier: "T1T2", describe: () => ({ title: action === "install" ? "Start TextButler at login" : "Remove TextButler from login", digest: digestOf({ verb: `control ${action}`, label: "textbutler" }) }) },
      run: async () => {
        const lifecycle = deps.launchAgent();
        const login = action === "install" ? await lifecycle.install(deps.dataDir) : await lifecycle.uninstall(deps.dataDir);
        const want = action === "install" ? "installed" : "absent";
        if (login.installation !== want) throw new HranessError("textbutler.login-item", login.detail);
        return { loginItem: loginState(login) };
      },
      text: () => action === "install" ? "TextButler starts at login." : "TextButler no longer starts at login." });
  }
  verbs.push(
    { path: ["approvals", "list"], opClass: "read", schema: "textbutler.approvals/1", summary: "List reply suggestions waiting for a decision",
      input: none, run: async () => ({ approvals: statusFromSnapshot(await snapshot(deps)).approvals }),
      text: (value: { approvals: StatusData["approvals"] }) => value.approvals.length ? value.approvals.map(draft => `${draft.id}  ${cut(draft.name, 24)}  ${cut(draft.summary, 60)}`).join("\n") : "No suggestions waiting." },
    { path: ["approvals", "show"], opClass: "read", schema: "textbutler.approval/1", summary: "Show every action in a suggestion and the digest to decide it",
      usage: "<id>", input: (args: ParsedArgs) => one(args, "suggestion id"),
      run: async (draftId: string) => {
        const response = await ask(deps, { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "replies.draft.read", draftId });
        if (response.kind !== "reply-draft") throw new HranessError("internal", "The service answered with an unexpected shape.");
        return { approval: response.draft };
      },
      text: (value: { approval: ReplyDraftDetail }) => `${value.approval.name}: ${value.approval.summary}\n${value.approval.actions.length} action(s), expires ${value.approval.expiresAt}\nDigest: ${value.approval.digest}` },
    { path: ["approvals", "decide"], opClass: "decide", schema: "textbutler.approval/1",
      summary: "Send a reviewed suggestion exactly as shown (allow-once), or discard it (deny)",
      usage: "<id> --digest <digest> <allow-once|deny>", valueFlags: ["digest"],
      input: (args: ParsedArgs) => {
        const [draftId, decision, ...rest] = args.positionals;
        if (!draftId || rest.length || decision !== "allow-once" && decision !== "deny") throw new HranessError("usage", "Use approvals decide <id> --digest <digest> allow-once|deny.");
        if (typeof args.flags.digest !== "string" || !/^[0-9a-f]{64}$/u.test(args.flags.digest)) throw new HranessError("usage", "--digest takes the 64-character digest that approvals show prints.");
        return { draftId, decision, digest: args.flags.digest };
      },
      operateWhen: { summary: "deny discards the suggestion and needs no person", test: (input: { decision: string }) => input.decision === "deny" },
      gate: { tier: "T1T2", describe: (input: { draftId: string; digest: string }) => ({ title: `Send suggestion ${input.draftId}`, digest: input.digest }) },
      run: async (input: { draftId: string; decision: "allow-once" | "deny"; digest: string }) => {
        const detail = await ask(deps, { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "replies.draft.read", draftId: input.draftId }).catch((error: unknown) => {
          if (error instanceof HranessError && error.code === "textbutler.invalid-request") throw new HranessError("not-found", error.message);
          throw error;
        });
        if (detail.kind !== "reply-draft") throw new HranessError("internal", "The service answered with an unexpected shape.");
        if (detail.draft.digest !== input.digest) throw new HranessError("digest-mismatch", "This suggestion changed since you reviewed it. Nothing was sent.", undefined, [{ command: `textbutler approvals show ${input.draftId}`, why: "Review it again", audience: "agent" }]);
        if (input.decision === "deny") {
          const response = await ask(deps, { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "replies.discard", draftId: input.draftId });
          return { decision: "deny", discarded: response.kind === "reply-discarded" && response.discarded };
        }
        // After the send request leaves, a lost answer is an unknown outcome,
        // never "not running": repeating it could send twice.
        let sent: ControlResponse;
        try { sent = await deps.awaitJob({ protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "replies.send", draftId: input.draftId, expectedDigest: input.digest }); }
        catch {
          throw new HranessError("textbutler.indeterminate", "The send request left but no answer came back. Don't repeat it; check whether it arrived.", undefined,
            [{ command: "textbutler inbox --json", why: "See whether the chat still waits", audience: "agent" }, { command: "textbutler replies reconcile --help", why: "Record whether it arrived", audience: "human" }]);
        }
        if (!sent.ok) throw new HranessError(`textbutler.${sent.code}`, sent.message);
        const response = sent;
        if (response.kind === "job") return { decision: "allow-once", state: "pending", jobId: response.jobId, nextCommand: ["textbutler", "jobs", "show", response.jobId] };
        if (response.kind !== "reply-sent") throw new HranessError("internal", "The service answered with an unexpected shape.");
        return { decision: "allow-once", state: response.state, detail: response.detail };
      },
      text: (value: { decision: string; state?: string; detail?: string }) => value.decision === "deny" ? "Suggestion discarded." : value.detail ?? `Send ${value.state}.` },
    { path: ["permissions", "list"], opClass: "read", schema: "textbutler.permissions/1", summary: "Show which chats may get automatic replies",
      input: none,
      run: async () => {
        const state = await snapshot(deps);
        return { revision: state.revision, paused: state.settings.paused,
          permissions: state.contacts.map(contact => ({ contactId: contact.id, name: contact.name, automaticReplies: contact.settings.enabled ? "on" : "off", mode: contact.settings.responseMode })) };
      },
      text: (value: { paused: boolean; permissions: { name: string; automaticReplies: string; mode: string }[] }) => [`Automatic replies ${value.paused ? "paused" : "not paused"}`,
        ...value.permissions.map(item => `${cut(item.name, 32)}: ${item.automaticReplies} (${item.mode})`)].join("\n") },
    { path: ["permissions", "set"], opClass: "decide", schema: "textbutler.permissions/1",
      summary: "Turn one chat's automatic replies on (loosen) or off (tighten)",
      usage: "<contact> --expected-revision <n> <tighten|loosen>", valueFlags: ["expected-revision"],
      input: (args: ParsedArgs) => {
        const [contact, change, ...rest] = args.positionals;
        if (!contact || rest.length || change !== "tighten" && change !== "loosen") throw new HranessError("usage", "Use permissions set <contact> --expected-revision <n> tighten|loosen.");
        const revision = Number(args.flags["expected-revision"]);
        if (typeof args.flags["expected-revision"] !== "string" || !Number.isSafeInteger(revision) || revision < 0) throw new HranessError("usage", "--expected-revision takes the revision that permissions list prints.");
        return { contact, change, revision };
      },
      operateWhen: { summary: "tighten turns replies off and needs no person", test: (input: { change: string }) => input.change === "tighten" },
      gate: { tier: "T1T2", describe: (input: { contact: string; revision: number }) => ({ title: `Turn on automatic replies for ${input.contact}`, digest: digestOf({ verb: "permissions set", contact: input.contact, revision: input.revision, change: "loosen" }) }) },
      run: async (input: { contact: string; change: "tighten" | "loosen"; revision: number }) => {
        const state = await snapshot(deps);
        const contact = contactFor(state, input.contact);
        if (state.revision !== input.revision) throw new HranessError("conflict", "Settings changed since you read them. Nothing changed.", undefined, [{ command: "textbutler permissions list --json", why: "Read the current revision", audience: "agent" }]);
        const request: ControlRequest = { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "contact.settings.update", contactId: contact.id, expectedRevision: input.revision,
          settings: { ...contact.settings, enabled: input.change === "loosen" } };
        let response: ControlResponse;
        try { response = await deps.awaitJob(request); } catch { throw ownerUnavailable(); }
        if (!response.ok) {
          if (response.code === "conflict") throw new HranessError("conflict", response.message, undefined, [{ command: "textbutler permissions list --json", why: "Read the current revision", audience: "agent" }]);
          throw new HranessError(`textbutler.${response.code}`, response.message);
        }
        const automaticReplies = input.change === "loosen" ? "on" : "off";
        // Turning a chat on runs as a job; report it pending until it finishes.
        if (response.kind === "job") return { contactId: contact.id, automaticReplies, state: "pending", jobId: response.jobId, nextCommand: ["textbutler", "jobs", "show", response.jobId] };
        return { contactId: contact.id, automaticReplies, state: "applied", revision: "snapshot" in response ? response.snapshot.revision : null };
      },
      text: (value: { automaticReplies: string; state: string; jobId?: string }) => value.state === "pending"
        ? `Turning automatic replies ${value.automaticReplies} is still running. Check it with textbutler jobs show ${value.jobId}.`
        : `Automatic replies ${value.automaticReplies}.` },
    ...PRODUCT_VERBS,
  );
  return defineRegistry(PRODUCT, verbs);
}

/** Read-only: legacy login items that a reinstall retires. Never boots out or renames. */
export async function legacyLoginItems(home: string): Promise<{ label: string; state: "present" }[]> {
  try {
    const info = await lstat(join(home, "Library", "LaunchAgents", `${LEGACY_MENU_LOGIN_ITEM}.plist`));
    return info.isFile() || info.isSymbolicLink() ? [{ label: LEGACY_MENU_LOGIN_ITEM, state: "present" }] : [];
  } catch { return []; }
}

/** Runs a grammar command line through the shared registry. */
export async function runGrammar(args: readonly string[], json: boolean, deps: GrammarDeps, io: CliIO): Promise<number> {
  return await runCli(textbutlerRegistry(deps), [...args, ...json && !args.includes("--json") ? ["--json"] : []], io);
}
