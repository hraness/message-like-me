import { describe, expect, test } from "bun:test";
import type { AccountLease, AccountLeaseStore } from "../src/accounts.ts";
import { createManagedCodexAccountController, type CodexAccountBinding, type CodexAccountCloseReceipt, type CodexAccountEvent, type CodexAccountRequest, type CodexAccountResponse, type CodexAccountTransport } from "../src/codex-account.ts";

const credentialAddress = new URL("https://auth.openai.com/");
credentialAddress.username = "synthetic";
credentialAddress.password = "synthetic";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
class Leases implements AccountLeaseStore {
  current: AccountLease | undefined; releases = 0; acquires = 0; generation = 0;
  acquire(input: Parameters<AccountLeaseStore["acquire"]>[0]) {
    this.acquires++;
    if (this.current !== undefined) throw new Error("ACCOUNT_BUSY_OR_RECOVERY_REQUIRED");
    return this.current = Object.freeze({ provider: input.provider, accountId: input.accountId, owner: input.owner, generation: ++this.generation, expiresAt: input.now + input.ttlMs });
  }
  renew(lease: AccountLease) { return lease; }
  release(lease: AccountLease) { if (lease !== this.current) return false; this.releases++; this.current = undefined; return true; }
}
const model = (id = "synthetic-model") => ({ id, model: id, displayName: "Synthetic model", hidden: false, isDefault: true,
  supportedReasoningEfforts: [{ reasoningEffort: "high", description: "High" }, { reasoningEffort: "ultra", description: "Ultra" }], defaultReasoningEffort: "high",
  serviceTiers: [{ id: "priority", name: "Priority", description: "Synthetic tier" }], defaultServiceTier: "priority" });
function fixture(options: { leases?: Leases; factoryFailure?: boolean; operationTimeoutMs?: number; closeTimeoutMs?: number; processGeneration?: number } = {}) {
  const leases = options.leases ?? new Leases(), calls: string[] = [], requests: CodexAccountRequest[] = [];
  let binding: CodexAccountBinding | undefined, event: ((value: CodexAccountEvent) => void) | undefined;
  let account: unknown = { account: { type: "chatgpt", email: "private-email@example.invalid", planType: "plus", token: "ignored-token" }, requiresOpenaiAuth: true };
  let pages: unknown[] = [{ data: [model()], nextCursor: null }], pageIndex = 0;
  let readGate: ReturnType<typeof deferred<void>> | undefined, loginGate: ReturnType<typeof deferred<void>> | undefined, closeGate: ReturnType<typeof deferred<void>> | undefined;
  const entered = deferred<void>(), loginEntered = deferred<void>();
  let responseBinding: Partial<CodexAccountBinding> = {}, responseGenerationDelta = 0;
  let receiptOverrides: Partial<CodexAccountCloseReceipt> = {};
  let challengeOverride: unknown;
  let logoutFailure = false;
  let loginFailure = false;
  let onClose: (() => void) | undefined;
  let mutationEvent: "logout" | "login" | "cancel" | "completion" | undefined;
  const wrap = (request: CodexAccountRequest, value: unknown): CodexAccountResponse => ({ binding: { ...request.binding, ...responseBinding }, accountGeneration: request.accountGeneration + responseGenerationDelta, value });
  const transport: CodexAccountTransport = {
    async accountRead(request) { calls.push("read"); requests.push(request); entered.resolve(); if (readGate) await readGate.promise; return wrap(request, account); },
    async startLogin(request) { calls.push(`login:${request.method}`); requests.push(request); loginEntered.resolve(); if (loginGate) await loginGate.promise; if (loginFailure) throw new Error("private-login-provider-detail"); if (mutationEvent === "login") event!({ binding: binding!, type: "account-updated" }); if (mutationEvent === "completion") event!({ binding: binding!, type: "login-completed", loginId: "login-one", success: true }); return wrap(request, challengeOverride ?? (request.method === "chatgpt" ? { type: "chatgpt", loginId: "login-one", authUrl: "https://auth.openai.com/authorize?state=private-challenge", accessToken: "never-export" } : { type: "chatgptDeviceCode", loginId: "login-one", verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH" })); },
    async cancelLogin(request) { calls.push(`cancel:${request.loginId}`); requests.push(request); if (mutationEvent === "cancel") event!({ binding: binding!, type: "account-updated" }); return wrap(request, { status: "canceled" }); },
    async logout(request) { calls.push("logout"); requests.push(request); if (logoutFailure) throw new Error("secret-token-do-not-print"); account = { account: null, requiresOpenaiAuth: true }; if (mutationEvent === "logout") event!({ binding: binding!, type: "account-updated" }); return wrap(request, {}); },
    async listModels(request) { calls.push(`models:${request.cursor ?? "first"}`); requests.push(request); return wrap(request, pages[pageIndex++] ?? { data: [], nextCursor: null }); },
    async close() { calls.push("close"); onClose?.(); if (closeGate) await closeGate.promise; return { binding: binding!, processExited: true, processGroupStopped: true, stdoutEnded: true, stderrEnded: true, writesSettled: true, requestsSettled: true, notificationsSettled: true, ...receiptOverrides }; },
  };
  const controller = createManagedCodexAccountController({ accountId: "account-one", owner: "owner-one", processGeneration: options.processGeneration ?? 3, leases,
    ...(options.operationTimeoutMs === undefined ? {} : { operationTimeoutMs: options.operationTimeoutMs }),
    ...(options.closeTimeoutMs === undefined ? {} : { closeTimeoutMs: options.closeTimeoutMs }),
    transportFactory(value, onEvent) { calls.push("factory"); binding = value; event = onEvent; if (options.factoryFailure) throw new Error("private-launch-error"); return transport; } });
  return { controller, leases, calls, requests, entered, loginEntered,
    onClose(callback: () => void) { onClose = callback; },
    mutationEvent(value: typeof mutationEvent) { mutationEvent = value; },
    account(value: unknown) { account = value; }, pages(value: unknown[]) { pages = value; pageIndex = 0; },
    challenge(value: unknown) { challengeOverride = value; }, logoutFailure() { logoutFailure = true; }, loginFailure() { loginFailure = true; },
    holdRead() { return readGate = deferred<void>(); }, holdLogin() { return loginGate = deferred<void>(); }, holdClose() { return closeGate = deferred<void>(); }, clearCloseGate() { closeGate = undefined; },
    wrongBinding(value: Partial<CodexAccountBinding>) { responseBinding = value; }, wrongGeneration() { responseGenerationDelta = -1; },
    receipt(value: Partial<CodexAccountCloseReceipt>) { receiptOverrides = value; },
    emit(type: CodexAccountEvent["type"], extras: Partial<CodexAccountEvent> = {}) { event!({ binding: binding!, type, ...extras }); },
    binding: () => binding!,
  };
}

describe("managed Codex account controller", () => {
  test("snapshot and unused close never acquire or launch", async () => {
    const f = fixture(); expect(f.controller.snapshot()).toMatchObject({ accountId: "account-one", state: "unchecked", accountGeneration: 1, processGeneration: 3, models: [] });
    expect(Object.isFrozen(f.controller.snapshot())).toBe(true); expect(f.calls).toEqual([]);
    expect(await f.controller.close()).toEqual({ released: true, state: "closed" }); expect(f.leases.acquires).toBe(0);
    await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
  });
  test("subscription read preserves advertised efforts and tiers without exposing email or extra fields", async () => {
    const f = fixture(); const result = await f.controller.check();
    expect(result).toMatchObject({ state: "signed-in", planType: "plus", models: [{ supportedReasoningEfforts: ["high", "ultra"], defaultServiceTier: "priority" }] });
    expect(JSON.stringify(result)).not.toContain("private-email"); expect(JSON.stringify(result)).not.toContain("token");
    expect(Object.isFrozen(result.models[0]!.serviceTiers[0])).toBe(true);
    expect(f.calls).toEqual(["factory", "read", "models:first"]); expect(f.requests[0]).toMatchObject({ refreshToken: false });
    expect(f.leases.releases).toBe(0); expect(await f.controller.close()).toEqual({ released: true, state: "closed" }); expect(f.leases.releases).toBe(1);
  });
  test.each([null, undefined])("optional/null account is signed out", async account => {
    const f = fixture(); f.account({ account, requiresOpenaiAuth: true }); expect((await f.controller.check()).state).toBe("signed-out"); expect(f.calls).not.toContain("models:first"); await f.controller.close();
  });
  test.each([{ account: { type: "apiKey" }, requiresOpenaiAuth: true }, { account: { type: "amazonBedrock" }, requiresOpenaiAuth: true }, { account: { type: "chatgpt", planType: "plus" }, requiresOpenaiAuth: false }])("wrong auth mode stays unavailable", async account => {
    const f = fixture(); f.account(account); expect(await f.controller.check()).toMatchObject({ state: "unavailable", detail: "CODEX_SUBSCRIPTION_REQUIRED", models: [] }); expect(f.calls).not.toContain("models:first"); await f.controller.close();
  });
  test("model pagination is bounded and completes before publishing", async () => {
    const f = fixture(); f.pages([{ data: [model("one")], nextCursor: "opaque-page" }, { data: [model("two")] }]);
    expect((await f.controller.check()).models.map(value => value.id)).toEqual(["one", "two"]); expect(f.calls).toContain("models:opaque-page"); await f.controller.close();
  });
  test.each(["cycle", "duplicate", "oversize", "pages"])("invalid catalog %s never publishes a partial model list", async kind => {
    const f = fixture();
    f.pages(kind === "cycle" ? [{ data: [model()], nextCursor: "same" }, { data: [], nextCursor: "same" }] : kind === "duplicate" ? [{ data: [model(), model()] }] : kind === "oversize" ? [{ data: Array.from({ length: 501 }, (_, i) => model(`model-${i}`)) }] : Array.from({ length: 20 }, (_, i) => ({ data: [], nextCursor: `page-${i}` })));
    await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED"); expect(f.controller.snapshot()).toMatchObject({ state: "unavailable", models: [] }); expect(f.calls.filter(call => call.startsWith("models:")).length).toBeLessThanOrEqual(20); await f.controller.close();
  });
  test.each(["chatgpt", "chatgptDeviceCode"] as const)("%s challenge is transient and explicit", async method => {
    const f = fixture(); const challenge = await f.controller.startLogin(method);
    expect(challenge.type).toBe(method); expect(challenge.loginId).toBe("login-one"); expect(Object.isFrozen(challenge)).toBe(true);
    expect(Object.keys(challenge)).not.toContain("accessToken"); expect(f.controller.snapshot()).toMatchObject({ state: "signing-in", models: [] });
    expect(f.controller.snapshot().pendingLoginId).toBe("login-one"); expect(JSON.stringify(f.controller.snapshot())).not.toContain("private-challenge"); expect(JSON.stringify(f.controller.snapshot())).not.toContain("ABCD");
    await expect(f.controller.startLogin(method)).rejects.toThrow("CODEX_LOGIN_PENDING");
    await expect(f.controller.cancelLogin("different-login")).rejects.toThrow("CODEX_LOGIN_STALE"); expect(f.calls.some(call => call.startsWith("cancel"))).toBe(false);
    expect(await f.controller.cancelLogin("login-one")).toEqual({ status: "canceled" }); expect(f.controller.snapshot().state).toBe("unchecked"); await f.controller.close();
  });
  test.each(["http://auth.openai.com/authorize", "https://evil.invalid/authorize", "https://auth.openai.com.evil.invalid/", credentialAddress.href, "javascript:alert(1)"])("unsafe login URL %s is not exported", async authUrl => {
    const f = fixture(); f.challenge({ type: "chatgpt", loginId: "login-one", authUrl }); await expect(f.controller.startLogin("chatgpt")).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED"); expect(f.controller.snapshot().state).toBe("recovery-required"); await f.controller.close();
  });
  test("external-token or API login is refused before account custody", async () => {
    const f = fixture(); await expect(f.controller.startLogin("apiKey" as "chatgpt")).rejects.toThrow("CODEX_MANAGED_LOGIN_REQUIRED"); expect(f.calls).toEqual([]); expect(f.leases.acquires).toBe(0);
  });
  test("caller cancellation before dispatch avoids launch", async () => {
    const f = fixture(), abort = new AbortController(); abort.abort(); await expect(f.controller.check(abort.signal)).rejects.toThrow("CODEX_ACCOUNT_ABORTED"); expect(f.calls).toEqual([]); expect(f.leases.acquires).toBe(0);
  });
  test("login aborted before dispatch neither acquires custody nor prevents a later attempt", async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    await expect(f.controller.startLogin("chatgptDeviceCode", abort.signal)).rejects.toThrow("CODEX_ACCOUNT_ABORTED");
    expect(f.calls).toEqual([]); expect(f.controller.snapshot().state).toBe("unchecked");
    expect((await f.controller.startLogin("chatgptDeviceCode")).loginId).toBe("login-one"); await f.controller.close();
  });
  test.each(["abort", "timeout"] as const)("dispatched login %s retains unresolved custody and discards its late challenge", async kind => {
    const f = fixture({ operationTimeoutMs: kind === "timeout" ? 5 : 1000, closeTimeoutMs: 5 });
    const gate = f.holdLogin(), abort = new AbortController();
    const started = f.controller.startLogin("chatgptDeviceCode", abort.signal);
    await f.loginEntered.promise; const generation = f.controller.snapshot().accountGeneration;
    if (kind === "abort") abort.abort();
    await expect(started).rejects.toThrow(kind === "abort" ? "CODEX_ACCOUNT_ABORTED" : "CODEX_ACCOUNT_TIMEOUT");
    const unresolved = f.controller.snapshot();
    expect(unresolved).toMatchObject({ state: "recovery-required", detail: "CODEX_LOGIN_OUTCOME_UNRESOLVED", pendingLoginId: null, models: [] });
    expect(unresolved.accountGeneration).toBeGreaterThan(generation);
    f.emit("account-updated"); f.emit("login-completed", { loginId: "login-one", success: true }); f.emit("disconnected");
    expect(f.controller.snapshot()).toBe(unresolved);
    await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
    await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
    await expect(f.controller.logout()).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
    await expect(f.controller.cancelLogin("login-one")).rejects.toThrow("CODEX_LOGIN_STALE");
    expect(f.calls).toEqual(["factory", "login:chatgptDeviceCode"]); expect(f.leases.releases).toBe(0);
    expect(await f.controller.close()).toEqual({ released: false, state: "recovery-required" });
    expect(f.leases.current).toBeDefined(); gate.resolve();
    expect(await f.controller.close()).toEqual({ released: true, state: "closed" });
    expect(f.controller.snapshot().pendingLoginId).toBeNull(); expect(f.leases.releases).toBe(1);
    expect(JSON.stringify(f.controller.snapshot())).not.toContain("ABCD-EFGH");
    await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
  });
  test("unknown native login polling cannot be retried after a provider rejection", async () => {
    const f = fixture(); f.loginFailure();
    await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED");
    expect(f.controller.snapshot()).toMatchObject({ state: "recovery-required", detail: "CODEX_LOGIN_OUTCOME_UNRESOLVED", pendingLoginId: null });
    expect(JSON.stringify(f.controller.snapshot())).not.toContain("private-login-provider-detail");
    await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
    expect(f.calls).toEqual(["factory", "login:chatgptDeviceCode"]);
    const replacement = fixture({ leases: f.leases, processGeneration: 4 });
    await expect(replacement.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED");
    expect(replacement.calls).toEqual([]);
    expect(await f.controller.close()).toEqual({ released: true, state: "closed" });
    expect((await replacement.controller.startLogin("chatgptDeviceCode")).loginId).toBe("login-one");
    expect(replacement.binding().processGeneration).toBe(4); expect(replacement.binding().leaseGeneration).toBe(2);
    await replacement.controller.close();
  });
  test("account notification racing login response cannot reopen an unresolved attempt", async () => {
    const f = fixture(); f.mutationEvent("login");
    await expect(f.controller.startLogin("chatgpt")).rejects.toThrow("CODEX_ACCOUNT_ABORTED");
    const unresolved = f.controller.snapshot(); expect(unresolved.state).toBe("recovery-required");
    f.emit("login-completed", { loginId: "login-one", success: true }); f.emit("account-updated");
    expect(f.controller.snapshot()).toBe(unresolved);
    await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE");
    expect(f.calls).toEqual(["factory", "login:chatgpt"]); await f.controller.close();
  });
  test("matching failed completion before response proves the attempt ended without exposing its spent challenge", async () => {
    const f = fixture(), gate = f.holdLogin(), started = f.controller.startLogin("chatgptDeviceCode");
    await f.loginEntered.promise; f.emit("login-completed", { loginId: "login-one", success: false }); gate.resolve();
    await expect(started).rejects.toThrow("CODEX_ACCOUNT_STALE");
    expect(f.controller.snapshot()).toMatchObject({ state: "unchecked", detail: "CODEX_LOGIN_FAILED", pendingLoginId: null });
    f.account({ account: null, requiresOpenaiAuth: true }); expect((await f.controller.check()).state).toBe("signed-out"); await f.controller.close();
  });
  test("an uncorrelated early completion cannot discharge a timed-out login", async () => {
    const f = fixture({ operationTimeoutMs: 5 }), gate = f.holdLogin();
    const started = f.controller.startLogin("chatgptDeviceCode"); await f.loginEntered.promise;
    f.emit("login-completed", { loginId: "different-login", success: true });
    await expect(started).rejects.toThrow("CODEX_ACCOUNT_TIMEOUT");
    gate.resolve(); expect(f.controller.snapshot().state).toBe("recovery-required");
    await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_UNAVAILABLE"); await f.controller.close();
  });
  test("unresolved login custody requires every transport cleanup proof even after its response promise settles", async () => {
    const f = fixture(); f.loginFailure(); await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED");
    f.receipt({ requestsSettled: false }); expect((await f.controller.close()).released).toBe(false); expect(f.leases.releases).toBe(0);
    f.receipt({}); expect((await f.controller.close()).released).toBe(true); expect(f.leases.releases).toBe(1);
  });
  test("abort cannot publish a late account read or start model discovery", async () => {
    const f = fixture(), gate = f.holdRead(), abort = new AbortController(); const checked = f.controller.check(abort.signal); await f.entered.promise;
    abort.abort(); await expect(checked).rejects.toThrow("CODEX_ACCOUNT_ABORTED"); gate.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.controller.snapshot().state).toBe("unavailable"); expect(f.calls).not.toContain("models:first"); expect(f.leases.releases).toBe(0); await f.controller.close();
  });
  test.each(["account", "process", "lease", "generation"])("%s stale response cannot publish", async field => {
    const f = fixture(); if (field === "generation") f.wrongGeneration(); else f.wrongBinding(field === "account" ? { accountId: "different" } : field === "process" ? { processGeneration: 2 } : { leaseGeneration: 2 });
    await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_STALE"); expect(f.controller.snapshot().models).toEqual([]); expect(f.calls).not.toContain("models:first"); await f.controller.close();
  });
  test("account event synchronously invalidates readiness; old process event is ignored", async () => {
    const f = fixture(); const first = await f.controller.check(); f.emit("account-updated", { binding: { ...f.binding(), processGeneration: 2 } }); expect(f.controller.snapshot()).toBe(first);
    f.emit("account-updated"); expect(f.controller.snapshot()).toMatchObject({ state: "unchecked", models: [], accountGeneration: first.accountGeneration + 1 });
    f.pages([{ data: [model()] }]); expect((await f.controller.check()).state).toBe("signed-in"); await f.controller.close();
  });
  test("account change fences an in-flight check and blocks subsequent model call", async () => {
    const f = fixture(), gate = f.holdRead(); const checked = f.controller.check(); await f.entered.promise; f.emit("account-updated"); await expect(checked).rejects.toThrow("CODEX_ACCOUNT_ABORTED"); gate.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(f.controller.snapshot().state).toBe("unchecked"); expect(f.calls).not.toContain("models:first"); await f.controller.close();
  });
  test("login completion only invalidates its pending login and requires authoritative check", async () => {
    const f = fixture(); await f.controller.startLogin("chatgpt"); const pending = f.controller.snapshot(); f.emit("login-completed", { loginId: "stale", success: true }); expect(f.controller.snapshot()).toBe(pending);
    f.emit("login-completed", { loginId: "login-one", success: true }); expect(f.controller.snapshot().state).toBe("unchecked"); expect(f.calls).not.toContain("read"); await f.controller.close();
  });
  test("checking while login is pending preserves sign-in and exact cancellation", async () => {
    const f = fixture(); await f.controller.startLogin("chatgpt"); f.account({ account: null, requiresOpenaiAuth: true });
    expect((await f.controller.check()).state).toBe("signing-in"); expect(await f.controller.cancelLogin("login-one")).toEqual({ status: "canceled" }); await f.controller.close();
  });
  test("pending attempt correlation survives checks and changes only for a new login", async () => {
    const f = fixture(); expect(f.controller.snapshot().pendingLoginId).toBeNull(); await f.controller.startLogin("chatgpt");
    const before = f.controller.snapshot(); f.account({ account: null, requiresOpenaiAuth: true }); const checked = await f.controller.check();
    expect(checked.accountGeneration).toBeGreaterThan(before.accountGeneration); expect(checked.pendingLoginId).toBe(before.pendingLoginId);
    await f.controller.cancelLogin("login-one"); expect(f.controller.snapshot().pendingLoginId).toBeNull();
    f.challenge({ type: "chatgptDeviceCode", loginId: "login-two", verificationUrl: "https://auth.openai.com/codex/device", userCode: "PRIVATE-CODE" });
    await f.controller.startLogin("chatgptDeviceCode"); expect(f.controller.snapshot().pendingLoginId).toBe("login-two");
    expect(JSON.stringify(f.controller.snapshot())).not.toContain("PRIVATE-CODE"); expect(JSON.stringify(f.controller.snapshot())).not.toContain("auth.openai.com");
    f.emit("account-updated"); expect(f.controller.snapshot().pendingLoginId).toBeNull(); await f.controller.close();
  });
  test("failed completion terminates only the exact pending login", async () => {
    const f = fixture(); await f.controller.startLogin("chatgpt"); f.emit("login-completed", { loginId: "login-one", success: false });
    expect(f.controller.snapshot()).toMatchObject({ state: "unchecked", detail: "CODEX_LOGIN_FAILED" });
    expect((await f.controller.startLogin("chatgpt")).loginId).toBe("login-one"); await f.controller.close();
  });
  test.each(["logout", "cancel"] as const)("own %s account notification before RPC response cannot publish stale success", async method => {
    const f = fixture(); if (method === "cancel") await f.controller.startLogin("chatgpt"); else await f.controller.check();
    f.mutationEvent(method);
    const operation = method === "logout" ? f.controller.logout() : f.controller.cancelLogin("login-one");
    await expect(operation).rejects.toThrow("CODEX_ACCOUNT_ABORTED"); expect(f.controller.snapshot()).toMatchObject({ state: "unchecked", models: [] });
    f.account({ account: null, requiresOpenaiAuth: true }); expect((await f.controller.check()).state).toBe("signed-out"); await f.controller.close();
  });
  test("login completion before challenge response is correlated and never publishes a spent challenge", async () => {
    const f = fixture(); f.mutationEvent("completion"); await expect(f.controller.startLogin("chatgpt")).rejects.toThrow("CODEX_ACCOUNT_STALE");
    expect(f.controller.snapshot()).toMatchObject({ state: "unchecked", models: [] }); expect((await f.controller.check()).state).toBe("signed-in"); await f.controller.close();
  });
  test("concurrent operation cannot relabel or abort its owner", async () => {
    const f = fixture(), gate = f.holdRead(); const checked = f.controller.check(); await f.entered.promise; const snapshot = f.controller.snapshot();
    await expect(f.controller.logout()).rejects.toThrow("CODEX_ACCOUNT_BUSY"); expect(f.controller.snapshot()).toBe(snapshot); expect(f.requests[0]!.signal.aborted).toBe(false);
    gate.resolve(); expect((await checked).state).toBe("signed-in"); await f.controller.close();
  });
  test("logout uses provider operation and re-reads account before publication", async () => {
    const f = fixture(); await f.controller.check(); expect((await f.controller.logout()).state).toBe("signed-out"); expect(f.calls.slice(-2)).toEqual(["logout", "read"]); expect(f.leases.releases).toBe(0); await f.controller.close();
  });
  test("provider failures expose only a stable error and keep custody", async () => {
    const f = fixture(); f.logoutFailure(); await expect(f.controller.logout()).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED"); expect(JSON.stringify(f.controller.snapshot())).not.toContain("secret"); expect(f.leases.current).toBeDefined(); await f.controller.close();
  });
  test("uncertain factory failure retains lease and close cannot invent proof", async () => {
    const f = fixture({ factoryFailure: true }); await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_FACTORY_FAILED"); expect(f.controller.snapshot().state).toBe("recovery-required"); expect(await f.controller.close()).toEqual({ released: false, state: "recovery-required" }); expect(f.leases.releases).toBe(0);
    const second = fixture({ leases: f.leases }); await expect(second.controller.check()).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED"); expect(second.calls).toEqual([]);
  });
  test.each(["processExited", "processGroupStopped", "stdoutEnded", "stderrEnded", "writesSettled", "requestsSettled", "notificationsSettled"] as const)("unproven %s blocks lease release and exact owner can retry", async field => {
    const f = fixture(); await f.controller.check(); f.receipt({ [field]: false }); expect(await f.controller.close()).toEqual({ released: false, state: "recovery-required" }); expect(f.leases.current).toBeDefined();
    f.receipt({}); expect(await f.controller.close()).toEqual({ released: true, state: "closed" }); expect(f.leases.releases).toBe(1); await f.controller.close(); expect(f.leases.releases).toBe(1);
  });
  test("reentrant transport close shares one attempt and one lease release", async () => {
    const f = fixture(); await f.controller.check(); let nested: ReturnType<typeof f.controller.close> | undefined;
    f.onClose(() => { nested = f.controller.close(); }); const outer = f.controller.close();
    expect(await outer).toEqual({ released: true, state: "closed" }); expect(nested).toBe(outer); expect(f.calls.filter(call => call === "close")).toHaveLength(1); expect(f.leases.releases).toBe(1);
  });
  test("reentrant abort listener shares close before cleanup starts", async () => {
    const f = fixture(), gate = f.holdRead(); const checked = f.controller.check().catch(error => error); await f.entered.promise;
    let nested: ReturnType<typeof f.controller.close> | undefined;
    f.requests[0]!.signal.addEventListener("abort", () => { nested = f.controller.close(); gate.resolve(); }, { once: true });
    const outer = f.controller.close(); expect(await outer).toEqual({ released: true, state: "closed" }); expect(nested).toBe(outer);
    expect((await checked).message).toBe("CODEX_ACCOUNT_ABORTED"); expect(f.calls.filter(call => call === "close")).toHaveLength(1); expect(f.leases.releases).toBe(1);
  });
  test("wrong process close receipt never releases account", async () => {
    const f = fixture(); await f.controller.check(); f.receipt({ binding: { ...f.binding(), processGeneration: 1 } }); expect((await f.controller.close()).released).toBe(false); expect(f.leases.releases).toBe(0);
  });
  test("claimed transport shutdown cannot release while controller reply is unsettled", async () => {
    const f = fixture({ closeTimeoutMs: 5 }), gate = f.holdRead(); const checked = f.controller.check(); await f.entered.promise;
    const caught = checked.catch(error => error); expect((await f.controller.close()).released).toBe(false); expect((await caught).message).toBe("CODEX_ACCOUNT_ABORTED"); expect(f.leases.releases).toBe(0);
    gate.resolve(); expect((await f.controller.close()).released).toBe(true);
  });
  test("operation timeout keeps custody and fences late data", async () => {
    const f = fixture({ operationTimeoutMs: 5 }), gate = f.holdRead(); await expect(f.controller.check()).rejects.toThrow("CODEX_ACCOUNT_TIMEOUT");
    expect(f.controller.snapshot()).toMatchObject({ state: "unavailable", detail: "CODEX_ACCOUNT_TIMEOUT" }); expect(f.leases.current).toBeDefined(); gate.resolve(); await Promise.resolve(); await Promise.resolve(); expect(f.calls).not.toContain("models:first"); await f.controller.close();
  });
  test("close timeout keeps custody for a later proven retry", async () => {
    const f = fixture({ closeTimeoutMs: 5 }); await f.controller.check(); const gate = f.holdClose(); expect((await f.controller.close()).released).toBe(false); expect(f.leases.current).toBeDefined(); gate.resolve(); expect((await f.controller.close()).released).toBe(true);
  });
  test("a newer close receipt cannot release a prior raw transport cleanup still running", async () => {
    const f = fixture({ closeTimeoutMs: 5 }); f.loginFailure();
    await expect(f.controller.startLogin("chatgptDeviceCode")).rejects.toThrow("CODEX_ACCOUNT_OPERATION_FAILED");
    const first = f.holdClose(); expect((await f.controller.close()).released).toBe(false);
    f.clearCloseGate(); expect((await f.controller.close()).released).toBe(false);
    expect(f.calls.filter(call => call === "close")).toHaveLength(2); expect(f.leases.releases).toBe(0);
    first.resolve(); expect((await f.controller.close()).released).toBe(true); expect(f.leases.releases).toBe(1);
  });
});
