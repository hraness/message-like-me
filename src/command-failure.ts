import { AgenticMessagingV1ContractError } from "./agentic-messaging-v1.ts";
import { CliError } from "./errors.ts";

export type CommandFailure = Readonly<{ _tag: "CommandFailure"; cause: CliError }> | Readonly<{ _tag: "ForeignFailure"; cause: unknown }>;

export function commandFailure(cause: unknown): CommandFailure {
  return cause instanceof CliError ? { _tag: "CommandFailure", cause } : { _tag: "ForeignFailure", cause };
}

export function translateIMessageError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM" || code === "permission") {
    throw new CliError(
      "permission",
      "Messages data is not readable. Grant Full Disk Access to this terminal or agent host, then retry.",
      { cause: error },
    );
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected Messages database does not exist", { cause: error });
  }
  throw new CliError("invalid-data", error instanceof Error ? error.message : String(error), { cause: error });
}

export function translateContactsError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError(
      "permission",
      "Contacts data is not readable. Grant Full Disk Access to this terminal or agent host, then retry.",
      { cause: error },
    );
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected AddressBook source does not exist", { cause: error });
  }
  const message = error instanceof Error ? error.message : "";
  throw new CliError(
    "invalid-data",
    message.startsWith("Contacts source ")
      ? message
      : "The selected AddressBook source could not be read safely",
    { cause: error },
  );
}

export function translateBundleError(error: unknown): never {
  if (error instanceof CliError) throw error;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError("permission", "The selected private bundle is not readable", { cause: error });
  }
  if (code === "ENOENT") {
    throw new CliError("not-found", "The selected private bundle does not exist", { cause: error });
  }
  throw new CliError(
    "invalid-data",
    "The selected private message bundle could not be read safely",
    { cause: error },
  );
}

export function translateXArchiveError(error: unknown): never {
  const code = error instanceof CliError
    ? error.kind
    : (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM") {
    throw new CliError("permission", "The selected private X archive is not readable", { cause: error });
  }
  if (code === "ENOENT" || code === "not-found") {
    throw new CliError("not-found", "The selected private X archive does not exist", { cause: error });
  }
  throw new CliError(
    "invalid-data",
    "The selected private X archive could not be validated safely",
    { cause: error },
  );
}

export function translateAgenticContractError(error: unknown, label: string): never {
  if (error instanceof CliError) throw error;
  if (error instanceof AgenticMessagingV1ContractError) {
    throw new CliError("invalid-data", `${label} does not satisfy its versioned private contract`, {
      cause: error,
    });
  }
  throw new CliError("invalid-data", `${label} could not be validated safely`, { cause: error });
}

/** Convert the existing private-contract translator into the typed failure channel. */
export function agenticContractFailure(cause: unknown, label: string): CommandFailure {
  try { translateAgenticContractError(cause, label); }
  catch (translated) { return commandFailure(translated); }
}

export function usageFailure(cause: unknown): CommandFailure {
  return commandFailure(new CliError("usage", cause instanceof Error ? cause.message : String(cause), { cause }));
}
