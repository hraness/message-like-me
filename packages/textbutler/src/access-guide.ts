/** The guided "Give Textbutler access" step (T3) for the terminal.
 *
 * It walks the two macOS settings iMessage needs, in order, with the
 * permissions-kit copy: Full Disk Access (macOS never asks, so Enter opens the
 * pane) and Automation for Messages (macOS asks once, during app setup). Its
 * reads are Textbutler's own records — host.json, the app receipt, the last
 * setup result — plus the running service's provider list, the same inputs
 * readiness uses. It never probes chat.db and never causes a macOS prompt:
 * app setup, which does, is a separate command the owner runs. */
import { CONTROL_PROTOCOL } from "../../control/src/index.ts";
import { requestDaemon } from "./daemon.ts";
import { loadHostConfig, type HostConfig } from "./host-config.ts";
import { MESSAGES_AUTOMATION, MESSAGES_FDA, recoverySentence, renderPrePrompt, renderRecovery, settingsPath, settingsUrl, SETTINGS_URLS, type PermissionNeed } from "./permission-copy.ts";
import { imessageConfigured, macosAccessStep, shellWord, type PermissionStep } from "./permission-readiness.ts";
import type { Symbols } from "./cli-style.ts";

export interface AccessGuideIO {
  write(text: string): void;
  ask(prompt: string): Promise<string | null>;
  /** Opens an allowlisted System Settings URL. */
  openUrl(url: string): Promise<boolean>;
}

export interface AccessGuideOptions {
  symbols: Pick<Symbols, "ok" | "fail" | "next" | "notice" | "warn">;
  platform?: string;
  /** Test seam: the readiness step, normally read from the data folder. */
  step?: () => Promise<PermissionStep | undefined>;
  /** Test seam: whether iMessage is configured. */
  imessageConfigured?: () => Promise<boolean>;
}

const GUIDE = "https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md#give-textbutler-access-to-imessage";

/** Real opener: only the allowlisted panes, through /usr/bin/open. A spawn
 * failure becomes "couldn't open", never an exception into the caller. */
export async function openSettingsUrl(url: string): Promise<boolean> {
  if (!SETTINGS_URLS.includes(url)) return false;
  try {
    const child = Bun.spawn(["/usr/bin/open", url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return await child.exited === 0;
  } catch { return false; }
}

function notice(need: PermissionNeed, symbols: AccessGuideOptions["symbols"], confirm: string): string {
  const [first, ...rest] = renderPrePrompt(need, false).lines;
  return [`${symbols.notice} ${first}`, ...rest.map(line => `   ${line}`), `   ${confirm}`].join("\n") + "\n";
}

function recovery(need: PermissionNeed, state: "denied" | "unknown", symbols: AccessGuideOptions["symbols"], next: string): string {
  const shown = renderRecovery(need, state, false);
  return `${symbols.fail} ${shown.headline}\n  ${shown.detail}\n${symbols.next} ${next}\n`;
}

const yes = (answer: string | null): boolean => answer !== null && answer.trim() === "";
const said = (answer: string | null, key: string): boolean => answer !== null && answer.trim().toLowerCase() === key;

/** The default iMessage check: the shared predicate over host.json and the
 * running service's provider list. A settings read error is shown, not
 * hidden as "not configured" — the owner keeps their files. Returns
 * undefined after reporting an error. */
async function detectImessage(dataDir: string, io: AccessGuideIO, symbols: AccessGuideOptions["symbols"]): Promise<boolean | undefined> {
  let config: HostConfig | null = null;
  try { config = await loadHostConfig(dataDir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") config = null;
    else {
      const reason = error instanceof Error ? error.message : String(error);
      io.write(`${symbols.fail} Your Textbutler settings can't be read: ${reason}\n  Keep host.json, and check that you own it and only you can read it.\n${symbols.next} textbutler doctor\n`);
      return undefined;
    }
  }
  const response = await requestDaemon({ dataDir, request: { protocol: CONTROL_PROTOCOL, command: "snapshot" } }).catch(() => null);
  const providers = response?.ok && response.kind === "snapshot" ? response.snapshot.messagingProviders : [];
  return imessageConfigured(config, providers);
}

/** Step 1: Full Disk Access. macOS never asks, so Enter (or o) opens the
 * pane; s skips. Anything else re-asks rather than silently skipping.
 * Returns false when the owner leaves the guide. */
async function askFullDiskAccess(io: AccessGuideIO, symbols: AccessGuideOptions["symbols"]): Promise<boolean> {
  io.write(notice(MESSAGES_FDA, symbols, "Press Enter to open Settings · s to skip"));
  while (true) {
    const answer = await io.ask("> ");
    if (answer === null) return false;
    if (yes(answer) || said(answer, "o")) {
      if (!await io.openUrl(settingsUrl("full-disk-access"))) io.write(`Open ${settingsPath("full-disk-access")} yourself.\n`);
      io.write("Turn on Textbutler in the list. If it isn't there, click +, press Command-Shift-G, enter ~/Applications/TextButler.app and choose Open.\n");
      return await io.ask("Press Enter when it's on: ") !== null;
    }
    if (said(answer, "s")) return true;
    io.write("Press Enter or o to open Settings, or s to skip.\n");
  }
}

/** Automation after a setup result: the denial or unconfirmed recovery, then
 * o to open the pane or Enter to continue to the setup command. */
async function askAutomation(io: AccessGuideIO, symbols: AccessGuideOptions["symbols"], detail: string): Promise<boolean> {
  const state = detail.startsWith(recoverySentence(MESSAGES_AUTOMATION, "denied")) ? "denied" : "unknown";
  io.write(recovery(MESSAGES_AUTOMATION, state, symbols, "press o to open Settings, then run app setup again"));
  while (true) {
    const answer = await io.ask("> ");
    if (answer === null) return false;
    if (said(answer, "o")) {
      if (!await io.openUrl(settingsUrl("automation"))) io.write(`Open ${settingsPath("automation")} yourself.\n`);
      return true;
    }
    if (yes(answer)) return true;
    io.write("Press Enter to continue, or o to open Settings.\n");
  }
}

/** Returns when the owner finishes or leaves the step. Never throws for a
 * missing record; a changed or unsafe one is reported by macosAccessStep. */
export async function runAccessGuide(dataDir: string, io: AccessGuideIO, options: AccessGuideOptions): Promise<void> {
  const { symbols } = options;
  if ((options.platform ?? process.platform) !== "darwin") { io.write("iMessage access applies only on a Mac.\n"); return; }
  const configured = options.imessageConfigured !== undefined ? await options.imessageConfigured() : await detectImessage(dataDir, io, symbols);
  if (configured === undefined) return;
  if (!configured) { io.write("Connect iMessage first: choose Connect messaging apps (2) and add an imessage sign-in. Then come back here.\n"); return; }
  const read = options.step ?? (() => macosAccessStep({ dataDir, imessageConfigured: true, platform: "darwin" }));
  const setup = `bun run textbutler:app imessage-setup --data-dir ${shellWord(dataDir)}`;
  const step = await read();
  if (step === undefined) return;
  if (step.status === "done") { io.write(`${symbols.ok} ${step.detail}\n`); return; }
  if (step.command === "textbutler help permissions") {
    io.write(`iMessage works through the Textbutler app on this Mac. Build and install it first, then come back here.\n${symbols.next} ${GUIDE}\n`);
    return;
  }
  if (step.status === "blocked" && step.settingsUrl === undefined) { io.write(`${symbols.fail} ${step.detail}\n`); return; }

  // Only the steps still to do are shown, and only they are numbered.
  const shown: { title: string; run(): Promise<boolean> }[] = [];
  if (step.settingsUrl === settingsUrl("full-disk-access")) {
    shown.push({ title: "Full Disk Access", run: () => askFullDiskAccess(io, symbols) });
    shown.push({ title: "Automation", run: async () => { io.write(notice(MESSAGES_AUTOMATION, symbols, "App setup shows this notice again before macOS asks.")); return true; } });
  } else if (step.settingsUrl === settingsUrl("automation")) {
    shown.push({ title: "Automation", run: () => askAutomation(io, symbols, step.detail) });
  } else {
    // A non-settings step, e.g. "App setup stopped before it finished. Run it again."
    shown.push({ title: "App setup", run: async () => { io.write(`${symbols.warn} ${step.detail}\n`); return true; } });
  }
  for (const [index, item] of shown.entries()) {
    io.write(`\nStep ${index + 1} of ${shown.length}: ${item.title}\n`);
    if (!await item.run()) return;
  }
  io.write(`Stop the background service, then run app setup from your Textbutler source folder:\n  ${step.command ?? setup}\n${symbols.next} Then choose Setup & readiness (1) to check the result.\n`);
}
