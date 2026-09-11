import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { GhostgetInvocation, GhostgetInvoker } from "./ghostget";
import { canonicalJson, digest, object, string } from "./validation";

export interface GhostgetCliOptions {
  /** Trusted application configuration; never supplied by a model or hook. */
  readonly executable: string;
  /** Exact admitted Bun runtime for Ghostget's source CLI; defaults to this Bun process. */
  readonly runtimeExecutable?: string;
  readonly stateHome?: string;
  readonly timeoutMs?: number;
}
function sha(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function readPrivate(path: string): Record<string, unknown> {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) throw new Error("Invalid private Ghostget artifact");
    return object(JSON.parse(readFileSync(fd, "utf8")));
  } finally { closeSync(fd); }
}
/** Only existing public commands; no raw argv, shell, database, or administrative socket. */
export function ghostgetCommand(request: GhostgetInvocation, output: string, binding: string): readonly string[] {
  if (request.command === "capabilities") {
    if (request.adapterId !== "imessage-direct" && request.adapterId !== "whatsapp-web") throw new Error("Unsupported Ghostget adapter");
    return ["capabilities", request.adapterId, "--json"];
  }
  if (request.command === "confirm") return ["confirm", digest(request.planDigest), "--private-output", output, "--receipt-binding-output", binding, "--json"];
  const operations = { "messaging.routes": "routes", "messaging.resolve": "resolve", "messaging.context": "context", "messaging.preview": "preview" } as const;
  const operation = operations[request.command];
  if (operation === undefined) throw new Error("Unsupported Ghostget command");
  return ["messaging", operation, "--input", "-", "--private-output", output, "--json"];
}
function processRun(executable: string, argv: readonly string[], input: string, environment: Record<string, string>, timeoutMs: number): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { env: environment, stdio: ["pipe", "pipe", "pipe"], shell: false, detached: process.platform !== "win32" });
    const chunks: Buffer[] = []; let outputBytes = 0, errorBytes = 0, failed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const signal = (name: NodeJS.Signals): void => { try { if (child.pid !== undefined && process.platform !== "win32") process.kill(-child.pid, name); else child.kill(name); } catch { /* close owns completion */ } };
    const stop = (): void => { if (failed) return; failed = true; signal("SIGTERM"); killTimer = setTimeout(() => signal("SIGKILL"), 1000); };
    const deadline = setTimeout(stop, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { outputBytes += chunk.length; if (outputBytes > 65536) stop(); else chunks.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { errorBytes += chunk.length; if (errorBytes > 65536) stop(); });
    child.stdin.on("error", stop);
    child.once("error", () => { clearTimeout(deadline); if (killTimer !== undefined) clearTimeout(killTimer); reject(new Error("Ghostget process unavailable")); });
    child.once("close", code => { clearTimeout(deadline); if (killTimer !== undefined) clearTimeout(killTimer); if (failed || code === null) reject(new Error("Ghostget process outcome unavailable")); else resolve({ stdout: Buffer.concat(chunks).toString("utf8"), code }); });
    child.stdin.end(input);
  });
}

/** Trusted daemon-side invoker. This capability must never be handed to an agent. */
export function createGhostgetCliInvoker(options: GhostgetCliOptions): GhostgetInvoker {
  if (!isAbsolute(string(options.executable, 4096)) || options.stateHome !== undefined && !isAbsolute(options.stateHome)) throw new Error("Ghostget paths must be absolute trusted configuration");
  const runtimeExecutable = options.runtimeExecutable ?? (process.versions.bun === undefined ? undefined : process.execPath);
  if (runtimeExecutable === undefined || !isAbsolute(runtimeExecutable)) throw new Error("An exact admitted Bun runtime is required");
  const timeoutMs = options.timeoutMs ?? 120000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error("Invalid Ghostget timeout");
  return async request => {
    const directory = mkdtempSync(join(tmpdir(), "textbutler-ghostget-")); chmodSync(directory, 0o700);
    const outputPath = join(directory, "artifact.json"), bindingPath = join(directory, "binding.json");
    try {
      const environment: Record<string, string> = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
      for (const key of ["HOME", "USER", "LOGNAME", "TMPDIR"]) if (process.env[key] !== undefined) environment[key] = process.env[key]!;
      if (options.stateHome !== undefined) environment.GHOSTGET_STATE_HOME = options.stateHome;
      const input = "input" in request ? JSON.stringify(request.input) : "";
      if (Buffer.byteLength(input) > 512 * 1024) throw new Error("Ghostget input too large");
      const result = await processRun(runtimeExecutable, [options.executable, ...ghostgetCommand(request, outputPath, bindingPath)], input, environment, timeoutMs);
      const receipt = object(JSON.parse(result.stdout));
      if (request.command === "capabilities") { if (result.code !== 0) throw new Error("Ghostget catalog unavailable"); return receipt; }
      const artifact = readPrivate(outputPath);
      if (request.command === "confirm") {
        // Nonzero 3/5 is a valid settled failed/partial/indeterminate Ghostget run.
        if (![0, 3, 5].includes(result.code) || receipt.format !== "wrench.messaging-run-receipt" || receipt.schemaVersion !== 2) throw new Error("Invalid Ghostget terminal receipt");
        const binding = readPrivate(bindingPath), { receiptSha256, ...core } = binding;
        if (binding.format !== "wrench.messaging-receipt-binding" || binding.schemaVersion !== 2 || digest(receiptSha256) !== sha(core) || receipt.receiptBindingSha256 !== receiptSha256) throw new Error("Invalid Ghostget binding");
        for (const key of ["planDigest", "runId", "state", "partCount", "provenPartCount", "clientIntentSha256", "turnDigest", "previewDigest", "recordedAt"]) if (receipt[key] !== artifact[key]) throw new Error("Ghostget run changed");
        for (const key of ["runId", "state", "partCount", "provenPartCount", "clientIntentSha256", "turnDigest", "previewDigest", "recordedAt"]) if (receipt[key] !== binding[key]) throw new Error("Ghostget binding changed");
        return artifact;
      }
      if (result.code !== 0 || receipt.schemaVersion !== 1 || receipt.format !== "wrench.messaging-private-output-receipt" || receipt.artifactFormat !== artifact.format || digest(receipt.artifactSha256) !== sha(artifact)) throw new Error("Ghostget artifact receipt mismatch");
      return artifact;
    } finally { rmSync(directory, { recursive: true, force: true }); }
  };
}
