import { CliError } from "./errors.ts";

const VALUE_OPTIONS = new Set([
  "addressbook",
  "burst-gap",
  "data-dir",
  "database",
  "limit",
  "min-outgoing",
  "output",
  "project",
  "scope",
  "session-gap",
  "target",
]);
const FLAG_OPTIONS = new Set(["force", "help", "json", "private", "version"]);

export type ParsedArguments = Readonly<{
  positionals: readonly string[];
  options: ReadonlyMap<string, string>;
  flags: ReadonlySet<string>;
}>;

export function parseArguments(argv: readonly string[]): ParsedArguments {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (positionalOnly || !argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }
    const separator = argument.indexOf("=");
    const key = argument.slice(2, separator < 0 ? undefined : separator);
    if (key.length === 0) throw new CliError("usage", "Empty option name");
    if (VALUE_OPTIONS.has(key)) {
      if (options.has(key)) throw new CliError("usage", `--${key} may be provided only once`);
      const inline = separator < 0 ? undefined : argument.slice(separator + 1);
      const next = inline ?? argv[index + 1];
      if (next === undefined || next.startsWith("--") || next.length === 0) {
        throw new CliError("usage", `--${key} requires a value`);
      }
      options.set(key, next);
      if (inline === undefined) index += 1;
      continue;
    }
    if (FLAG_OPTIONS.has(key) && separator < 0) {
      if (flags.has(key)) throw new CliError("usage", `--${key} may be provided only once`);
      flags.add(key);
      continue;
    }
    throw new CliError("usage", `Unknown option --${key}`);
  }
  return { positionals, options, flags };
}

export function integerOption(
  parsed: ParsedArguments,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = parsed.options.get(key);
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new CliError("usage", `--${key} must be an integer`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new CliError("usage", `--${key} must be between ${minimum} and ${maximum}`);
  }
  return result;
}

export function rejectUnused(
  parsed: ParsedArguments,
  allowedOptions: readonly string[],
  allowedFlags: readonly string[],
): void {
  const options = new Set(allowedOptions);
  const flags = new Set(allowedFlags);
  for (const key of parsed.options.keys()) {
    if (!options.has(key)) throw new CliError("usage", `--${key} is not valid for this command`);
  }
  for (const key of parsed.flags) {
    if (!flags.has(key)) throw new CliError("usage", `--${key} is not valid for this command`);
  }
}
