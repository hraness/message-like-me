import { expect, test } from "bun:test";
import { createEnvironmentClaudeApiKeyResolver } from "../src/claude-credentials.ts";
import { createFileClaudeApiKeyResolver } from "../src/claude-credentials.ts";
import { chmod, link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const key = ["sk", "ant", "api03", "synthetic", "fixture", "credential"].join("-");
test("explicit API-key binding never discovers unrelated account credentials", async () => {
  const reads: string[] = [];
  const bindings = { account: "TEXTBUTLER_ANTHROPIC_API_KEY" };
  const resolver = createEnvironmentClaudeApiKeyResolver(bindings, (name) => { reads.push(name); return key; });
  bindings.account = "OTHER_KEY";
  await expect(resolver.withApiKey("other", new AbortController().signal, async () => "bad")).rejects.toThrow("NOT_BOUND");
  expect(reads).toEqual([]);
  expect(await resolver.withApiKey("account", new AbortController().signal, async (value) => value === key)).toBe(true);
  expect(reads).toEqual(["TEXTBUTLER_ANTHROPIC_API_KEY"]);
});

test("owner-file keys reject shared, linked, replaced, and malformed credentials without discovery", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentrouter-key-")));
  try {
    const directory = join(root, "private"); await mkdir(directory, { mode: 0o700 });
    const file = join(directory, "selected"); await writeFile(file, `${key}\n`, { mode: 0o600 });
    const resolver = createFileClaudeApiKeyResolver({ directory, bindings: { account: "selected" } });
    const signal = new AbortController().signal;
    expect(await resolver.withApiKey("account", signal, async value => value === key)).toBe(true);
    await expect(resolver.withApiKey("unknown", signal, async () => "bad")).rejects.toThrow("NOT_BOUND");
    await chmod(file, 0o644);
    await expect(resolver.withApiKey("account", signal, async () => "bad")).rejects.toThrow("KEY_FILE_UNAVAILABLE");
    await chmod(file, 0o600); await link(file, join(root, "linked"));
    await expect(resolver.withApiKey("account", signal, async () => "bad")).rejects.toThrow("KEY_FILE_UNAVAILABLE");
    await rm(join(root, "linked")); await rm(file); await writeFile(join(root, "outside"), key, { mode: 0o600 });
    await symlink(join(root, "outside"), file);
    await expect(resolver.withApiKey("account", signal, async () => "bad")).rejects.toThrow("KEY_FILE_UNAVAILABLE");
    await rm(file); await writeFile(file, "not an API key", { mode: 0o600 });
    await expect(resolver.withApiKey("account", signal, async () => "bad")).rejects.toThrow("KEY_FILE_UNAVAILABLE");
    await writeFile(file, key); await chmod(directory, 0o755);
    await expect(resolver.withApiKey("account", signal, async () => "bad")).rejects.toThrow("KEY_FILE_UNAVAILABLE");
    expect(() => createFileClaudeApiKeyResolver({ directory, bindings: { account: "../escape" } })).toThrow("BINDING_INVALID");
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("missing/subscription credentials and cancellation fail without exposing values", async () => {
  for (const value of [undefined, ["sk", "ant", "oat01", "synthetic", "subscription", "credential"].join("-"), "subscription-value", "", "space separated value"]) {
    const resolver = createEnvironmentClaudeApiKeyResolver({ account: "SELECTED_KEY" }, () => value);
    await expect(resolver.withApiKey("account", new AbortController().signal, async () => "bad")).rejects.toThrow("CLAUDE_API_KEY_REQUIRED");
  }
  let read = false;
  const resolver = createEnvironmentClaudeApiKeyResolver({ account: "SELECTED_KEY" }, () => { read = true; return key; });
  const controller = new AbortController(); controller.abort();
  await expect(resolver.withApiKey("account", controller.signal, async () => "bad")).rejects.toThrow();
  expect(read).toBe(false);
});
