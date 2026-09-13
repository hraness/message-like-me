import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Credential-free native proof of the signer's piped secure prompt. This never
// validates with Apple, signs an app, or reads an existing keychain item.
// --no-validate belongs only in this synthetic smoke test, never in sign.ts.
const schema = "textbutler.notary-prompt-smoke.v1";
const synthetic = { appleId: "notary-prompt-smoke@example.invalid", team: "XXXXXXXXXX", password: "aaaa-bbbb-cccc-dddd", keychainPassword: "textbutler-synthetic-keychain-password" };
type Step = "platform" | "controlling-terminal" | "scratch" | "toolchain" | "search-list-before" | "create-keychain" | "unlock-keychain" | "search-list-created" | "store-credentials" | "delete-keychain" | "search-list-after" | "cleanup";
class SmokeFailure extends Error {
  constructor(readonly step: Step, readonly status: number | null = null, readonly signal: string | null = null, readonly reason = "assertion") { super(step); }
}
function requireSmoke(value: unknown, step: Step): asserts value { if (!value) throw new SmokeFailure(step); }
function controllingTerminal(): boolean {
  try { const fd = openSync("/dev/tty", constants.O_RDWR | constants.O_NONBLOCK | constants.O_NOCTTY); closeSync(fd); return true; }
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error.code === "ENXIO" || error.code === "ENOTTY")) return false;
    throw new SmokeFailure("controlling-terminal", null, null, "terminal-state-unavailable");
  }
}

if (import.meta.main) {
  let scratch: string | undefined, scratchIdentity: ReturnType<typeof lstatSync> | undefined;
  let keychain: string | undefined, keychainAttempted = false, searchList: Buffer | undefined;
  let failure: unknown;
  const failures: SmokeFailure[] = [];
  const environment = { HOME: process.env.HOME ?? "", TMPDIR: "", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
  const run = (step: Step, program: string, args: readonly string[], input?: string): Buffer => {
    const result = spawnSync(program, args, { env: environment, input, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 65_536 });
    if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
      const code = result.error && "code" in result.error ? result.error.code : undefined;
      // Never print arguments, child output, or arbitrary system error strings.
      const reason = code === "ETIMEDOUT" ? "timeout" : code === "ENOENT" ? "executable-missing" : code === "EACCES" ? "access-denied" : result.error ? "spawn-error" : "child-failed";
      throw new SmokeFailure(step, result.status, result.signal === "SIGKILL" ? "SIGKILL" : result.signal ? "other" : null, reason);
    }
    return result.stdout;
  };
  try {
    requireSmoke(process.platform === "darwin" && process.argv.length === 2, "platform");
    const hasControllingTerminal = controllingTerminal();
    console.log(JSON.stringify({ schema, status: "starting", controllingTerminal: hasControllingTerminal }));
    // getpass prefers /dev/tty over stdin. A terminal session cannot prove the
    // credential-free runner's headless transport and must fail before writes.
    requireSmoke(!hasControllingTerminal, "controlling-terminal");
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "textbutler-notary-prompt-smoke-")));
    chmodSync(scratch, 0o700); scratchIdentity = lstatSync(scratch);
    requireSmoke(scratchIdentity.isDirectory() && scratchIdentity.uid === process.getuid!() && (scratchIdentity.mode & 0o777) === 0o700, "scratch");
    environment.TMPDIR = scratch;
    keychain = join(scratch, "synthetic.keychain-db");
    const notarytool = run("toolchain", "/usr/bin/xcrun", ["notarytool", "--version"]).toString("utf8").trim();
    const macOS = run("toolchain", "/usr/bin/sw_vers", ["-productVersion"]).toString("utf8").trim();
    requireSmoke(/^\d+\.\d+\.\d+ \(\d+\)$/u.test(notarytool) && /^\d+\.\d+(?:\.\d+)?$/u.test(macOS), "toolchain");
    console.log(JSON.stringify({ schema, status: "toolchain", notarytool, macOS, architecture: process.arch }));
    searchList = run("search-list-before", "/usr/bin/security", ["list-keychains", "-d", "user"]);
    keychainAttempted = true;
    run("create-keychain", "/usr/bin/security", ["create-keychain", "-p", synthetic.keychainPassword, keychain]);
    requireSmoke(run("search-list-created", "/usr/bin/security", ["list-keychains", "-d", "user"]).equals(searchList), "search-list-created");
    run("unlock-keychain", "/usr/bin/security", ["unlock-keychain", "-p", synthetic.keychainPassword, keychain]);
    run("store-credentials", "/usr/bin/xcrun", ["notarytool", "store-credentials", "textbutler-notary", "--apple-id", synthetic.appleId, "--team-id", synthetic.team, "--keychain", keychain, "--no-validate"], `${synthetic.password}\n`);
  } catch (error) { failure = error; }
  finally {
    if (scratch && scratchIdentity) {
      try {
        const actual = lstatSync(scratch);
        requireSmoke(actual.isDirectory() && actual.dev === scratchIdentity.dev && actual.ino === scratchIdentity.ino && actual.uid === process.getuid!(), "cleanup");
        try {
          if (keychainAttempted && keychain && existsSync(keychain)) {
            const file = lstatSync(keychain);
            requireSmoke(file.isFile() && !file.isSymbolicLink() && file.uid === process.getuid!(), "cleanup");
            run("delete-keychain", "/usr/bin/security", ["delete-keychain", keychain]);
            requireSmoke(!existsSync(keychain), "delete-keychain");
          }
        } finally { rmSync(scratch, { recursive: true, force: true }); }
      } catch (error) { failures.push(error instanceof SmokeFailure ? error : new SmokeFailure("cleanup")); }
      if (searchList) {
        try { requireSmoke(run("search-list-after", "/usr/bin/security", ["list-keychains", "-d", "user"]).equals(searchList), "search-list-after"); }
        catch (error) { failures.push(error instanceof SmokeFailure ? error : new SmokeFailure("search-list-after")); }
      }
    }
  }
  if (failure !== undefined) failures.unshift(failure instanceof SmokeFailure ? failure : new SmokeFailure("scratch"));
  if (failures.length) {
    console.error(JSON.stringify({ schema, status: "failed", failures: failures.map(({ step, status, signal, reason }) => ({ step, exitStatus: status, signal, reason })) }));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ schema, status: "passed", passwordInput: "stdin", appleValidation: false, searchListUnchanged: true, cleanup: "complete" }));
}
