import { fileURLToPath } from "node:url";
import { createLaunchAgentLifecycle, defaultLaunchAgentHost } from "./launch-agent.ts";
import { runMenuBarCommand } from "./menubar.ts";
import { createInterface } from "node:readline/promises";
import { CONTROL_PROTOCOL, type ControlRequest, type ControlResponse, type DesktopSnapshot, type ReplyDraftDetail } from "../../control/src/index.ts";
import { requestDaemon } from "./daemon.ts";
import { loadHostConfig } from "./host-config.ts";
import { disclose } from "./config.ts";
import { runSetup } from "./onboarding.ts";
import { CliUsageError, symbolsFor } from "./cli-style.ts";
import { describeControlResult, describeMenuBarResult, describeServiceInstall } from "./tui-results.ts";
import { awaitOwnerJob, handleOwnerCommand, OwnerCliError, type OwnerControlClient } from "./owner-cli.ts";
import { openSettingsUrl, runAccessGuide, type AccessGuideOptions } from "./access-guide.ts";
import { detectBun, detectConnector, needsBun, resolveTyped, type DetectedConnector } from "./connect-detect.ts";
import { shellWord } from "./permission-readiness.ts";

export interface TerminalSession {
  write(text: string): unknown;
  ask(prompt: string): Promise<string | null>;
}
/** Terminal content is data. Escape C0/C1 and bidi controls, retaining line
 * breaks for complete message review; never print provider escape sequences. */
export function terminalText(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
export function terminalLabel(text: string): string { return terminalText(text).replace(/[\r\n\t]/gu, " ").slice(0, 300); }
export function terminalDashboard(snapshot: DesktopSnapshot | null): string {
  const active = snapshot?.contacts.filter(contact => contact.settings.enabled).length ?? 0;
  const state = !snapshot ? "Service not connected" : snapshot.settings.paused ? "Automatic replies paused" : snapshot.automation?.state === "running" ? "Automatic replies running" : "Automatic replies need setup";
  return ["", "TEXTBUTLER", "Your conversations, with you in control.", "", state,
    snapshot ? `${snapshot.contacts.length} conversations · ${active} with automatic replies on` : "Start with Setup & readiness.",
    "", "  1  Setup & readiness", "  2  Connect messaging apps", "  3  Add a conversation", "  4  Inbox & replies", "  5  Manage a contact", "  6  Pause automatic replies", "  7  Resume automatic replies", "  8  Menu bar companion", "  9  Give Textbutler access", "  q  Quit terminal", "", "Quitting leaves the background service running.", ""].join("\n");
}
export function terminalDraft(draft: ReplyDraftDetail): string {
  const field = (value: string): string => terminalText(JSON.stringify(value));
  const lines = [`To: ${terminalLabel(draft.name)} · ${draft.provider}`, `Contact: ${field(draft.contactId)}`, `Conversation: ${field(draft.conversationId)}`, ""];
  draft.actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.kind === "text" ? "Message" : action.kind}`);
    switch (action.kind) {
      case "text": lines.push(terminalText(action.text)); break;
      case "attachment": lines.push(`File: ${field(action.name)} (${field(action.mimeType)})`, `Path: ${field(action.file)}`); break;
      case "sticker": lines.push(`File: ${field(action.file)}`, `On message: ${action.messageId === null ? "new message" : field(action.messageId)}`); break;
      case "reaction": lines.push(`${action.action} ${field(action.emoji)} on message ${field(action.messageId)}`); break;
      case "link": case "app-clip": lines.push(terminalText(action.url)); break;
      case "poll": lines.push(terminalText(action.question), ...action.options.map(option => `  - ${terminalText(option)}`), `Maximum selections: ${action.maximumSelections ?? "any"}`); break;
      case "experience": lines.push(field(action.experienceId), terminalText(JSON.stringify(action.parameters, null, 2))); break;
    }
    lines.push("");
  });
  for (const asset of draft.assets) lines.push(`File verification: ${field(asset.path)} · ${asset.bytes} bytes · SHA-256 ${asset.sha256}`);
  lines.push(`Expires: ${draft.expiresAt}`, "Sending includes every action above, in that order.", "");
  return lines.join("\n");
}

async function pick<T>(io: TerminalSession, title: string, values: readonly T[], label: (value: T) => string): Promise<T | undefined> {
  let filtered = values;
  while (true) {
    io.write(`\n${title}\n`);
    if (values.length === 0) { io.write("Nothing available yet. Check Setup & readiness.\n"); return undefined; }
    filtered.slice(0, 20).forEach((value, index) => io.write(`  ${index + 1}  ${terminalLabel(label(value))}\n`));
    if (!filtered.length) io.write("No matches. Try another name, or Enter to go back.\n");
    if (filtered.length > 20) io.write(`Showing 20 of ${filtered.length}. Type a name to narrow the list.\n`);
    const value = await io.ask("Number or name to filter (Enter to go back): ");
    if (value === null || !value.trim()) return undefined;
    if (/^[1-9][0-9]?$/u.test(value.trim())) {
      const index = Number(value.trim()) - 1;
      if (index < 20 && filtered[index] !== undefined) return filtered[index];
      io.write("Choose one of the displayed numbers.\n");
    } else filtered = values.filter(item => label(item).toLowerCase().includes(value.trim().toLowerCase()));
  }
}
const GHOSTGET_GUIDE = "https://ghostget.com/docs/tutorials/getting-started/";

/** The connect step's Ghostget and Bun paths (T10). A found Ghostget is offered
 * as the default; typing a path is the fallback. Returns null when cancelled. */
export interface ConnectorHooks {
  detect?: () => Promise<DetectedConnector>;
  findBun?: () => Promise<string | undefined>;
  isScript?: (path: string) => Promise<boolean>;
  resolve?: (path: string) => Promise<string>;
}
export async function chooseConnector(io: TerminalSession, hooks: ConnectorHooks = {}): Promise<{ executable: string; runtime: string } | null> {
  const { detect = detectConnector, findBun = detectBun, isScript = needsBun, resolve = resolveTyped } = hooks;
  const found = await detect().catch((): DetectedConnector => ({ needsRuntime: false }));
  if (found.ghostget !== undefined && !found.needsRuntime) {
    io.write(`Found Ghostget at ${found.ghostget}${found.runtime === undefined ? "" : `\nIt runs with Bun at ${found.runtime}`}\n`);
    const answer = await io.ask("Use it? [Y/n]: ");
    if (answer === null) return null;
    if (!["n", "no"].includes(answer.trim().toLowerCase())) return { executable: found.ghostget, runtime: found.runtime ?? "" };
  } else if (found.ghostget !== undefined) {
    io.write(`Found Ghostget at ${found.ghostget}. It runs with Bun, which isn't in the usual folders.\n`);
  } else if (found.unsafe?.reason === "writable") {
    io.write(`Found Ghostget at ${found.unsafe.path}, but other users can change that file, so Textbutler won't run it.\nFix it with: chmod go-w ${shellWord(found.unsafe.path)}\n`);
  } else if (found.unsafe !== undefined) {
    io.write(`Found Ghostget at ${found.unsafe.path}, but another user owns that file, so Textbutler won't run it. Install your own copy: ${GHOSTGET_GUIDE}\n`);
  } else {
    io.write(`Ghostget isn't in the usual install folders. Install it first: ${GHOSTGET_GUIDE}\n`);
  }
  const answer = found.ghostget !== undefined && found.needsRuntime ? found.ghostget : (await io.ask("Path to Ghostget (Enter to cancel): "))?.trim();
  if (!answer) return null;
  // Setup accepts only the physical file, so resolve a symlink such as the one `which ghostget` prints.
  const typed = await resolve(answer).catch(() => answer);
  if (!await isScript(typed).catch(() => false)) return { executable: typed, runtime: "" };
  const bun = found.runtime ?? await findBun().catch(() => undefined);
  if (bun !== undefined) { io.write(`It runs with Bun at ${bun}\n`); return { executable: typed, runtime: bun }; }
  const runtime = (await io.ask("Path to Bun, which runs Ghostget (Enter to cancel): "))?.trim();
  return runtime ? { executable: typed, runtime } : null;
}

function printResponse(io: TerminalSession, response: ControlResponse, dataDir: string, done = "Settings updated."): void {
  io.write(`${terminalText(describeControlResult(response, symbolsFor(), done, { dataDir }))}\n`);
}

/** A thin owner client, following XCB's separation between interaction and
 * runtime authority. Selection never becomes a shell command or recipient guess. */
export async function runTerminalSession(dataDir: string, io: TerminalSession, client: OwnerControlClient = request => requestDaemon({ dataDir, request }),
  options: { entrypoint?: string; connector?: ConnectorHooks; access?: Partial<Omit<AccessGuideOptions, "symbols">> & { openUrl?: (url: string) => Promise<boolean> } } = {}): Promise<number> {
  const entrypoint = options.entrypoint ?? fileURLToPath(new URL("cli.ts", import.meta.url));
  const lifecycle = () => createLaunchAgentLifecycle(defaultLaunchAgentHost(entrypoint));
  const job = (request: ControlRequest) => awaitOwnerJob(request, client);
  const current = async (): Promise<DesktopSnapshot | null> => {
    const response = await client({ protocol: CONTROL_PROTOCOL, command: "snapshot" }).catch(() => null);
    return response?.ok && response.kind === "snapshot" ? response.snapshot : null;
  };
  const owner = async (args: readonly string[], done: string): Promise<void> => {
    await handleOwnerCommand(args, { request: client, print: value => io.write(`${terminalText(describeControlResult(value, symbolsFor(), done, { dataDir }))}\n`) });
  };
  while (true) {
    const snapshot = await current();
    io.write(terminalDashboard(snapshot));
    const choice = await io.ask("Choose an action: ");
    if (choice === null || ["q", "quit", "exit"].includes(choice.trim().toLowerCase())) return 0;
    try {
      if (choice.trim() === "1") {
        await runSetup([], dataDir, io, { next: false });
        const configured = await loadHostConfig(dataDir);
        const hasMessaging = Boolean(configured.ghostget?.authId || configured.ghostget?.automationAccounts?.length);
        if (!snapshot && !hasMessaging) {
          io.write("Next choose Connect messaging apps (2). After saving your connections, return here to start the background service.\n");
        } else if (!snapshot && (await io.ask("Start the background service at login? [y/N]: "))?.trim().toLowerCase() === "y") {
          const result = await lifecycle().install(dataDir);
          io.write(`${terminalText(describeServiceInstall(result, symbolsFor()))}\n`);
        }
        continue;
      }
      if (choice.trim() === "9") {
        const { openUrl = openSettingsUrl, ...access } = options.access ?? {};
        await runAccessGuide(dataDir, { write: text => io.write(text), ask: prompt => io.ask(prompt), openUrl }, { symbols: symbolsFor(), ...access });
        continue;
      }
      if (!snapshot && !["2", "8"].includes(choice.trim())) { io.write("Choose Setup & readiness (1) to start the background service, then return here. For a foreground session use textbutler daemon run in another terminal.\n"); continue; }
      if (choice.trim() === "2") {
        const providers = snapshot?.messagingProviders ?? [];
        const provider = providers.length ? await pick(io, "Choose a connection", [...providers, "configure" as const], value =>
          value === "configure" ? "Add another messaging app" : value === "beeper" ? "Beeper — linked messaging apps" : value === "imessage" ? "iMessage — native Messages" : "WhatsApp — native linked device") : "configure";
        if (provider === "configure") {
          io.write("Sign in to each app with Ghostget first. iMessage also needs macOS access for Textbutler (textbutler help permissions). Beeper must be open with its linked apps. Adding connections requires the Textbutler service to be stopped.\n");
          const config = await loadHostConfig(dataDir).catch(() => null);
          const paths = config?.ghostget ? { executable: config.ghostget.executable, runtime: config.ghostget.runtimeExecutable ?? "" }
            : await chooseConnector(io, options.connector);
          if (!paths) continue;
          const { executable, runtime } = paths;
          io.write("Next, the Ghostget sign-in for each app, as app:name. ghostget auth list shows your sign-in names.\n");
          const accounts = await io.ask("Sign-ins, separated by commas (for example imessage:messages,beeper:beeper-main): ");
          if (!accounts?.trim()) continue;
          const args = ["--ghostget", executable.trim(), ...(runtime.trim() ? ["--runtime", runtime.trim()] : []),
            ...(config?.ghostget?.stateHome ? ["--state-home", config.ghostget.stateHome] : [])];
          for (const account of accounts.split(",")) args.push("--account", account.trim());
          await runSetup(args, dataDir, io, { next: false });
          io.write("Connections saved. Choose Setup & readiness (1) to start the background service.\n");
          continue;
        }
        if (provider) printResponse(io, await job({ protocol: CONTROL_PROTOCOL, command: "messaging.start", provider }), dataDir,
          `${provider === "imessage" ? "iMessage" : provider === "whatsapp" ? "WhatsApp" : "Beeper"} connection started. Check it under Setup & readiness.`);
      } else if (choice.trim() === "3") {
        const response = await job({ protocol: CONTROL_PROTOCOL, command: "conversations.list" });
        if (!response.ok || response.kind !== "conversations") { printResponse(io, response, dataDir); continue; }
        io.write(`${terminalText(response.detail)}\n`);
        const candidate = await pick(io, "Select the exact conversation", response.candidates, value => `${value.name} · ${value.subtitle}${value.eligible ? "" : ` (unavailable: ${value.reason})`}`);
        if (!candidate) continue;
        if (!candidate.eligible) { io.write(`${terminalText(candidate.reason)}\n`); continue; }
        const history = await io.ask("Import up to 200 recent messages as context? [y/N]: ");
        if (history === null) continue;
        const confirmed = await io.ask(`Add ${terminalLabel(candidate.name)} with automatic replies OFF? [y/N]: `);
        if (confirmed?.trim().toLowerCase() !== "y") continue;
        await owner(["contacts", "add", candidate.id, ...(history.trim().toLowerCase() === "y" ? ["--history"] : [])], `Added ${terminalLabel(candidate.name)}. Automatic replies are off.`);
      } else if (choice.trim() === "4") {
        const response = await job({ protocol: CONTROL_PROTOCOL, command: "replies.scan" });
        if (!response.ok || response.kind !== "replies") { printResponse(io, response, dataDir); continue; }
        io.write(`Checked ${response.checked} conversations; ${response.unreadable} unavailable.\n`);
        const item = await pick(io, "Waiting for your reply", response.pending, value => `${value.name} · ${value.pendingCount} messages\n     ${value.preview ?? ""}${value.reason ? `\n     ${value.reason}` : ""}`);
        if (!item) continue;
        const action = await io.ask("[t] Type a reply  [s] Suggest a reply  [Enter] Back: ");
        if (action?.trim() === "s") {
          const suggested = await job({ protocol: CONTROL_PROTOCOL, command: "replies.suggest", contactId: item.contactId });
          if (!suggested.ok || suggested.kind !== "reply-suggestion" || !suggested.draft) { printResponse(io, suggested, dataDir); continue; }
          const review = await client({ protocol: CONTROL_PROTOCOL, command: "replies.draft.read", draftId: suggested.draft.id });
          if (!review.ok || review.kind !== "reply-draft") { printResponse(io, review, dataDir); continue; }
          io.write(`\nReview every outgoing action for ${terminalLabel(review.draft.name)} (${review.draft.provider}).\n`);
          io.write(terminalDraft(review.draft));
          if ((await io.ask("Type send to send these exact actions, or Enter to cancel: ")) === "send") {
            printResponse(io, await job({ protocol: CONTROL_PROTOCOL, command: "replies.send", draftId: review.draft.id, expectedDigest: review.draft.digest }), dataDir);
          }
        } else if (action?.trim() === "t") {
          const text = await io.ask("Your reply (Enter to cancel): ");
          if (!text?.trim()) continue;
          if (Buffer.byteLength(text) > 16_384) { io.write("Keep this reply within 16 KB.\n"); continue; }
          const contact = snapshot!.contacts.find(contact => contact.id === item.contactId);
          if (!contact) continue;
          const disclosed = disclose(text, contact.settings.disclosure);
          io.write(`\nTo: ${terminalLabel(item.name)}\n${terminalText(disclosed)}\n\n`);
          if ((await io.ask("Type send to send this reply, or Enter to cancel: ")) === "send") {
            printResponse(io, await job({ protocol: CONTROL_PROTOCOL, command: "replies.send", contactId: item.contactId, text, expectedRevision: snapshot!.revision }), dataDir);
          }
        }
      } else if (choice.trim() === "5") {
        const contact = await pick(io, "Choose a contact", snapshot!.contacts, value => `${value.name} · automatic replies ${value.settings.enabled ? "on" : "off"} · ${value.messaging?.provider ?? "read only"}`);
        if (!contact) continue;
        const action = await io.ask("[a] Choose agent  [e] Enable automatic replies  [d] Disable  [k] Keyword mode  [Enter] Back: ");
        if (action?.trim() === "a") {
          const account = await pick(io, "Choose an agent account", snapshot!.providerAccounts ?? [], value => `${value.label} · ${value.status}\n     ${value.detail}`);
          if (account) await owner(["contacts", "account", contact.id, account.id], `${terminalLabel(contact.name)} now uses ${terminalLabel(account.label)}.`);
        } else if (action?.trim() === "d") await owner(["contacts", "disable", contact.id], `Automatic replies are off for ${terminalLabel(contact.name)}.`);
        else if (action?.trim() === "e") {
          if ((await io.ask(`Allow automatic replies to ${terminalLabel(contact.name)} when unpaused? [y/N]: `))?.trim().toLowerCase() === "y") await owner(["contacts", "enable", contact.id], `Automatic replies are on for ${terminalLabel(contact.name)} whenever Textbutler isn't paused.`);
        } else if (action?.trim() === "k") {
          const keyword = await io.ask("Keyword (Enter keeps butler): ");
          if (keyword !== null) await owner(["contacts", "mode", contact.id, "keyword", "--keyword", keyword.trim() || "butler"], `Keyword mode is on for ${terminalLabel(contact.name)} (keyword: ${terminalLabel(keyword.trim() || "butler")}).`);
        }
      } else if (choice.trim() === "6") await owner(["pause"], "Automatic replies are paused.");
      else if (choice.trim() === "7") {
        if ((await io.ask("Resume automatic replies for enabled contacts? [y/N]: "))?.trim().toLowerCase() === "y") await owner(["resume"], "Automatic replies resumed for contacts that have them on.");
      } else if (choice.trim() === "8") {
        const action = await io.ask("[s] Start menu  [l] Start menu at login  [x] Stop menu  [Enter] Back: ");
        const command = action === "s" ? "start" : action === "l" ? "install" : action === "x" ? "stop" : null;
        // --json keeps the result on the write channel: the kit's human text
        // and its interactive login-item notice would otherwise print over the
        // terminal session and wait on stdin inside it.
        if (command) await runMenuBarCommand([command, "--json"], dataDir, entrypoint,
          result => io.write(`${terminalText(describeMenuBarResult(command, result, symbolsFor()))}\n`));
      } else io.write("Choose a number from 1 to 9, or q to quit.\n");
    } catch (error) {
      if (error instanceof OwnerCliError) { io.write(`${terminalText(error.message)}\n`); continue; }
      // Input mistakes are not uncertain operations: show the one-line fix.
      if (error instanceof CliUsageError) { io.write(`${terminalText(error.message)} See: ${terminalText(error.next)}\n`); continue; }
      io.write("This action could not be confirmed. Check Setup & readiness and Recent activity. Do not repeat a send with an uncertain result.\n");
    }
  }
}

export async function runTextbutlerTui(dataDir: string, output: { write(text: string): unknown } = process.stdout, options: { entrypoint?: string } = {}): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { output.write("The interactive terminal needs a TTY. Use textbutler setup, doctor, or --help for scriptable commands.\n"); return 1; }
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 0 });
  let closed = false;
  terminal.on("close", () => { closed = true; });
  terminal.on("SIGINT", () => terminal.close());
  try {
    return await runTerminalSession(dataDir, { write: text => output.write(terminalText(text)),
      ask: async prompt => {
        if (closed) return null;
        return await new Promise<string | null>(resolve => {
          const cancel = (): void => resolve(null);
          terminal.once("close", cancel);
          void terminal.question(terminalText(prompt)).then(answer => resolve(answer.length <= 16_384 ? answer : ""), () => resolve(null))
            .finally(() => terminal.removeListener("close", cancel));
        });
      } }, undefined, options);
  } finally { terminal.close(); }
}
