import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { openSettingsUrl, runAccessGuide } from "./access-guide.ts";
import { runTerminalSession } from "./tui.ts";
import { imessageConfigured, type PermissionStep } from "./permission-readiness.ts";
import { parseHostConfig } from "./host-config.ts";
import { CONTROL_PROTOCOL } from "../../control/src/index.ts";

const symbols = { ok: "✓", fail: "✗", next: "→", notice: "🔐", warn: "⚠" };
const FDA = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const AUTOMATION = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

async function guide(step: PermissionStep | undefined, answers: (string | null)[], extra: { configured?: boolean; platform?: string; open?: boolean } = {}) {
  const output: string[] = [], opened: string[] = [], prompts: string[] = [];
  await runAccessGuide("/Volumes/Data/Application Support/Textbutler", {
    write: text => output.push(text), ask: async prompt => { prompts.push(prompt); return answers.shift() ?? null; },
    openUrl: async url => { opened.push(url); return extra.open ?? true; },
  }, { symbols, platform: extra.platform ?? "darwin", step: async () => step, imessageConfigured: async () => extra.configured ?? true });
  return { text: output.join(""), opened, prompts };
}
const setupStep = (overrides: Partial<PermissionStep>): PermissionStep => ({ id: "macos-access", title: "macOS access for iMessage", status: "action-needed", detail: "", ...overrides });

describe("guided access step (T3)", () => {
  test("first run: Full Disk Access notice, Enter opens only its pane, then the Automation notice and the setup command", async () => {
    const { text, opened } = await guide(setupStep({ command: "bun run textbutler:app imessage-setup --data-dir '/Volumes/Data/Application Support/Textbutler'", settingsUrl: FDA }), ["", ""]);
    expect(opened).toEqual([FDA]);
    expect(text).toMatchSnapshot();
  });
  test("skipping Full Disk Access opens nothing and still explains Automation", async () => {
    const { text, opened } = await guide(setupStep({ command: "x", settingsUrl: FDA }), ["s"]);
    expect(opened).toEqual([]);
    expect(text).toContain("Step 2 of 2: Automation");
    expect(text).toContain("🔐 macOS will ask to let Textbutler control Messages.");
  });
  test("an Automation denial shows the recovery, and o opens only the Automation pane", async () => {
    const detail = "Textbutler can't control Messages: macOS access is off for Textbutler. Turn on Textbutler in System Settings › Privacy & Security › Automation. macOS won't ask again, so run app setup again after you turn it on.";
    const { text, opened } = await guide(setupStep({ status: "blocked", detail, settingsUrl: AUTOMATION }), ["o"]);
    expect(opened).toEqual([AUTOMATION]);
    expect(text).toContain("Step 1 of 1");
    expect(text).not.toContain("Step 1 of 2");
    expect(text).toMatchSnapshot();
  });
  test("a stopped app setup shows its own step and command, not the first-run notice", async () => {
    const { text } = await guide(setupStep({ detail: "App setup stopped before it finished. Run it again.", command: "bun run textbutler:app imessage-setup --data-dir /x" }), []);
    expect(text).toContain("Step 1 of 1: App setup");
    expect(text).toContain("⚠ App setup stopped before it finished. Run it again.");
    expect(text).toContain("bun run textbutler:app imessage-setup --data-dir /x");
    expect(text).not.toContain("macOS will ask");
  });
  test("the Full Disk Access prompt also opens on o and re-asks on other keys", async () => {
    const { text, opened, prompts } = await guide(setupStep({ command: "x", settingsUrl: FDA }), ["typo", "o", ""]);
    expect(opened).toEqual([FDA]);
    expect(prompts).toEqual(["> ", "> ", "Press Enter when it's on: "]);
    expect(text).toContain("Press Enter or o to open Settings, or s to skip.");
  });
  test("the Automation recovery re-asks on unknown keys before continuing", async () => {
    const { text, prompts } = await guide(setupStep({ status: "blocked", detail: "Textbutler couldn't control Messages. …", settingsUrl: AUTOMATION }), ["z", ""]);
    expect(prompts).toEqual(["> ", "> "]);
    expect(text).toContain("Press Enter to continue, or o to open Settings.");
  });
  test("a host.json that can't be read is an error, never 'connect first'", async () => {
    const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-access-"));
    try {
      await mkdir(join(root, "state"), { recursive: true, mode: 0o700 });
      await writeFile(join(root, "state", "host.json"), "not json{", { mode: 0o600 });
      const output: string[] = [];
      await runAccessGuide(root, { write: text => output.push(text), ask: async () => null, openUrl: async () => true }, { symbols, platform: "darwin" });
      expect(output.join("")).toContain("can't be read");
      expect(output.join("")).not.toContain("Connect iMessage first");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("with valid settings and the service stopped, the real check still says connect first", async () => {
    const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-access-"));
    try {
      await mkdir(join(root, "state"), { recursive: true, mode: 0o700 });
      await writeFile(join(root, "state", "host.json"), '{"schemaVersion":1}', { mode: 0o600 });
      const output: string[] = [];
      await runAccessGuide(root, { write: text => output.push(text), ask: async () => null, openUrl: async () => true }, { symbols, platform: "darwin" });
      expect(output.join("")).toContain("Connect iMessage first");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("the shared iMessage rule matches readiness: an account, or the running service", () => {
    const withImessage = parseHostConfig({ schemaVersion: 1, ghostget: { executable: "/bin/echo", authId: "a", automationAccounts: [{ provider: "imessage", authId: "messages" }] } });
    const legacy = parseHostConfig({ schemaVersion: 1, ghostget: { executable: "/bin/echo", authId: "a" } });
    expect(imessageConfigured(withImessage, [])).toBe(true);
    expect(imessageConfigured(legacy, ["imessage"])).toBe(true);
    expect(imessageConfigured(legacy, ["whatsapp"])).toBe(false);
    expect(imessageConfigured(null, undefined)).toBe(false);
  });
  test("an unconfirmed Automation result uses the unknown recovery", async () => {
    const { text } = await guide(setupStep({ status: "blocked", detail: "Textbutler couldn't control Messages. …", settingsUrl: AUTOMATION }), [""]);
    expect(text).toContain("✗ Textbutler couldn't control Messages. macOS may be blocking Textbutler.");
  });
  test("a missing app, a finished setup, no iMessage and other systems each say one plain thing", async () => {
    expect((await guide(setupStep({ command: "textbutler help permissions", settingsUrl: FDA }), [])).text)
      .toBe("iMessage works through the Textbutler app on this Mac. Build and install it first, then come back here.\n→ https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md#give-textbutler-access-to-imessage\n");
    expect((await guide(setupStep({ status: "done", detail: "Textbutler can control Messages." }), [])).text).toBe("✓ Textbutler can control Messages.\n");
    expect((await guide(undefined, [], { configured: false })).text).toContain("Connect iMessage first");
    expect((await guide(undefined, [], { platform: "linux" })).text).toBe("iMessage access applies only on a Mac.\n");
  });
  test("when Settings can't open, the path is shown instead", async () => {
    const { text } = await guide(setupStep({ command: "x", settingsUrl: FDA }), ["", ""], { open: false });
    expect(text).toContain("Open System Settings › Privacy & Security › Full Disk Access yourself.");
  });
  test("the opener refuses anything but the allowlisted panes", async () => {
    expect(await openSettingsUrl("https://example.com")).toBe(false);
    expect(await openSettingsUrl("x-apple.systempreferences:com.apple.preference.security?Privacy_Camera")).toBe(false);
  });
  test("the terminal offers the step as 8 and reads only Textbutler's own records", async () => {
    const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-access-"));
    try {
      await mkdir(join(root, "state"), { recursive: true, mode: 0o700 });
      await writeFile(join(root, "state", "host.json"), "{}", { mode: 0o600 });
      const output: string[] = [], answers = ["8", "q"];
      await runTerminalSession(root, { write: text => output.push(text), ask: async () => answers.shift() ?? null },
        async () => ({ protocol: CONTROL_PROTOCOL, ok: false, code: "unavailable", message: "Disconnected" }), { access: { platform: "darwin", imessageConfigured: async () => false } });
      expect(output.join("")).toContain("  8  Give Textbutler access");
      expect(output.join("")).toContain("Connect iMessage first");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
