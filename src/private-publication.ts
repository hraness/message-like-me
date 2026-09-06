import { CliError, errorMessage } from "./errors.ts";

export type PublicationCleanup = "removed" | "removed-unconfirmed" | "missing" | "retained-changed" | "retained-unproven" | "retained";
export type ReceiptState = "not-attempted" | "absent" | "committed" | "different" | "unproven";
export type PublicationReport = Readonly<{
  pathSha256: string;
  bytesSha256: string;
  receipt: ReceiptState;
  cleanup: PublicationCleanup;
}>;

/** Adds body-free recovery state without changing CLI text or exit-code policy. */
export class PrivatePublicationError extends CliError {
  readonly publications: readonly PublicationReport[];

  constructor(cause: unknown, publications: readonly PublicationReport[]) {
    super(cause instanceof CliError ? cause.kind : "internal", errorMessage(cause), { cause });
    this.name = "PrivatePublicationError";
    this.publications = Object.freeze([
      ...(cause instanceof PrivatePublicationError ? cause.publications : []),
      ...publications.map((publication) => Object.freeze({ ...publication })),
    ]);
  }
}
