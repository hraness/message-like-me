import { expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { inspect } from "node:util";
import { command, DistributionCommandError, type CommandStage } from "./common.ts";

test("paths and metacharacters remain literal arguments without a shell", () => {
  const argument = "a path with spaces/'quotes'/$HOME;$(echo expanded)|&<>`echo expanded`";
  expect(command(process.execPath, ["-e", "process.stdout.write(process.argv.at(-1))", argument]).toString("utf8")).toBe(argument);
});

function failureOf(run: () => unknown): DistributionCommandError {
  let failure: unknown;
  try { run(); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(DistributionCommandError);
  if (!(failure instanceof DistributionCommandError)) throw new Error("Expected a safe distribution command failure");
  return failure;
}
function remainsPrivate(failure: unknown, secrets: readonly string[]): void {
  const diagnostic = `${String(failure)}\n${inspect(failure, { showHidden: true, depth: null })}\n${JSON.stringify(failure)}`;
  for (const secret of secrets) expect(diagnostic).not.toContain(secret);
  expect(failure).not.toHaveProperty("cause");
}

test("successful commands preserve stdout bytes and piped input", () => {
  const input = Buffer.from([0, 255, 10, 127]);
  const output = command(process.execPath, ["-e", 'process.stdout.write(require("node:fs").readFileSync(0))'], { input });
  expect(Buffer.isBuffer(output)).toBe(true);
  expect(output).toEqual(input);
});

test("failed commands identify the stage and exit status without exposing child inputs or output", () => {
  const failure = failureOf(() => command(process.execPath, ["-e", 'process.stdout.write(process.argv.at(-1)); process.stderr.write(process.env.PRIVATE_VALUE + require("node:fs").readFileSync(0, "utf8")); process.exit(27)', "synthetic-argv-secret"], {
      stage: "notary-store-credentials", environment: { PRIVATE_VALUE: "synthetic-environment-secret" }, input: "synthetic-input-secret",
    }));
  expect(failure.details).toEqual({ stage: "notary-store-credentials", status: 27, signal: null, code: null, diagnostic: null });
  expect(failure.message).toBe('Distribution command failed: {"stage":"notary-store-credentials","status":27,"signal":null,"code":null,"diagnostic":null}');
  expect(Object.isFrozen(failure.details)).toBe(true);
  remainsPrivate(failure, ["synthetic-argv-secret", "synthetic-environment-secret", "synthetic-input-secret"]);
});

test("a missing executable exposes ENOENT without the program name or path", () => {
  const failure = failureOf(() => command("/synthetic-private-directory/synthetic-private-program", ["synthetic-private-argument"]));
  expect(failure.details).toEqual({ stage: "command", status: null, signal: null, code: "ENOENT", diagnostic: null });
  remainsPrivate(failure, ["synthetic-private-directory", "synthetic-private-program", "synthetic-private-argument", "syscall", "spawnargs"]);
});

test("timeouts expose the fixed timeout code and termination signal", () => {
  const failure = failureOf(() => command("/bin/sleep", ["10"], { stage: "notary-wait", timeout: 20 }));
  expect(failure.details).toEqual({ stage: "notary-wait", status: null, signal: "SIGKILL", code: "ETIMEDOUT", diagnostic: null });
});

test("signal termination remains distinct from numeric exit failure", () => {
  const failure = failureOf(() => command(process.execPath, ["-e", 'process.kill(process.pid, "SIGTERM")'], { stage: "notary-submit" }));
  expect(failure.details).toEqual({ stage: "notary-submit", status: null, signal: "SIGTERM", code: null, diagnostic: null });
});

test("output limits preserve the spawn error code without exposing buffered output", () => {
  const secret = "synthetic-buffer-limit-secret";
  const failure = failureOf(() => command(process.execPath, ["-e", 'process.stdout.write(process.argv.at(-1).repeat(1000))', secret], { maximum: 64 }));
  expect(failure.details.code).toBe("ENOBUFS");
  remainsPrivate(failure, [secret]);
});

test("synchronous spawn argument errors never expose the invalid value", () => {
  const failure = failureOf(() => command("synthetic-invalid-program\u0000", []));
  expect(failure.details.stage).toBe("command");
  expect(failure.details.status).toBeNull();
  remainsPrivate(failure, ["synthetic-invalid-program"]);
});

test("spawn exceptions retain only an allowlisted code, including non-Error objects", () => {
  const secret = "synthetic-spawn-exception-secret";
  const error = Object.assign(new Error(secret), { code: "EACCES", path: secret, syscall: secret, cause: { secret } });
  const values = [error, { code: "EACCES", message: secret, path: secret, syscall: secret, cause: { secret } }];
  for (const value of values) {
    const spawn = spyOn(childProcess, "spawnSync").mockImplementation(() => { throw value; });
    try {
      const failure = failureOf(() => command("unused", []));
      expect(failure.details).toEqual({ stage: "command", status: null, signal: null, code: "EACCES", diagnostic: null });
      remainsPrivate(failure, [secret, "syscall", "cause"]);
    } finally { spawn.mockRestore(); }
  }
});

test("unknown exception values and throwing code getters cannot escape or be coerced", () => {
  const secret = "synthetic-unknown-exception-secret";
  const values: unknown[] = [secret, null, undefined, false, { code: secret, toString() { throw new Error(secret); } }, { get code(): never { throw new Error(secret); } }];
  for (const value of values) {
    const spawn = spyOn(childProcess, "spawnSync").mockImplementation(() => { throw value; });
    try {
      const failure = failureOf(() => command("unused", []));
      expect(failure.details).toEqual({ stage: "command", status: null, signal: null, code: null, diagnostic: null });
      remainsPrivate(failure, [secret]);
    } finally { spawn.mockRestore(); }
  }
});

test("runtime stage injection is rejected before spawning without echoing the stage", () => {
  const secret = "synthetic-stage-secret";
  const spawn = spyOn(childProcess, "spawnSync");
  try {
    let failure: unknown;
    try { command("unused", [], { stage: secret as CommandStage }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toHaveProperty("message", "Invalid distribution command stage");
    remainsPrivate(failure, [secret]);
    expect(spawn).not.toHaveBeenCalled();
  } finally { spawn.mockRestore(); }
});

test("failure metadata rejects arbitrary strings and nonfinite status", () => {
  const secret = "synthetic-metadata-secret";
  for (const status of [secret, Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
    const failure = new DistributionCommandError(secret as CommandStage, status, secret, { code: secret, message: secret });
    expect(failure.details).toEqual({ stage: "command", status: null, signal: null, code: null, diagnostic: null });
    remainsPrivate(failure, [secret]);
  }
});

test("notary credential HTTP 401 is classified without copying adjacent private output", () => {
  const secret = "synthetic-notary-account-secret";
  const failure = failureOf(() => command(process.execPath, ["-e", 'process.stderr.write("Validating credentials...\\nError: HTTP status code: 401. " + process.argv.at(-1)); process.exit(1)', secret], { stage: "notary-store-credentials" }));
  expect(failure.details).toEqual({ stage: "notary-store-credentials", status: 1, signal: null, code: null, diagnostic: "notary-http-401" });
  remainsPrivate(failure, [secret, "Validating credentials", "Error: HTTP status code"]);
});

test("notary classification requires the exact bounded diagnostic and failure stage", () => {
  const known = Buffer.from("Error: HTTP status code: 401. private suffix");
  for (const [stage, status, signal, error, stderr] of [
    ["command", 1, null, undefined, known],
    ["notary-store-credentials", 0, null, undefined, known],
    ["notary-store-credentials", null, "SIGKILL", { code: "ETIMEDOUT" }, known],
    ["notary-store-credentials", 1, null, undefined, Buffer.from("Error: HTTP status code: 418. private suffix")],
    ["notary-store-credentials", 1, null, undefined, Buffer.from("Error: HTTP status code: 401.private suffix")],
    ["notary-store-credentials", 1, null, undefined, Buffer.concat([Buffer.alloc(65_536, 10), known])],
  ] as const) expect(new DistributionCommandError(stage, status, signal, error, stderr).details.diagnostic).toBeNull();
});

test("notary secure prompt may prefix the fixed HTTP diagnostic on the same line", () => {
  const secret = "synthetic-prompt-secret";
  const failure = new DistributionCommandError("notary-store-credentials", 1, null, undefined, Buffer.from(`App-specific password for ${secret}: Error: HTTP status code: 401. Invalid credentials.`));
  expect(failure.details.diagnostic).toBe("notary-http-401");
  remainsPrivate(failure, [secret, "App-specific password", "Invalid credentials"]);
});

test("notary HTTP status diagnostics classify stdout without retaining the surrounding output", () => {
  const secret = "synthetic-private-stdout-secret";
  const failure = failureOf(() => command(process.execPath, ["-e", 'process.stdout.write("App-specific password: Error: HTTP status code: 403. " + process.argv.at(-1)); process.exit(1)', secret], { stage: "notary-store-credentials" }));
  expect(failure.details.diagnostic).toBe("notary-http-403");
  remainsPrivate(failure, [secret, "App-specific password", "HTTP status code"]);
});

test("each fixed HTTP status token is recognized in either stream with prompt prefixes", () => {
  for (const status of [401, 403, 404, 429, 500, 502, 503] as const) {
    const token = Buffer.from(`synthetic-private-prompt: HTTP status code: ${status}. synthetic-private-suffix`);
    for (const [stderr, stdout] of [[token, Buffer.alloc(0)], [Buffer.alloc(0), token], [token, token]]) {
      const failure = new DistributionCommandError("notary-store-credentials", 1, null, undefined, stderr, stdout);
      expect(failure.details.diagnostic).toBe(`notary-http-${status}`);
      remainsPrivate(failure, ["synthetic-private-prompt", "synthetic-private-suffix", "HTTP status code"]);
    }
  }
});

test("different recognized statuses conflict within one stream or across streams", () => {
  const first = Buffer.from("Error: HTTP status code: 401. synthetic-first-secret\n"), second = Buffer.from("Error: HTTP status code: 503. synthetic-second-secret");
  for (const [stderr, stdout] of [[first, second], [second, first], [Buffer.concat([first, second]), Buffer.alloc(0)], [Buffer.alloc(0), Buffer.concat([second, first])]]) {
    const failure = new DistributionCommandError("notary-store-credentials", 1, null, undefined, stderr, stdout);
    expect(failure.details.diagnostic).toBeNull();
    remainsPrivate(failure, ["synthetic-first-secret", "synthetic-second-secret", "HTTP status code"]);
  }
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, Buffer.concat([first, first])).details.diagnostic).toBe("notary-http-401");
  const unknown = Buffer.from("HTTP status code: 402.\n");
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, first, unknown).details.diagnostic).toBeNull();
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, unknown, first).details.diagnostic).toBeNull();
});

test("both output streams must fit their independent bound before any status is classified", () => {
  const token = Buffer.from("Error: HTTP status code: 429.\n"), exact = Buffer.concat([Buffer.alloc(65_536 - token.length, 10), token]);
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, exact, exact).details.diagnostic).toBe("notary-http-429");
  const oversized = Buffer.concat([exact, Buffer.from("x")]);
  for (const [stderr, stdout] of [[token, oversized], [oversized, token], [Buffer.alloc(0), oversized], [oversized, Buffer.alloc(0)]]) {
    expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, stderr, stdout).details.diagnostic).toBeNull();
  }
});

test("stdout classification retains the failure gates and rejects malformed tokens and output values", () => {
  const token = Buffer.from("Error: HTTP status code: 500.\n");
  for (const [stage, status, signal, error] of [
    ["command", 1, null, undefined], ["notary-submit", 1, null, undefined], ["notary-store-credentials", 0, null, undefined],
    ["notary-store-credentials", 2, null, undefined], ["notary-store-credentials", 1, "SIGKILL", undefined],
    ["notary-store-credentials", 1, null, { code: "ENOBUFS" }],
  ] as const) expect(new DistributionCommandError(stage, status, signal, error, Buffer.alloc(0), token).details.diagnostic).toBeNull();
  for (const output of ["HTTP status code: 500.", "HTTP status code: 5000.\n", "HTTP status code: 500.private", "HTTP status code: 418.\n", "HTTP status code: 500\n"]) {
    // Raw strings are not child-process buffers, even when their text matches.
    expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, Buffer.alloc(0), output).details.diagnostic).toBeNull();
    if (output !== "HTTP status code: 500.") expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, Buffer.alloc(0), Buffer.from(output)).details.diagnostic).toBeNull();
  }
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, null, token).details.diagnostic).toBeNull();
});

test("observed fixed Apple diagnostics classify either bounded stream without exposing adjacent secrets", () => {
  const cases = [
    ["FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED", "notary-agreements-required"],
    ["Invalid or inaccessible developer team ID for the provided Apple ID.", "notary-team-inaccessible"],
    ["An error occurred while accessing the keychain.", "notary-keychain-error"],
    ['Could not open keychain "synthetic-private-keychain-path"', "notary-keychain-error"],
    ["Credential validation failed. Please verify your inputs.", "notary-credential-validation-failed"],
    ["HTTP Error response was missing error details.", "notary-http-error-without-details"],
  ] as const;
  for (const [literal, diagnostic] of cases) {
    const output = Buffer.from(`synthetic-private-prefix: ${literal} synthetic-private-suffix`);
    for (const [stderr, stdout] of [[output, Buffer.alloc(0)], [Buffer.alloc(0), output]]) {
      const failure = new DistributionCommandError("notary-store-credentials", 1, null, undefined, stderr, stdout);
      expect(failure.details.diagnostic).toBe(diagnostic);
      remainsPrivate(failure, ["synthetic-private-prefix", "synthetic-private-suffix", "synthetic-private-keychain-path", literal]);
    }
  }
});

test("HTTP observations take priority while conflicting or unallowlisted HTTP never falls back", () => {
  const literal = Buffer.from("Credential validation failed. Please verify your inputs.\nFORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED");
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, literal).details.diagnostic).toBe("notary-agreements-required");
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, literal, Buffer.from("HTTP status code: 403.\n")).details.diagnostic).toBe("notary-http-403");
  for (const output of ["HTTP status code: 402.\n", "HTTP status code: 401.\nHTTP status code: 403.\n"]) {
    expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, literal, Buffer.from(output)).details.diagnostic).toBeNull();
  }
});

test("fixed Apple diagnostics require exact literals and all normal failure and stream bounds", () => {
  const literal = Buffer.from("Credential validation failed. Please verify your inputs.");
  for (const [stage, status, signal, error] of [
    ["command", 1, null, undefined], ["notary-store-credentials", 0, null, undefined],
    ["notary-store-credentials", 1, "SIGKILL", undefined], ["notary-store-credentials", 1, null, { code: "ENOBUFS" }],
  ] as const) expect(new DistributionCommandError(stage, status, signal, error, literal).details.diagnostic).toBeNull();
  for (const output of ["Credential validation failed", "The keychain is unavailable.", "Invalid credentials.", "FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRE"]) {
    expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, Buffer.from(output)).details.diagnostic).toBeNull();
  }
  const oversized = Buffer.concat([literal, Buffer.alloc(65_536)]);
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, oversized, literal).details.diagnostic).toBeNull();
  expect(new DistributionCommandError("notary-store-credentials", 1, null, undefined, literal, oversized).details.diagnostic).toBeNull();
});
