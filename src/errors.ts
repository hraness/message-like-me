export type ErrorKind =
  | "usage"
  | "not-found"
  | "conflict"
  | "permission"
  | "unsafe-path"
  | "invalid-data"
  | "internal";

const EXIT_CODES: Readonly<Record<ErrorKind, number>> = {
  usage: 2,
  "not-found": 3,
  conflict: 4,
  permission: 5,
  "unsafe-path": 6,
  "invalid-data": 7,
  internal: 1,
};

export class CliError extends Error {
  readonly exitCode: number;
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CliError";
    this.kind = kind;
    this.exitCode = EXIT_CODES[kind];
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function exitCodeFor(error: unknown): number {
  return error instanceof CliError ? error.exitCode : 1;
}
