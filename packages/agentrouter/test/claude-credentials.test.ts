import { expect, test } from "bun:test";
import { createEnvironmentClaudeApiKeyResolver } from "../src/claude-credentials.ts";

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
