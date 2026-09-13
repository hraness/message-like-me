import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inspect } from "node:util";
import { notaryAppCredentials, notaryPreflight, storeNotaryCredentials, NOTARY_PROFILE } from "./notary-preflight.ts";

const credentials = { appleId: "synthetic-apple-id@example.invalid", appPassword: "aaaa-bbbb-cccc-dddd", team: "XXXXXXXXXX" };
const result = (status = 0, stderr = ""): childProcess.SpawnSyncReturns<Buffer> => ({ pid: 1, output: [null, Buffer.from("synthetic-private-stdout"), Buffer.from(stderr)], stdout: Buffer.from("synthetic-private-stdout"), stderr: Buffer.from(stderr), status, signal: null });
type Call = { program: string; args: readonly string[]; options: childProcess.SpawnSyncOptions };

test("credential parsing removes only trailing password newlines and freezes the result", () => {
  for (const ending of ["", "\n", "\r\n", "\n\r\n"]) {
    const parsed = notaryAppCredentials(credentials.appleId, credentials.appPassword + ending, credentials.team);
    expect(parsed).toEqual(credentials);
    expect(Object.isFrozen(parsed)).toBe(true);
  }
  const punctuation = "Ab-Cd_ef+12";
  expect(notaryAppCredentials(credentials.appleId, punctuation, credentials.team).appPassword).toBe(punctuation);
});

test("malformed, missing, multiline, oversized and control-bearing credential values fail privately", () => {
  const invalid: readonly [unknown, unknown, unknown][] = [
    [undefined, credentials.appPassword, credentials.team], ["missing-at.invalid", credentials.appPassword, credentials.team],
    [credentials.appleId + "\n", credentials.appPassword, credentials.team], ["private\u0000@example.invalid", credentials.appPassword, credentials.team],
    ["x".repeat(255) + "@example.invalid", credentials.appPassword, credentials.team],
    [credentials.appleId, undefined, credentials.team], [credentials.appleId, "\r\n", credentials.team],
    [credentials.appleId, "aaaa\nbbbb", credentials.team], [credentials.appleId, "aaaa\rbbbb", credentials.team],
    [credentials.appleId, "aaaa bbbb", credentials.team], [credentials.appleId, "aaaa\tbbbb", credentials.team],
    [credentials.appleId, "aaaa\u0000bbbb", credentials.team], [credentials.appleId, "x".repeat(1025), credentials.team],
    [credentials.appleId, credentials.appPassword + "\n".repeat(2048), credentials.team],
    [credentials.appleId, credentials.appPassword, undefined], [credentials.appleId, credentials.appPassword, "lowercase1"],
    [credentials.appleId, credentials.appPassword, credentials.team + "\n"],
  ];
  for (const values of invalid) {
    let failure: unknown;
    try { notaryAppCredentials(...values); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/^Error: Invalid notarization (Apple ID|app password|team)$/u);
    expect(inspect(failure)).not.toContain(credentials.appPassword);
    expect(inspect(failure)).not.toContain(credentials.appleId);
  }
});

test("shared store path uses the real validation command and normalized password only on stdin", () => {
  const calls: Call[] = [];
  const spawn = spyOn(childProcess, "spawnSync").mockImplementation((...values: unknown[]) => {
    const [program, args, options] = values as [string, readonly string[], childProcess.SpawnSyncOptions];
    calls.push({ program, args, options }); return result();
  });
  const environment = { HOME: "/synthetic-private-home", TMPDIR: "/synthetic-private-home", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  try {
    expect(storeNotaryCredentials({ ...credentials, appPassword: credentials.appPassword + "\r\n" }, "/synthetic-private-home/keychain", environment)).toBeUndefined();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.program).toBe("/usr/bin/xcrun");
    expect(call.args).toEqual(["notarytool", "store-credentials", NOTARY_PROFILE, "--apple-id", credentials.appleId, "--team-id", credentials.team, "--keychain", "/synthetic-private-home/keychain"]);
    expect(call.options).toMatchObject({ env: environment, input: credentials.appPassword + "\n", timeout: 120_000, maxBuffer: 65_536, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    expect(JSON.stringify(call.args)).not.toContain(credentials.appPassword);
    expect(JSON.stringify(call.options.env)).not.toContain(credentials.appPassword);
  } finally { spawn.mockRestore(); }
});

function exercisePreflight(failedStage?: "create" | "store" | "delete") {
  const calls: Call[] = []; let scratch = "";
  const spawn = spyOn(childProcess, "spawnSync").mockImplementation((...values: unknown[]) => {
    const [program, args, options] = values as [string, readonly string[], childProcess.SpawnSyncOptions];
    calls.push({ program, args, options });
    const action = args[0];
    if (action === "create-keychain") {
      const keychain = args.at(-1)!; scratch = dirname(keychain);
      expect(lstatSync(scratch).mode & 0o777).toBe(0o700);
      writeFileSync(keychain, "synthetic-keychain", { mode: 0o600 });
      if (failedStage === "create") return result(1, "synthetic-private-error");
    }
    if (action === "notarytool" && failedStage === "store") return result(1, "App-specific password: Error: HTTP status code: 401. synthetic-private-error");
    if (action === "delete-keychain") {
      if (failedStage === "delete") throw { message: "synthetic-private-exception", code: "EACCES", path: scratch };
      rmSync(args[1]!);
    }
    return result();
  });
  try {
    const report = notaryPreflight(credentials);
    expect(scratch).toContain("textbutler-notary-preflight-");
    expect(existsSync(scratch)).toBe(false);
    expect(calls.at(-1)!.args).toEqual(["delete-keychain", join(scratch, "preflight.keychain-db")]);
    for (const call of calls) {
      expect(call.options.env).toEqual({ HOME: scratch, TMPDIR: scratch, PATH: "/usr/bin:/bin:/usr/sbin:/sbin" });
      expect(call.options.timeout).toBe(call.args[0] === "notarytool" ? 120_000 : 30_000);
      expect(call.options.maxBuffer).toBe(65_536);
    }
    const printed = JSON.stringify(report);
    for (const privateValue of [scratch, credentials.appleId, credentials.appPassword, credentials.team, "synthetic-private-error", "synthetic-private-stdout", "synthetic-private-exception"]) expect(printed).not.toContain(privateValue);
    return { report, calls };
  } finally { spawn.mockRestore(); if (scratch) rmSync(scratch, { recursive: true, force: true }); }
}

test("preflight stores and removes credentials in one fresh keychain with isolated process environment", () => {
  const { report, calls } = exercisePreflight();
  expect(report).toEqual({ schema: "textbutler.notary-preflight.v1", status: "passed", appleValidation: true, cleanup: "complete", failures: [] });
  expect(calls.map(call => call.args[0])).toEqual(["create-keychain", "set-keychain-settings", "unlock-keychain", "notarytool", "delete-keychain"]);
  const create = calls[0]!, unlock = calls[2]!;
  expect(create.args[2]).toMatch(/^[a-f0-9]{64}$/u);
  expect(unlock.args[2]).toBe(create.args[2]);
  expect(JSON.stringify(report)).not.toContain(create.args[2]!);
});

test("Apple rejection preserves safe classification and still removes the exact keychain", () => {
  const { report } = exercisePreflight("store");
  expect(report.status).toBe("failed"); expect(report.appleValidation).toBe(false); expect(report.cleanup).toBe("complete");
  expect(report.failures).toHaveLength(1);
  expect(report.failures[0]).toMatchObject({ stage: "notary-store-credentials", status: 1, diagnostic: "notary-http-401" });
});

test("partial keychain creation is cleaned and does not reach Apple", () => {
  const { report, calls } = exercisePreflight("create");
  expect(report.status).toBe("failed"); expect(report.appleValidation).toBe(false); expect(report.cleanup).toBe("complete");
  expect(calls.map(call => call.args[0])).toEqual(["create-keychain", "delete-keychain"]);
});

test("cleanup failure prevents success and still removes private temporary files", () => {
  const { report } = exercisePreflight("delete");
  expect(report.status).toBe("failed"); expect(report.appleValidation).toBe(true); expect(report.cleanup).toBe("incomplete");
  expect(report.failures[0]).toMatchObject({ stage: "keychain-delete", code: "EACCES" });
});

test("invalid preflight configuration does not spawn or allocate credentials", () => {
  const spawn = spyOn(childProcess, "spawnSync");
  try {
    const report = notaryPreflight({ ...credentials, appPassword: "private\ninternal" });
    expect(report.status).toBe("failed"); expect(report.appleValidation).toBe(false); expect(report.cleanup).toBe("complete");
    expect(report.failures).toEqual([{ stage: "configuration", reason: "preflight-step-failed" }]);
    expect(spawn).not.toHaveBeenCalled();
  } finally { spawn.mockRestore(); }
});

test("signing uses the shared validator and profile while preflight only reads its three inputs", () => {
  const signer = readFileSync(join(import.meta.dir, "sign.ts"), "utf8"), source = readFileSync(join(import.meta.dir, "notary-preflight.ts"), "utf8");
  expect(signer).toContain('from "./notary-preflight.ts"');
  expect(signer).toContain("storeNotaryCredentials(appCredentials, keychain, environment)");
  expect(signer).toContain('["--keychain-profile", NOTARY_PROFILE, "--keychain", keychain]');
  expect(source.match(/process\.env\.[A-Z_]+/gu)).toEqual(["process.env.APPLE_NOTARY_APPLE_ID", "process.env.APPLE_NOTARY_APP_PASSWORD", "process.env.APPLE_TEAM_ID"]);
  expect(source).toContain('process.platform === "darwin" && process.arch === "arm64" && process.argv.length === 2');
});
