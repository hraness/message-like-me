/** The guided "Give Textbutler access" step (T3) for the terminal.
 *
 * It walks the two macOS settings iMessage needs, in order, with the
 * permissions-kit copy: Full Disk Access (macOS never asks, so Enter opens the
 * pane) and Automation for Messages (macOS asks once, during app setup). It
 * reads only Textbutler's own records through macosAccessStep, never probes
 * chat.db and never causes a macOS prompt itself: app setup, which does, is a
 * separate command the owner runs. */
import { loadHostConfig } from "./host-config.ts";
import { MESSAGES_AUTOMATION, MESSAGES_FDA, recoverySentence, renderPrePrompt, renderRecovery, settingsPath, settingsUrl, SETTINGS_URLS, type PermissionNeed } from "./permission-copy.ts";
import { macosAccessStep, shellWord, type PermissionStep } from "./permission-readiness.ts";
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

/** Real opener: only the allowlisted panes, through /usr/bin/open. */
export async function openSettingsUrl(url: string): Promise<boolean> {
  if (!SETTINGS_URLS.includes(url)) return false;
  const child = Bun.spawn(["/usr/bin/open", url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  return await child.exited === 0;
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

/** Returns when the owner finishes or leaves the step. Never throws for a
 * missing record; a changed or unsafe one is reported by macosAccessStep. */
export async function runAccessGuide(dataDir: string, io: AccessGuideIO, options: AccessGuideOptions): Promise<void> {
  const { symbols } = options;
  if ((options.platform ?? process.platform) !== "darwin") { io.write("iMessage access applies only on a Mac.\n"); return; }
  const configured = await (options.imessageConfigured ?? (async () => {
    const config = await loadHostConfig(dataDir).catch(() => null);
    return Boolean(config?.ghostget?.automationAccounts?.some(account => account.provider === "imessage"));
  }))();
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

  // 1 of 2: Full Disk Access. macOS never asks, so the notice leads to the pane.
  if (step.settingsUrl === settingsUrl("full-disk-access")) {
    io.write(`\nStep 1 of 2: Full Disk Access\n${notice(MESSAGES_FDA, symbols, "Press Enter to open Settings · s to skip")}`);
    const answer = await io.ask("> ");
    if (answer === null) return;
    if (yes(answer)) {
      if (!await io.openUrl(settingsUrl("full-disk-access"))) io.write(`Open ${settingsPath("full-disk-access")} yourself.\n`);
      io.write("Turn on Textbutler in the list. If it isn't there, click +, press Command-Shift-G, enter ~/Applications/TextButler.app and choose Open.\n");
      if (await io.ask("Press Enter when it's on: ") === null) return;
    }
  }

  // 2 of 2: Automation. App setup asks macOS once; after a denial it won't ask again.
  if (step.settingsUrl === settingsUrl("automation")) {
    const state = step.detail.startsWith(recoverySentence(MESSAGES_AUTOMATION, "denied")) ? "denied" : "unknown";
    io.write(`\nStep 2 of 2: Automation\n${recovery(MESSAGES_AUTOMATION, state, symbols, "press o to open Settings, then run app setup again")}`);
    const answer = await io.ask("> ");
    if (said(answer, "o") && !await io.openUrl(settingsUrl("automation"))) io.write(`Open ${settingsPath("automation")} yourself.\n`);
  } else {
    io.write(`\nStep 2 of 2: Automation\n${notice(MESSAGES_AUTOMATION, symbols, "App setup shows this notice again before macOS asks.")}`);
  }
  io.write(`Stop the background service, then run app setup from your Textbutler source folder:\n  ${setup}\n${symbols.next} Then choose Setup & readiness (1) to check the result.\n`);
}
