import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { command, DistributionCommandError, requireValue } from "./common.ts";

export const NOTARY_PROFILE = "textbutler-notary";
export type NotaryAppCredentials = Readonly<{ appleId: string; appPassword: string; team: string }>;

export function notaryAppCredentials(appleId: unknown, appPassword: unknown, team: unknown): NotaryAppCredentials {
  requireValue(typeof appleId === "string" && appleId.length <= 254 && /^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/u.test(appleId), "Invalid notarization Apple ID");
  requireValue(typeof team === "string" && /^[A-Z0-9]{10}$/u.test(team), "Invalid notarization team");
  requireValue(typeof appPassword === "string" && appPassword.length <= 2048, "Invalid notarization app password");
  const normalized = appPassword.replace(/[\r\n]+$/u, "");
  requireValue(normalized.length > 0 && normalized.length <= 1024 && !/[\s\u0000-\u001f\u007f]/u.test(normalized), "Invalid notarization app password");
  return Object.freeze({ appleId, appPassword: normalized, team });
}

// Both signing and preflight validate with Apple's service through the same
// secure-prompt stdin transport. Never add --no-validate or a password argument.
export function storeNotaryCredentials(credentials: NotaryAppCredentials, keychain: string, environment: Record<string, string>): void {
  const validated = notaryAppCredentials(credentials.appleId, credentials.appPassword, credentials.team);
  command("/usr/bin/xcrun", ["notarytool", "store-credentials", NOTARY_PROFILE, "--apple-id", validated.appleId, "--team-id", validated.team, "--keychain", keychain], {
    stage: "notary-store-credentials", environment, timeout: 120_000, maximum: 65_536, input: `${validated.appPassword}\n`,
  });
}

type Step = "platform" | "configuration" | "temporary-storage" | "cleanup";
type Failure = DistributionCommandError["details"] | Readonly<{ stage: Step; reason: "preflight-step-failed" }>;
type PreflightReport = Readonly<{ schema: "textbutler.notary-preflight.v1"; status: "passed" | "failed"; appleValidation: boolean; cleanup: "complete" | "incomplete"; failures: readonly Failure[] }>;
function safeFailure(error: unknown, stage: Step): Failure {
  return error instanceof DistributionCommandError ? error.details : { stage, reason: "preflight-step-failed" };
}

// Only the freshly created physical directory and its exact keychain are owned.
// The caller receives no credential material or child output in the report.
export function notaryPreflight(credentials: NotaryAppCredentials): PreflightReport {
  let scratch: string | undefined, identity: ReturnType<typeof lstatSync> | undefined;
  let keychain: string | undefined, keychainAttempted = false, appleValidation = false, cleanup = true;
  let step: Step = "configuration";
  const failures: Failure[] = [];
  const environment = { HOME: "", TMPDIR: "", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  try {
    const validated = notaryAppCredentials(credentials.appleId, credentials.appPassword, credentials.team);
    step = "temporary-storage";
    // Do not inherit HOME, TMPDIR, provider credentials, or tool configuration.
    scratch = mkdtempSync(join(realpathSync("/tmp"), "textbutler-notary-preflight-"));
    identity = lstatSync(scratch); chmodSync(scratch, 0o700);
    requireValue(identity.isDirectory() && identity.uid === process.getuid!() && (lstatSync(scratch).mode & 0o777) === 0o700, "Unsafe preflight directory");
    environment.HOME = scratch; environment.TMPDIR = scratch;
    keychain = join(scratch, "preflight.keychain-db");
    const keychainPassword = randomBytes(32).toString("hex");
    keychainAttempted = true;
    command("/usr/bin/security", ["create-keychain", "-p", keychainPassword, keychain], { stage: "keychain-create", environment, timeout: 30_000, maximum: 65_536 });
    command("/usr/bin/security", ["set-keychain-settings", "-lut", "300", keychain], { stage: "keychain-configure", environment, timeout: 30_000, maximum: 65_536 });
    command("/usr/bin/security", ["unlock-keychain", "-p", keychainPassword, keychain], { stage: "keychain-unlock", environment, timeout: 30_000, maximum: 65_536 });
    storeNotaryCredentials(validated, keychain, environment);
    appleValidation = true;
  } catch (error) { failures.push(safeFailure(error, step)); }
  finally {
    if (scratch) {
      try {
        const actual = lstatSync(scratch);
        requireValue(identity && actual.isDirectory() && !actual.isSymbolicLink() && actual.dev === identity.dev && actual.ino === identity.ino && actual.uid === process.getuid!(), "Preflight directory identity changed");
        try {
          if (keychainAttempted && keychain && existsSync(keychain)) {
            const file = lstatSync(keychain);
            requireValue(file.isFile() && !file.isSymbolicLink() && file.uid === process.getuid!(), "Unsafe preflight keychain");
            command("/usr/bin/security", ["delete-keychain", keychain], { stage: "keychain-delete", environment, timeout: 30_000, maximum: 65_536 });
            requireValue(!existsSync(keychain), "Preflight keychain remains");
          }
        } catch (error) { cleanup = false; failures.push(safeFailure(error, "cleanup")); }
        finally { rmSync(scratch, { recursive: true, force: true }); }
      } catch (error) { cleanup = false; failures.push(safeFailure(error, "cleanup")); }
    }
  }
  return { schema: "textbutler.notary-preflight.v1", status: failures.length ? "failed" : "passed", appleValidation, cleanup: cleanup ? "complete" : "incomplete", failures };
}

if (import.meta.main) {
  let report: PreflightReport;
  let step: Step = "platform";
  try {
    requireValue(process.platform === "darwin" && process.arch === "arm64" && process.argv.length === 2, "Expected macOS arm64 without arguments");
    step = "configuration";
    report = notaryPreflight(notaryAppCredentials(process.env.APPLE_NOTARY_APPLE_ID, process.env.APPLE_NOTARY_APP_PASSWORD, process.env.APPLE_TEAM_ID));
  } catch (error) {
    report = { schema: "textbutler.notary-preflight.v1", status: "failed", appleValidation: false, cleanup: "complete", failures: [safeFailure(error, step)] };
  }
  (report.status === "passed" ? console.log : console.error)(JSON.stringify(report));
  if (report.status === "failed") process.exitCode = 1;
}
