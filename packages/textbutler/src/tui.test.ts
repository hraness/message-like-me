import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONTROL_PROTOCOL, disconnectedSnapshot, type ControlRequest, type ControlResponse } from "../../control/src/index.ts";
import { chooseConnector, runTerminalSession, terminalDashboard, terminalText, terminalDraft } from "./tui.ts";
const snapshot = { ...disconnectedSnapshot(), connection: "connected" as const, revision: 7 };
const view: ControlResponse = { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot };
function session(answers: (string | null)[]) { const output: string[] = []; return { output, io: { write: (text: string) => output.push(text), ask: async () => answers.shift() ?? null } }; }
test("terminal dashboard has explicit next actions and escapes untrusted terminal controls", () => {
  expect(terminalDashboard(null)).toContain("Setup & readiness");
  expect(terminalDashboard(snapshot)).toContain("Automatic replies paused");
  expect(terminalText("hello\x1b[2J\u202eattack\nnext")).toBe("hello\\u001b[2J\\u202eattack\nnext");
});
test("opening and quitting terminal only reads snapshots", async () => {
  const calls: ControlRequest[] = [], { io } = session(["q"]);
  expect(await runTerminalSession("/unused", io, async request => { calls.push(request); return view; })).toBe(0);
  expect(calls.map(request => request.command)).toEqual(["snapshot"]);
});
test("first setup configures messaging before offering a service that would lock configuration", async () => {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-first-run-"));
  const output: string[] = [], prompts: string[] = [], answers = ["1", "q"];
  try {
    await runTerminalSession(root, { write: value => output.push(value), ask: async prompt => { prompts.push(prompt); return answers.shift() ?? null; } },
      async () => ({ protocol: CONTROL_PROTOCOL, ok: false, code: "unavailable", message: "Disconnected" }));
    expect(prompts).toEqual(["Choose an action: ", "Choose an action: "]);
    expect(output.join("")).toContain("Next choose Connect messaging apps (2)");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("cancelling conversation selection never enrolls or imports history", async () => {
  const calls: ControlRequest[] = [], { io } = session(["3", "", "q"]);
  await runTerminalSession("/unused", io, async request => {
    calls.push(request);
    return request.command === "conversations.list" ? { protocol: CONTROL_PROTOCOL, ok: true, kind: "conversations", candidates: [{ id: "candidate", name: "Alex", subtitle: "Beeper", eligible: true, reason: "" }], detail: "Choose a conversation" } : view;
  });
  expect(calls.some(request => request.command === "contact.enroll")).toBe(false);
});
test("pause is explicit and revision checked; cancelled resume has no mutation", async () => {
  const calls: ControlRequest[] = [], { io } = session(["6", "7", "n", "q"]);
  await runTerminalSession("/unused", io, async request => { calls.push(request); return view; });
  expect(calls.filter(request => request.command === "global.settings.update")).toEqual([
    { protocol: CONTROL_PROTOCOL, command: "global.settings.update", expectedRevision: 7, settings: snapshot.settings },
  ]);
});

test("typed reply review uses the captured revision and disclosed content", async () => {
  const contact = { id: "contact-1", name: "Alex\nspoof", subtitle: "Beeper", settings: { enabled: false, responseMode: "smart" as const, keyword: "butler", provider: "codex" as const, disclosure: { character: "🤖", begin: "{", end: "}" } } };
  const state = { ...snapshot, contacts: [contact] }, calls: ControlRequest[] = [];
  const { io, output } = session(["4", "1", "t", " hello ", "send", "q"]);
  await runTerminalSession("/unused", io, async request => {
    calls.push(request);
    if (request.command === "replies.scan") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "replies", scannedAt: "2026-09-19T00:00:00Z", checked: 1, unreadable: 0,
      pending: [{ contactId: contact.id, name: contact.name, provider: "beeper", enabled: false, pendingCount: 1, lastInboundAt: null, preview: "Hello", sendable: true, reason: null }], drafts: [] };
    if (request.command === "replies.send") return { protocol: CONTROL_PROTOCOL, ok: false, code: "conflict", message: "Review changed settings." };
    return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: state };
  });
  expect(calls.filter(request => request.command === "replies.send")).toEqual([{ protocol: CONTROL_PROTOCOL, command: "replies.send", contactId: "contact-1", text: " hello ", expectedRevision: 7 }]);
  expect(output.join("")).toContain("To: Alex spoof\n🤖{ hello }");
  expect(output.join("")).toContain("Review changed settings.");
});

test("full draft review shows every outgoing text beyond preview length", () => {
  const first = "A".repeat(2000), second = "second message\nwith a new line";
  const output = terminalDraft({ id: "draft:test", contactId: "contact-1", name: "Alex", provider: "beeper", conversationId: "chat-1", summary: "Two messages",
    actions: [{ kind: "text", text: first }, { kind: "text", text: second }], assets: [], digest: "a".repeat(64), expiresAt: "2026-09-19T01:00:00Z" });
  expect(output).toContain(first);
  expect(output).toContain(second);
  expect(output).toContain("2. Message");
});

test("rich-action review preserves complete target identifiers and escapes terminal controls", () => {
  const target = "message-" + "x".repeat(1500) + "\n\tend\u202e";
  const filename = "a".repeat(400) + ".png";
  const output = terminalDraft({ id: "draft:test", contactId: "contact-1", name: "Alex", provider: "imessage", conversationId: "chat-1", summary: "Three actions",
    actions: [{ kind: "reaction", action: "add", emoji: "👍", messageId: target }, { kind: "sticker", file: "assets/sticker.png", messageId: target },
      { kind: "attachment", file: "assets/file.png", name: filename, mimeType: "image/png" }, { kind: "sticker", file: "assets/new.png", messageId: null }], assets: [], digest: "a".repeat(64), expiresAt: "2026-09-19T01:00:00Z" });
  expect(output).toContain(terminalText(JSON.stringify(target)));
  expect(output).toContain(JSON.stringify(filename));
  expect(output).not.toContain("\u202e");
  expect(output).toContain("3. attachment");
  expect(output).toContain("On message: new message");
});
test("a mistyped account in the connect step shows the fix, not an uncertain-operation warning", async () => {
  const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-tui-usage-"));
  const output: string[] = [], answers = ["2", "/usr/bin/true", "imessage", "q"];
  try {
    await runTerminalSession(root, { write: value => output.push(value), ask: async () => answers.shift() ?? null },
      async () => ({ protocol: CONTROL_PROTOCOL, ok: false, code: "unavailable", message: "Disconnected" }), { connector: { detect: async () => ({ needsRuntime: false }) } });
    expect(output.join("")).toContain("Setup needs different options. See: textbutler help setup");
    expect(output.join("")).not.toContain("could not be confirmed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

describe("connect step finds Ghostget (T10)", () => {
  const disconnected = async (): Promise<ControlResponse> => ({ protocol: CONTROL_PROTOCOL, ok: false, code: "unavailable", message: "Disconnected" });
  test("a found Ghostget and Bun are the default; Enter saves them without typing a path", async () => {
    const root = await mkdtemp(join(await realpath("/tmp"), "textbutler-tui-connect-"));
    try {
      const ghostget = join(root, "cli.ts"), bun = join(root, "bun");
      await writeFile(ghostget, "#!/usr/bin/env bun\n"); await chmod(ghostget, 0o644);
      await writeFile(bun, "#!/bin/sh\n"); await chmod(bun, 0o755);
      const output: string[] = [], prompts: string[] = [], answers = ["2", "", "imessage:messages", "q"];
      await runTerminalSession(join(root, "data"), { write: value => output.push(value), ask: async prompt => { prompts.push(prompt); return answers.shift() ?? null; } },
        disconnected, { connector: { detect: async () => ({ ghostget, runtime: bun, needsRuntime: false }) } });
      expect(output.join("")).toContain(`Found Ghostget at ${ghostget}\nIt runs with Bun at ${bun}\n`);
      expect(prompts).not.toContain("Path to Ghostget (Enter to cancel): ");
      expect(output.join("")).toContain("Connection saved.");
      const host = JSON.parse(await readFile(join(root, "data", "state", "host.json"), "utf8"));
      expect(host.ghostget).toMatchObject({ executable: ghostget, runtimeExecutable: bun, automationAccounts: [{ provider: "imessage", authId: "messages" }] });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  test("declining the found path asks for one, and a script path picks up the found Bun", async () => {
    const output: string[] = [], prompts: string[] = [], answers = ["n", "/opt/bin/ghostget"];
    const io = { write: (value: string) => output.push(value), ask: async (prompt: string) => { prompts.push(prompt); return answers.shift() ?? null; } };
    expect(await chooseConnector(io, { detect: async () => ({ ghostget: "/a/ghostget", runtime: "/a/bun", needsRuntime: false }), isScript: async path => path.endsWith(".ts"),
      resolve: async path => path === "/opt/bin/ghostget" ? "/opt/ghostget/cli.ts" : path })).toEqual({ executable: "/opt/ghostget/cli.ts", runtime: "/a/bun" });
    expect(prompts).toEqual(["Use it? [Y/n]: ", "Path to Ghostget (Enter to cancel): "]);
  });
  test("a found script Ghostget without Bun asks only for Bun", async () => {
    const prompts: string[] = [], answers = ["/b/bun"];
    const io = { write: () => {}, ask: async (prompt: string) => { prompts.push(prompt); return answers.shift() ?? null; } };
    expect(await chooseConnector(io, { detect: async () => ({ ghostget: "/a/cli.ts", needsRuntime: true }), findBun: async () => undefined, isScript: async () => true }))
      .toEqual({ executable: "/a/cli.ts", runtime: "/b/bun" });
    expect(prompts).toEqual(["Path to Bun, which runs Ghostget (Enter to cancel): "]);
  });
  test("an unsafe Ghostget explains the fix; nothing found links the install guide; Enter cancels", async () => {
    for (const [found, expected] of [
      [{ needsRuntime: false, unsafe: { path: "/opt/shared/ghostget/cli.ts", reason: "writable" } }, "other users can change that file, so Textbutler won't run it.\nFix it with: chmod go-w /opt/shared/ghostget/cli.ts\n"],
      [{ needsRuntime: false, unsafe: { path: "/usr/local/bin/ghostget", reason: "owner" } }, "another user owns that file, so Textbutler won't run it. Install your own copy: https://ghostget.com/docs/tutorials/getting-started/\n"],
      [{ needsRuntime: false }, "Ghostget isn't in the usual install folders. Install it first: https://ghostget.com/docs/tutorials/getting-started/\n"],
    ] as const) {
      const output: string[] = [];
      expect(await chooseConnector({ write: value => output.push(value), ask: async () => "" }, { detect: async () => found })).toBeNull();
      expect(output.join("")).toContain(expected);
    }
  });
});

test("contacts name the model that writes automatic replies", async () => {
  const { replyWriterLabel } = await import("./tui.ts");
  const base = { protocol: "textbutler.control/1" } as never;
  expect(replyWriterLabel({ ...(base as object), habitat: { driver: "gateway", model: "alibaba/qwen3.5-flash", evolutionModel: null, debounceMs: 1500, dailyBudgetMicroUsd: 1_000_000 } } as never)).toBe("Qwen 3.5 Flash (Vercel AI Gateway)");
  expect(replyWriterLabel({ ...(base as object), habitat: { driver: "local", model: "local/other", evolutionModel: null, debounceMs: 1500, dailyBudgetMicroUsd: 0 } } as never)).toBe("local/other");
  expect(replyWriterLabel(base)).toBeNull();
});
