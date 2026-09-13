import { expect, test } from "bun:test";
import { CONTROL_PROTOCOL, disconnectedSnapshot, parseControlResponse, parseProviderLoginChallenge, type ProviderAccountDiagnostic } from "./control.ts";
import { renderProviderAccounts } from "./provider-accounts.ts";

const account: ProviderAccountDiagnostic = { id: "native-codex", label: "Codex", route: "codex", provider: "codex", status: "unavailable", detail: "Synthetic account only", defaultReplyModel: null, classifierModel: null, managedAccount: { state: "signing-in", generation: 2, modelCount: 0, pendingLoginId: "synthetic-login" } };
const challenge = { type: "chatgptDeviceCode" as const, loginId: "synthetic-login", verificationUrl: "https://auth.openai.com/codex/device", userCode: "TEST-ONLY" };
const credentialAddress = new URL(challenge.verificationUrl);
credentialAddress.username = "synthetic";
credentialAddress.password = "synthetic";

test("login challenge is accepted only for the selected managed Codex account", () => {
  const snapshot = { ...disconnectedSnapshot(), providerAccounts: [account] };
  const response = { protocol: CONTROL_PROTOCOL, ok: true, kind: "provider-login", accountId: "native-codex", challenge, snapshot };
  expect(parseControlResponse(response)).toMatchObject({ kind: "provider-login", challenge });
  expect(() => parseControlResponse({ ...response, accountId: "other" })).toThrow();
  expect(() => parseControlResponse({ ...response, challenge: { ...challenge, loginId: "stale-login" } })).toThrow();
  expect(() => parseControlResponse({ ...response, snapshot: { ...snapshot, providerAccounts: [{ ...account, managedAccount: undefined }] } })).toThrow();
  expect(() => parseControlResponse({ ...response, snapshot: { ...snapshot, providerAccounts: [{ ...account, status: "ready" }] } })).toThrow();
  expect(() => parseProviderLoginChallenge({ ...challenge, accessToken: "synthetic-secret" })).toThrow();
});

test.each(["javascript:alert(1)", "http://auth.openai.com/codex/device", "https://auth.openai.com.evil.invalid/codex/device", credentialAddress.href, "https://auth.openai.com:444/codex/device", "https://auth.openai.com/codex/device?redirect=other", "https://auth.openai.com/codex/device#fragment", "https://auth.openai.com/other", "https://auth.openai.com\n/codex/device"])("rejects unsafe device sign-in address %s", verificationUrl => {
  expect(() => parseProviderLoginChallenge({ ...challenge, verificationUrl })).toThrow();
});

test("browser challenges accept only HTTPS OpenAI sign-in origins and bounded codes", () => {
  expect(parseProviderLoginChallenge({ type: "chatgpt", loginId: "synthetic-login", authUrl: "https://auth.openai.com/oauth/authorize?state=synthetic" }).type).toBe("chatgpt");
  expect(() => parseProviderLoginChallenge({ type: "chatgpt", loginId: "synthetic-login", authUrl: "https://elsewhere.invalid" })).toThrow();
  expect(() => parseProviderLoginChallenge({ ...challenge, userCode: "<script>" })).toThrow();
  expect(() => parseProviderLoginChallenge({ ...challenge, loginId: "x".repeat(161) })).toThrow();
});

test("the account surface keeps sign-in distinct from reply readiness and drops finished challenges", () => {
  const challenges = new Map([[account.id, challenge]]);
  const pending = renderProviderAccounts([account], true, challenges);
  expect(pending).toContain("TEST-ONLY"); expect(pending).toContain("Cancel sign-in"); expect(pending).toContain("readonly");
  const replaced = renderProviderAccounts([{ ...account, managedAccount: { ...account.managedAccount!, pendingLoginId: "new-login" } }], true, challenges);
  expect(replaced).not.toContain("TEST-ONLY"); expect(replaced).toContain("Cancel sign-in");
  expect(pending).not.toContain('href='); expect(pending).not.toContain('data-provider-login=');
  const signed = renderProviderAccounts([{ ...account, label: "<Synthetic>", managedAccount: { state: "signed-in", generation: 3, modelCount: 2, pendingLoginId: null } }], true, challenges);
  expect(signed).toContain("Signed in · 2 models discovered"); expect(signed).toContain("Replies unavailable");
  expect(signed).not.toContain("TEST-ONLY"); expect(signed).toContain("&lt;Synthetic&gt;");
  const recovery = renderProviderAccounts([{ ...account, managedAccount: { state: "recovery-required", generation: 4, modelCount: 0, pendingLoginId: null } }], true, challenges);
  expect(recovery).toContain('data-provider-check="native-codex" disabled');
  expect(recovery).toContain('data-provider-login="native-codex" disabled');
  expect(renderProviderAccounts(undefined, false, challenges)).not.toContain("TEST-ONLY");
});
