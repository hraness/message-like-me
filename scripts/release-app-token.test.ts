import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, verify } from "node:crypto";

import {
  createReleaseAppJwt,
  MESSAGE_LIKE_ME_REPOSITORY_ID,
  parseReleaseAppIdentity,
  parseReleaseAppInstallation,
  parseReleaseAppConfiguration,
  parseReleaseAppTokenResponse,
  releaseAppTokenRequestBody,
  withReleaseAppToken,
} from "./release-app-token.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const token = "installation-token-for-exact-repository";
const serverDate = "Sat, 29 Aug 2026 18:00:00 GMT";
const expiresAt = "2026-08-29T19:00:00Z";
const environment = Object.freeze({
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPOSITORY: "hraness/message-like-me",
  GITHUB_REPOSITORY_ID: String(MESSAGE_LIKE_ME_REPOSITORY_ID),
  GITHUB_REPOSITORY_OWNER: "hraness",
  MLM_RELEASE_APP_CLIENT_ID: "Iv1.messageLikeMeRelease",
  MLM_RELEASE_APP_ID: "24680",
  MLM_RELEASE_APP_INSTALLATION_ID: "13579",
  MLM_RELEASE_APP_PRIVATE_KEY: privateKeyPem,
  MLM_RELEASE_APP_SLUG: "message-like-me-release-writer",
});

function tokenResponse(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    expires_at: expiresAt,
    permissions: { contents: "write", metadata: "read" },
    repositories: [{
      full_name: "hraness/message-like-me",
      id: MESSAGE_LIKE_ME_REPOSITORY_ID,
      name: "message-like-me",
      owner: { login: "hraness" },
    }],
    repository_selection: "selected",
    token,
    ...overrides,
  };
}

function appIdentity(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    client_id: "Iv1.messageLikeMeRelease",
    id: 24680,
    owner: { login: "hraness", type: "Organization" },
    permissions: { contents: "write", metadata: "read" },
    slug: "message-like-me-release-writer",
    ...overrides,
  };
}

function installationIdentity(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    account: { login: "hraness", type: "Organization" },
    app_id: 24680,
    app_slug: "message-like-me-release-writer",
    id: 13579,
    permissions: { contents: "write", metadata: "read" },
    repository_selection: "selected",
    target_type: "Organization",
    ...overrides,
  };
}

describe("release App token transaction", () => {
  test("signs a bounded RS256 App JWT with the checked client identity", () => {
    const nowMilliseconds = Date.parse("2026-08-29T18:00:00Z");
    const jwt = createReleaseAppJwt({
      clientId: environment.MLM_RELEASE_APP_CLIENT_ID,
      nowMilliseconds,
      privateKey: privateKeyPem,
    });
    const parts = jwt.split(".");
    if (parts.length !== 3) throw new Error("JWT does not have three segments");
    const [header, payload, signature] = parts as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      exp: Math.floor(nowMilliseconds / 1000) - 60 + 9 * 60,
      iat: Math.floor(nowMilliseconds / 1000) - 60,
      iss: environment.MLM_RELEASE_APP_CLIENT_ID,
    });
    expect(verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`, "ascii"),
      publicKey,
      Buffer.from(signature, "base64url"),
    )).toBe(true);
  });

  test("requests and accepts only the numeric Message Like Me repository closure", () => {
    expect(releaseAppTokenRequestBody()).toEqual({
      permissions: { contents: "write", metadata: "read" },
      repository_ids: [1_342_143_606],
    });
    expect(parseReleaseAppTokenResponse(tokenResponse(), serverDate)).toEqual({
      expiresAt,
      permissions: { contents: "write", metadata: "read" },
      repositoryId: 1_342_143_606,
      token,
    });
    expect(() => parseReleaseAppIdentity(
      appIdentity(),
      parseReleaseAppConfiguration(environment),
    )).not.toThrow();
    expect(() => parseReleaseAppInstallation(
      installationIdentity(),
      parseReleaseAppConfiguration(environment),
    )).not.toThrow();
  });

  test("masks, uses, and revokes the exact token around one operation", async () => {
    const calls: string[] = [];
    const result = await withReleaseAppToken({
      environment,
      async inspect(input) {
        expect(input.apiUrl.href).toBe("https://api.github.com/");
        expect(input.jwt.split(".")).toHaveLength(3);
        calls.push("inspect");
        return appIdentity();
      },
      async inspectInstallation(input) {
        expect(input.apiUrl.href).toBe("https://api.github.com/");
        expect(input.installationId).toBe(13579);
        expect(input.jwt.split(".")).toHaveLength(3);
        calls.push("inspect-installation");
        return installationIdentity();
      },
      mask(value) {
        expect(value).toBe(token);
        calls.push("mask");
      },
      async mint(input) {
        expect(input.apiUrl.href).toBe("https://api.github.com/");
        expect(input.body).toEqual(releaseAppTokenRequestBody());
        expect(input.installationId).toBe(13579);
        expect(input.jwt.split(".")).toHaveLength(3);
        calls.push("mint");
        return { body: tokenResponse(), serverDate };
      },
      nowMilliseconds: () => Date.parse("2026-08-29T18:00:00Z"),
      async revoke(input) {
        expect(input).toEqual({ apiUrl: new URL("https://api.github.com/"), token });
        calls.push("revoke");
      },
    }, async (value, receipt) => {
      expect(value).toBe(token);
      expect(receipt).toEqual({
        appId: 24680,
        appSlug: "message-like-me-release-writer",
        clientId: "Iv1.messageLikeMeRelease",
        expiresAt,
        installationId: 13579,
        repositoryId: 1_342_143_606,
      });
      calls.push("operation");
      return "complete";
    });
    expect(result).toBe("complete");
    expect(calls).toEqual([
      "inspect",
      "inspect-installation",
      "mint",
      "mask",
      "operation",
      "revoke",
    ]);
  });

  test("rejects a mismatched selected installation before token mint", async () => {
    for (const installation of [
      installationIdentity({ id: 1 }),
      installationIdentity({ app_id: 1 }),
      installationIdentity({ app_slug: "other-app" }),
      installationIdentity({ account: { login: "other", type: "Organization" } }),
      installationIdentity({ repository_selection: "all" }),
      installationIdentity({ permissions: { contents: "read", metadata: "read" } }),
    ] as const) {
      const calls: string[] = [];
      await expect(withReleaseAppToken({
        environment,
        async inspect() { calls.push("inspect"); return appIdentity(); },
        async inspectInstallation() {
          calls.push("inspect-installation");
          return installation;
        },
        mask() { calls.push("mask"); },
        async mint() { calls.push("mint"); return { body: tokenResponse(), serverDate }; },
        nowMilliseconds: () => Date.parse("2026-08-29T18:00:00Z"),
        async revoke() { calls.push("revoke"); },
      }, async () => {
        calls.push("operation");
      })).rejects.toThrow("installation identity or permission closure");
      expect(calls).toEqual(["inspect", "inspect-installation"]);
    }
  });

  test("revokes a minted token when response validation or the operation fails", async () => {
    for (const body of [
      tokenResponse({ expires_at: "2026-08-29T18:01:00Z" }),
      tokenResponse({ permissions: { contents: "read", metadata: "read" } }),
      tokenResponse({ repositories: [] }),
      tokenResponse({ repository_selection: "all" }),
    ] as const) {
      const calls: string[] = [];
      await expect(withReleaseAppToken({
        environment,
        async inspect() { calls.push("inspect"); return appIdentity(); },
        async inspectInstallation() {
          calls.push("inspect-installation");
          return installationIdentity();
        },
        mask() { calls.push("mask"); },
        async mint() { calls.push("mint"); return { body, serverDate }; },
        nowMilliseconds: () => Date.parse("2026-08-29T18:00:00Z"),
        async revoke() { calls.push("revoke"); },
      }, async () => {
        calls.push("operation");
      })).rejects.toThrow();
      expect(calls).toEqual(["inspect", "inspect-installation", "mint", "mask", "revoke"]);
    }

    const missingDateCalls: string[] = [];
    await expect(withReleaseAppToken({
      environment,
      async inspect() { missingDateCalls.push("inspect"); return appIdentity(); },
      async inspectInstallation() {
        missingDateCalls.push("inspect-installation");
        return installationIdentity();
      },
      mask() { missingDateCalls.push("mask"); },
      async mint() {
        missingDateCalls.push("mint");
        return { body: tokenResponse(), serverDate: null };
      },
      nowMilliseconds: () => Date.parse("2026-08-29T18:00:00Z"),
      async revoke() { missingDateCalls.push("revoke"); },
    }, async () => {
      missingDateCalls.push("operation");
    })).rejects.toThrow("response Date is not a string");
    expect(missingDateCalls).toEqual([
      "inspect",
      "inspect-installation",
      "mint",
      "mask",
      "revoke",
    ]);

    const calls: string[] = [];
    await expect(withReleaseAppToken({
      environment,
      async inspect() { calls.push("inspect"); return appIdentity(); },
      async inspectInstallation() {
        calls.push("inspect-installation");
        return installationIdentity();
      },
      mask() { calls.push("mask"); },
      async mint() { calls.push("mint"); return { body: tokenResponse(), serverDate }; },
      nowMilliseconds: () => Date.parse("2026-08-29T18:00:00Z"),
      async revoke() { calls.push("revoke"); },
    }, async () => {
      calls.push("operation");
      throw new Error("leased push failed");
    })).rejects.toThrow("leased push failed");
    expect(calls).toEqual([
      "inspect",
      "inspect-installation",
      "mint",
      "mask",
      "operation",
      "revoke",
    ]);
  });

  test("reports both an operation failure and a revocation failure", async () => {
    const failure = withReleaseAppToken({
      environment,
      async inspect() { return appIdentity(); },
      async inspectInstallation() { return installationIdentity(); },
      mask() {},
      async mint() { return { body: tokenResponse(), serverDate }; },
      nowMilliseconds: () => Date.parse("2026-08-29T18:00:00Z"),
      async revoke() { throw new Error("revoke failed"); },
    }, async () => {
      throw new Error("operation failed");
    });
    await expect(failure).rejects.toThrow("operation and token revocation both failed");
    try {
      await failure;
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors.map((item) => String(item))).toEqual([
        "Error: operation failed",
        "Error: revoke failed",
      ]);
    }
  });

  test("rejects copied repository and App coordinates before minting", () => {
    expect(parseReleaseAppConfiguration(environment).repositoryId).toBe(1_342_143_606);
    for (const overrides of [
      { GITHUB_API_URL: "https://github.example.test" },
      { GITHUB_REPOSITORY: "hraness/other" },
      { GITHUB_REPOSITORY_ID: "1" },
      { GITHUB_REPOSITORY_OWNER: "other" },
      { MLM_RELEASE_APP_CLIENT_ID: "bad client" },
      { MLM_RELEASE_APP_ID: "0" },
      { MLM_RELEASE_APP_INSTALLATION_ID: "1.5" },
      { MLM_RELEASE_APP_PRIVATE_KEY: "" },
      { MLM_RELEASE_APP_SLUG: "Bad_Slug" },
    ] as const) {
      expect(() => parseReleaseAppConfiguration({ ...environment, ...overrides })).toThrow();
    }
  });
});
