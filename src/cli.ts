#!/usr/bin/env bun
import { runCommand } from "./commands.ts";
import { errorMessage, exitCodeFor } from "./errors.ts";
import { processIo, type CommandIo } from "./io.ts";

export async function main(argv: readonly string[], io: CommandIo = processIo): Promise<number> {
  try {
    await runCommand(argv, io);
    return 0;
  } catch (error) {
    io.stderr(`${errorMessage(error)}\n`);
    return exitCodeFor(error);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
