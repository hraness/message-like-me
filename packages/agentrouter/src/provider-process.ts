import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Transform } from "node:stream";
import type { SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";

/** Host-owned subprocess custody. Model-controlled tools cannot call this module. */
export function spawnBoundedProvider(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  onViolation: () => void;
}): { process: SpawnedProcess; stopAndJoin(): Promise<void>; isStopped(): boolean } {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("PROVIDER_PROCESS_PLATFORM_UNSUPPORTED");
  const child: ChildProcessWithoutNullStreams = spawn(input.executable, [...input.args], {
    cwd: input.cwd, env: { ...input.env }, detached: true, stdio: ["pipe", "pipe", "pipe"], shell: false,
  });
  let joined = false, failedBeforeSpawn = false, stopped = false, violated = false;
  let stdoutBytes = 0, lineBytes = 0, stderrBytes = 0;
  const violate = () => {
    if (violated) return;
    violated = true;
    input.onViolation();
    signalGroup("SIGTERM");
  };
  const boundedOutput = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      stdoutBytes += chunk.byteLength;
      let offset = 0;
      while (offset < chunk.byteLength) {
        const end = chunk.indexOf(10, offset);
        const boundary = end === -1 ? chunk.byteLength : end;
        lineBytes += boundary - offset;
        if (stdoutBytes > 8 * 1024 * 1024 || lineBytes > 1024 * 1024) {
          violate(); callback(new Error("PROVIDER_OUTPUT_LIMIT")); return;
        }
        if (end === -1) break;
        lineBytes = 0; offset = end + 1;
      }
      callback(null, chunk);
    },
  });
  // Keep failures scrubbed and observed even before the SDK subscribes to stdout.
  boundedOutput.on("error", () => {});
  child.stdout.on("error", () => { violate(); boundedOutput.destroy(new Error("PROVIDER_OUTPUT_FAILED")); });
  child.stdout.pipe(boundedOutput);
  child.stderr.on("data", (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > 256 * 1024) violate(); });
  child.stderr.on("error", violate);
  child.once("exit", () => { joined = true; });
  child.once("error", () => { if (child.pid === undefined) { failedBeforeSpawn = true; joined = true; } else violate(); });

  function groupExists(): boolean {
    if (failedBeforeSpawn) return false;
    if (child.pid === undefined) return true;
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; return true; }
  }
  function signalGroup(signal: NodeJS.Signals): boolean {
    if (child.pid === undefined) return false;
    try { process.kill(-child.pid, signal); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return true; return false; }
  }
  async function waitForStop(milliseconds: number): Promise<boolean> {
    const deadline = performance.now() + milliseconds;
    while (performance.now() < deadline) {
      if (joined && !groupExists()) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    return joined && !groupExists();
  }
  const providerProcess: SpawnedProcess = {
    stdin: child.stdin, stdout: boundedOutput,
    get killed() { return child.killed; }, get exitCode() { return child.exitCode; }, get signalCode() { return child.signalCode; },
    kill(signal) { return signalGroup(signal); },
    on(event, listener) { child.on(event, listener); },
    once(event, listener) { child.once(event, listener); },
    off(event, listener) { child.off(event, listener); },
  };
  return {
    process: providerProcess,
    isStopped: () => stopped,
    async stopAndJoin() {
      if (stopped) return;
      signalGroup("SIGTERM");
      if (!await waitForStop(1_000)) {
        signalGroup("SIGKILL");
        if (!await waitForStop(1_000)) throw new Error("PROVIDER_PROCESS_GROUP_EXIT_UNPROVEN");
      }
      stopped = true;
      boundedOutput.destroy();
    },
  };
}
