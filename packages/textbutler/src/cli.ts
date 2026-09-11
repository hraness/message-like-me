import { initializeOwnerState, TEXTBUTLER_CONTROL_PROTOCOL } from "./control-service.ts";
import { defaultDataDirectory, requestDaemon, startDaemon } from "./daemon.ts";

export const CLI_USAGE = "textbutler init|doctor|daemon run|daemon status [--data-dir /physical/private/path]";
export async function runTextbutlerCli(argv: readonly string[], output: { write(text: string): unknown } = process.stdout): Promise<number> {
  if (argv.length === 0 || argv.length === 1 && ["--help", "help", "-h"].includes(argv[0]!)) { output.write(`${CLI_USAGE}\n`); return 0; }
  const args = [...argv]; let dataDir = defaultDataDirectory();
  const option = args.indexOf("--data-dir");
  if (option !== -1) {
    if (option !== args.length - 2 || args[option + 1] === undefined || !args[option + 1]!.startsWith("/")) throw new Error(CLI_USAGE);
    dataDir = args[option + 1]!; args.splice(option, 2);
  }
  const command = args.join(" ");
  if (!["init", "doctor", "daemon run", "daemon status"].includes(command)) throw new Error(CLI_USAGE);
  const print = (value: unknown): void => { output.write(`${JSON.stringify(value)}\n`); };
  if (command === "init") {
    const state = await initializeOwnerState(dataDir);
    print({ ok: true, status: "initialized", dataDir: state.dataDir, automation: "unavailable", detail: "Owner settings are private and paused. No contacts, providers, agents, or launch agents were installed." });
    return 0;
  }
  if (command === "doctor" || command === "daemon status") {
    try {
      const response = await requestDaemon({ dataDir, request: { protocol: TEXTBUTLER_CONTROL_PROTOCOL, command: "snapshot" } });
      print(command === "doctor" ? { ok: response.ok, platform: process.platform, supportedPlatform: process.platform === "darwin", daemon: response, automaticReplies: "unavailable" } : response);
      return response.ok ? 0 : 1;
    } catch {
      print({ ok: false, status: "disconnected", platform: process.platform, automaticReplies: "unavailable", detail: "No qualified owner-only Textbutler control daemon is reachable. Start it with textbutler daemon run." });
      return 1;
    }
  }
  if (process.platform !== "darwin") throw new Error("The Textbutler foreground daemon is supported on macOS only.");
  const daemon = await startDaemon({ dataDir });
  print({ ok: true, status: "running", socketPath: daemon.socketPath, automation: "unavailable", detail: "Foreground owner control service; settings and contact memory are available. Automatic replies are not active." });
  await new Promise<void>(resolve_ => {
    const stopped = (): void => { process.off("SIGINT", stopped); process.off("SIGTERM", stopped); resolve_(); };
    process.once("SIGINT", stopped); process.once("SIGTERM", stopped);
  });
  await daemon.close();
  return 0;
}
if (import.meta.main) {
  try { process.exitCode = await runTextbutlerCli(process.argv.slice(2)); }
  catch (error) { process.stderr.write(`${error instanceof Error && error.message === CLI_USAGE ? CLI_USAGE : "Textbutler could not start. Check the physical private data directory, existing socket ownership, and current runtime."}\n`); process.exitCode = 1; }
}
