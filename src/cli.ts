#!/usr/bin/env bun
import { runCommand } from "./commands.ts";
import { HELP } from "./command-input.ts";
import { terminalIntro } from "./cli-intro.ts";
import { errorMessage, exitCodeFor } from "./errors.ts";
import { processIo, type CommandIo } from "./io.ts";

export async function main(argv: readonly string[], io: CommandIo = processIo): Promise<number> {
  try {
    const rootHelp = argv.length === 0 || (argv.length === 1 && argv[0] === "--help");
    const output = rootHelp && io === processIo ? {
      ...io,
      stdout: (text: string) => io.stdout((text === HELP ? terminalIntro({ isTTY: process.stdout.isTTY, columns: process.stdout.columns, term: process.env.TERM }) : "") + text),
    } : io;
    await runCommand(argv, output);
    return 0;
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`);
    return exitCodeFor(error);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
