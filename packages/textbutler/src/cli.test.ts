import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { newContact } from "./config.ts";
import { runTextbutlerCli } from "./cli.ts";
import { CliUsageError } from "./cli-style.ts";
import { startDaemon, type RunningDaemon } from "./daemon.ts";

const roots: string[] = [], daemons: RunningDaemon[] = [];
afterEach(async () => { for (const daemon of daemons.splice(0)) await daemon.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function root(): Promise<string> { const path = await mkdtemp(join(await realpath("/tmp"), "textbutler-cli-")); roots.push(path); return path; }
const run = async (argv: string[]) => { const lines: string[] = []; const code = await runTextbutlerCli(argv, { write: text => lines.push(text) }); return { code, lines, json: () => JSON.parse(lines.join("")) }; };

describe("owner reply CLI", () => {
  test("inbox and replies commands are admitted; malformed forms show usage", async () => {
    for (const argv of [
      ["replies"], ["replies", "bogus"], ["replies", "suggest"], ["replies", "send"], ["replies", "send", "contact-1"],
      ["replies", "discard"], ["replies", "send", "draft:x", "extra"],
      ["replies", "send", "draft:x"], ["replies", "show"], ["replies", "show", "contact-1"],
      ["inbox", "extra"],
    ]) await expect(runTextbutlerCli(argv, { write: () => {} })).rejects.toThrow(CliUsageError);
  });
  test("reply commands fail closed when no daemon is reachable", async () => {
    const dataDir = await root();
    const inbox = await run(["inbox", "--data-dir", dataDir]);
    expect(inbox.code).toBe(1);
    expect(inbox.json()).toMatchObject({ ok: false });
    const suggest = await run(["replies", "suggest", "someone", "--data-dir", dataDir]);
    expect(suggest.code).toBe(1);
  });
  test("a daemon without messaging automation reports replies unavailable", async () => {
    const dataDir = await root();
    const daemon = await startDaemon({ dataDir, initialSettings: { schemaVersion: 1, paused: true, maxActiveContacts: 5, contacts: [newContact("contact-1", "Alice Example", "route-1")] } });
    daemons.push(daemon);
    const inbox = await run(["inbox", "--data-dir", dataDir]);
    expect(inbox.code).toBe(1);
    expect(inbox.json()).toMatchObject({ ok: false, code: "unavailable" });
    const send = await run(["replies", "send", "draft:abc", "a".repeat(64), "--data-dir", dataDir]);
    expect(send.code).toBe(1);
    expect(send.json()).toMatchObject({ ok: false, code: "unavailable" });
    const discard = await run(["replies", "discard", "draft:abc", "--data-dir", dataDir]);
    expect(discard.code).toBe(1);
    expect(discard.json()).toMatchObject({ ok: false, code: "unavailable" });
  });
  test("contact names resolve exactly once and ambiguous labels fail safely", async () => {
    const dataDir = await root();
    const daemon = await startDaemon({ dataDir, initialSettings: { schemaVersion: 1, paused: true, maxActiveContacts: 5,
      contacts: [newContact("contact-1", "Alice Example", "route-1"), newContact("contact-2", "Alicia Sample", "route-2")] } });
    daemons.push(daemon);
    // "ali" matches both Alice Example and Alicia Sample — refuse to guess a recipient.
    await expect(runTextbutlerCli(["replies", "send", "ali", "hello", "--data-dir", dataDir], { write: () => {} })).rejects.toThrow("matches");
    await expect(runTextbutlerCli(["replies", "send", "nobody", "hello", "--data-dir", dataDir], { write: () => {} })).rejects.toThrow("No configured contact");
    // Exact-id sends still fail closed here (no messaging automation) but the contact resolved.
    const send = await run(["replies", "send", "contact-1", "hello", "--data-dir", dataDir]);
    expect(send.code).toBe(1);
    expect(send.json()).toMatchObject({ ok: false, code: "unavailable" });
  });
});

describe("owner CLI entrypoint", () => {
  test("help gives a readable first task and distinguishes draft review from sending", async () => {
    const help = await run(["--help"]);
    expect(help.code).toBe(0);
    expect(help.lines.join("")).toContain("Start here");
    expect(help.lines.join("")).toContain("replies <command>");
    const replies = await run(["help", "replies"]);
    expect(replies.lines.join("")).toContain("replies show <draft>");
    expect(replies.lines.join("")).toContain("replies send <draft> <check>");
    expect((await run(["help", "contacts"])).lines.join("")).toContain("contacts add <candidate> [--history]");
    const setup = (await run(["setup", "--help"])).lines.join("");
    expect(setup).toContain("--xcb-account <ai>:<id>");
    expect(setup).toContain("--xcb-model <ai>/<model>[/<effort>]");
    expect((await run(["providers", "-h"])).lines.join("")).toContain("pbpaste | textbutler providers gateway-key");
  });
  test("contact controls and pause use the running owner daemon", async () => {
    const dataDir = await root();
    const daemon = await startDaemon({ dataDir, initialSettings: { schemaVersion: 1, paused: true, maxActiveContacts: 5,
      contacts: [newContact("contact-1", "Alice Example", "route-1")] } });
    daemons.push(daemon);
    expect((await run(["contacts", "list", "--data-dir", dataDir])).json()).toMatchObject({ ok: true, paused: true, contacts: [{ id: "contact-1", settings: { enabled: false } }] });
    const mode = await run(["contacts", "mode", "Alice", "keyword", "--keyword", "help", "--data-dir", dataDir]);
    expect(mode.code).toBe(0);
    expect(mode.json()).toMatchObject({ kind: "snapshot", snapshot: { settings: { paused: true }, contacts: [{ settings: { enabled: false, responseMode: "keyword", keyword: "help" } }] } });
    const resume = await run(["resume", "--data-dir", dataDir]);
    expect(resume.json()).toMatchObject({ snapshot: { settings: { paused: false }, contacts: [{ settings: { enabled: false } }] } });
    const pause = await run(["pause", "--data-dir", dataDir]);
    expect(pause.json()).toMatchObject({ snapshot: { settings: { paused: true } } });
    expect((await run(["status", "--json", "--data-dir", dataDir])).json()).toMatchObject({ ok: true, schema: "textbutler.status/1", data: { owner: { state: "running" } } });
  });
  test("owner commands report disconnected control without inventing completed changes", async () => {
    const dataDir = await root();
    const result = await run(["pause", "--data-dir", dataDir]);
    expect(result.code).toBe(1);
    expect(result.json()).toMatchObject({ ok: false, status: "disconnected", detail: expect.stringContaining("before repeating") });
  });
});

describe("default reply model setup", () => {
  test("providers gateway-key stores a piped key owner-only and refuses a terminal or a malformed key", async () => {
    const dataDir = await root();
    const lines: string[] = [];
    const code = await runTextbutlerCli(["providers", "gateway-key", "--json", "--data-dir", dataDir], { write: text => lines.push(text) }, { readSecret: () => "vck_synthetic-key\n" });
    expect(code).toBe(0);
    expect(JSON.parse(lines.join(""))).toMatchObject({ ok: true, status: "saved", model: "alibaba/qwen3.5-flash" });
    expect(lines.join("")).not.toContain("vck_synthetic-key");
    const { readFile, lstat } = await import("node:fs/promises");
    const path = join(dataDir, "state", "provider-credentials", "vercel-ai-gateway");
    expect(await readFile(path, "utf8")).toBe("vck_synthetic-key\n");
    expect((await lstat(path)).mode & 0o777).toBe(0o600);
    await expect(runTextbutlerCli(["providers", "gateway-key", "--data-dir", dataDir], { write: () => {} }, { readSecret: () => { throw new Error("Protected input does not read terminals."); } }))
      .rejects.toThrow("pbpaste | textbutler providers gateway-key");
    await expect(runTextbutlerCli(["providers", "gateway-key", "--data-dir", dataDir], { write: () => {} }, { readSecret: () => "two words" })).rejects.toThrow(CliUsageError);
    expect(await readFile(path, "utf8")).toBe("vck_synthetic-key\n");
  });

  test("providers local writes a validated loopback driver into host.json and borrows a search key", async () => {
    const dataDir = await root();
    const { readFile, mkdir, writeFile } = await import("node:fs/promises");
    const hostPath = join(dataDir, "state", "host.json");
    const run = async (argv: string[]) => { const lines: string[] = []; const code = await runTextbutlerCli([...argv, "--data-dir", dataDir, "--json"], { write: text => lines.push(text) }); return { code, json: () => JSON.parse(lines.join("")) }; };
    // Default model and Ollama address; the pinned local default is the tag.
    expect((await run(["providers", "local"])).code).toBe(0);
    expect(JSON.parse(await readFile(hostPath, "utf8")).habitat.driver).toEqual({ kind: "local", model: "qwen3:4b-instruct-2507-q4_K_M", baseUrl: "http://127.0.0.1:11434/v1" });
    // A custom model and port, plus an existing gateway credential reused for search.
    await mkdir(join(dataDir, "state", "provider-credentials"), { mode: 0o700 });
    await writeFile(join(dataDir, "state", "provider-credentials", "habitat-gateway"), "vck_search\n", { mode: 0o600 });
    expect((await run(["providers", "local", "qwen-test:1b", "--base-url", "http://127.0.0.1:9999/v1"])).json()).toMatchObject({ ok: true, status: "saved", model: "qwen-test:1b" });
    expect(JSON.parse(await readFile(hostPath, "utf8")).habitat.driver).toEqual({ kind: "local", model: "qwen-test:1b", baseUrl: "http://127.0.0.1:9999/v1", searchCredentialFile: "habitat-gateway" });
    // Non-loopback and malformed forms are refused before any write.
    await expect(runTextbutlerCli(["providers", "local", "m", "--base-url", "http://10.0.0.1:9/v1", "--data-dir", dataDir], { write: () => {} })).rejects.toThrow(CliUsageError);
    await expect(runTextbutlerCli(["providers", "local", "a", "b", "--data-dir", dataDir], { write: () => {} })).rejects.toThrow(CliUsageError);
    expect(JSON.parse(await readFile(hostPath, "utf8")).habitat.driver.model).toBe("qwen-test:1b");
  });
});
