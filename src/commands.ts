import { lstat, unlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { integerOption, parseArguments, rejectUnused, type ParsedArguments } from "./args.ts";
import {
  AGENTIC_MESSAGING_V1_LIMITS,
  AgenticMessagingV1ContractError,
  createAgentMessageHandoffV1,
  parseAgentMessageDraftV1,
  parseAgentMessageHandoffRequestV1,
  parseAgentMessageHandoffV1,
  parseWrenchMessagingContextBindingV1,
  wrenchMessagingTurnDigestV1,
} from "./agentic-messaging-v1.ts";
import { prettyJson, sha256 } from "./canonical-json.ts";
import { readMessageBundle } from "./bundle.ts";
import { DEFAULT_CONTACTS_DIRECTORY, readMacOSContacts } from "./contacts.ts";
import { CliError } from "./errors.ts";
import { DEFAULT_IMESSAGE_DATABASE, readIMessageDatabase } from "./imessage.ts";
import type { CommandIo } from "./io.ts";
import {
  analyzeContact,
  buildEvaluationPackets,
  buildStudyPacket,
} from "./metrics.ts";
import {
  atomicWritePrivate,
  dataPaths,
  initializeDataPaths,
  loadOrCreateInstallKey,
  type DataPaths,
} from "./paths.ts";
import { readStyleProfile } from "./profile.ts";
import { readStablePrivateJson } from "./private-json.ts";
import { bundledSkillPath, installSkill, type SkillScope, type SkillTarget } from "./skill-install.ts";
import { LocalStore } from "./store.ts";
import type { ContactMetrics } from "./types.ts";
import { MESSAGE_LIKE_ME_VERSION } from "./version.ts";
import { readXArchive } from "./x-archive.ts";
import {
  normalizeXArchive,
  planXArchiveEquivalence,
  xArchiveMatchesBeeperSource,
} from "./x-source.ts";
import {
  planWacliBeeperWhatsAppEquivalence,
  wacliBundleMatchesBeeperWhatsAppSource,
} from "./whatsapp-source.ts";

export const HELP = `Message Like Me ${MESSAGE_LIKE_ME_VERSION}

Usage:
  messagelikeme [--data-dir PATH] init [--json]
  messagelikeme [--data-dir PATH] ingest imessage [--database PATH] [--json]
  messagelikeme [--data-dir PATH] ingest bundle --input ABS_PATH
                    [--overlap-source SOURCE_ID] [--json]
  messagelikeme [--data-dir PATH] ingest x-archive --input ABS_PATH
                    [--overlap-source SOURCE_ID] [--json]
  messagelikeme [--data-dir PATH] ingest contacts [--addressbook PATH] [--json]
  messagelikeme [--data-dir PATH] sources list [--private] [--json]
  messagelikeme [--data-dir PATH] sources show SOURCE_ID [--private] [--json]
  messagelikeme [--data-dir PATH] contacts list [--min-outgoing N] [--limit N] [--private] [--json]
  messagelikeme [--data-dir PATH] contacts show CONTACT_ID [--private] [--json]
  messagelikeme [--data-dir PATH] contacts resolve QUERY --private [--limit N] [--json]
  messagelikeme [--data-dir PATH] routes list CONTACT_ID --output FILE [--private] [--json]
  messagelikeme [--data-dir PATH] inspect tempo CONTACT_ID [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] inspect sessions CONTACT_ID [--limit N] [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] study prepare CONTACT_ID --output FILE [--limit N]
                    [--after ISO_TIMESTAMP] [--before ISO_TIMESTAMP]
                    [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] evaluate prepare CONTACT_ID --after ISO_TIMESTAMP
                    --prompt-output FILE --reference-output FILE [--before ISO_TIMESTAMP]
                    [--limit N] [--session-gap N] [--burst-gap N] [--json]
  messagelikeme [--data-dir PATH] profile apply FILE [--json]
  messagelikeme [--data-dir PATH] profile show CONTACT_ID [--json]
  messagelikeme [--data-dir PATH] profile export CONTACT_ID --output FILE [--json]
  messagelikeme [--data-dir PATH] context CONTACT_ID [--json]
  messagelikeme [--data-dir PATH] handoff prepare CONTACT_ID --request FILE
                    --wrench-context FILE --draft FILE --output FILE [--json]
  messagelikeme [--data-dir PATH] handoff verify FILE [--json]
  messagelikeme [--data-dir PATH] handoff record HANDOFF_ID --wrench-receipt FILE [--json]
  messagelikeme [--data-dir PATH] handoffs show HANDOFF_ID [--json]
  messagelikeme skill path [--json]
  messagelikeme skill install [--target codex|claude|agents] [--scope user|project]
                    [--project PATH] [--force] [--json]
  messagelikeme [--data-dir PATH] doctor [--json]

Message Like Me reads caller-owned macOS Messages, official X archives,
optional Contacts data, and strict private local message bundles, then stores
private analysis locally. It has no network, account, AI-provider, or
message-sending surface.
`;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function emit(io: CommandIo, json: boolean, value: unknown, human: string): void {
  io.stdout(json ? prettyJson(value) : `${human}\n`);
}

function canonicalNow(io: CommandIo): string {
  const date = io.now();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new CliError("internal", "Clock returned an invalid time");
  }
  return date.toISOString();
}

function globalDataPaths(parsed: ParsedArguments): DataPaths {
  return dataPaths(parsed.options.get("data-dir"));
}

async function existingStore(parsed: ParsedArguments): Promise<Readonly<{ paths: DataPaths; store: LocalStore }>> {
  const requested = globalDataPaths(parsed);
  if (!(await exists(requested.root)) || !(await exists(requested.database))) {
    throw new CliError("not-found", "Message Like Me is not initialized; run messagelikeme init or an ingest command");
  }
  const paths = await initializeDataPaths(requested);
  return { paths, store: LocalStore.open(paths.database) };
}

async function writableStore(parsed: ParsedArguments): Promise<Readonly<{
  paths: DataPaths;
  key: Uint8Array;
  store: LocalStore;
}>> {
  const paths = await initializeDataPaths(globalDataPaths(parsed));
  const key = await loadOrCreateInstallKey(paths.installKey);
  return { paths, key, store: LocalStore.open(paths.database) };
}

function requireContact(store: LocalStore, contactId: string, privateLabels = false) {
  if (contactId.length < 1 || contactId.length > 256) throw new CliError("usage", "Invalid contact ID");
  const conversation = store.conversation(contactId, privateLabels);
  if (conversation === null) throw new CliError("not-found", `Unknown contact ${contactId}`);
  return conversation;
}

function contactEvidence(
  store: LocalStore,
  contactId: string,
  window?: Readonly<{ after: string | null; before: string | null }>,
): NonNullable<ReturnType<LocalStore["contactCorpus"]>> {
  if (contactId.length < 1 || contactId.length > 256) throw new CliError("usage", "Invalid contact ID");
  const evidence = store.contactCorpus(contactId, window);
  if (evidence === null) throw new CliError("not-found", `Unknown contact ${contactId}`);
  return evidence;
}

function contactMetrics(
  store: LocalStore,
  contactId: string,
  options: Parameters<typeof analyzeContact>[3] = {},
): ContactMetrics {
  const evidence = contactEvidence(store, contactId);
  return analyzeContact(evidence.messages, evidence.corpusRevision, contactId, {
    ...options,
    reactionFacts: evidence.reactions,
  });
}

function metricOptions(parsed: ParsedArguments): Readonly<{
  sessionGapSeconds: number;
  burstGapSeconds: number;
}> {
  return {
    sessionGapSeconds: integerOption(parsed, "session-gap", 8 * 60 * 60, 1, 30 * 24 * 60 * 60),
    burstGapSeconds: integerOption(parsed, "burst-gap", 5 * 60, 1, 30 * 24 * 60 * 60),
  };
}

function canonicalTimestampOption(
  parsed: ParsedArguments,
  key: "after" | "before",
  required = false,
): string | null {
  const value = parsed.options.get(key);
  if (value === undefined) {
    if (required) throw new CliError("usage", `--${key} is required`);
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new CliError("usage", `--${key} must be a canonical ISO timestamp`);
  }
  return value;
}

function safeContactDetail(store: LocalStore, contactId: string, privateLabels: boolean): unknown {
  const conversation = requireContact(store, contactId, privateLabels);
  return {
    id: conversation.id,
    scopeKind: conversation.scopeKind,
    conversationCount: conversation.conversationCount,
    ...(privateLabels ? {
      privateLabel: conversation.privateLabel,
      privateParticipants: conversation.privateParticipants,
    } : {}),
    service: conversation.service,
    services: conversation.services,
    group: conversation.group,
    participantCount: conversation.participantCount,
    participantIds: conversation.participantIds,
    firstMessageAt: conversation.firstMessageAt,
    lastMessageAt: conversation.lastMessageAt,
    messageCount: conversation.messageCount,
    incomingCount: conversation.incomingCount,
    outgoingCount: conversation.outgoingCount,
  };
}

function compactMetrics(metrics: ContactMetrics): unknown {
  return {
    schemaVersion: metrics.schemaVersion,
    corpusRevision: metrics.corpusRevision,
    contactId: metrics.contactId,
    firstMessageAt: metrics.firstMessageAt,
    lastMessageAt: metrics.lastMessageAt,
    messageCount: metrics.messageCount,
    incomingCount: metrics.incomingCount,
    outgoingCount: metrics.outgoingCount,
    textMessageCount: metrics.textMessageCount,
    sessionGapSeconds: metrics.sessionGapSeconds,
    burstGapSeconds: metrics.burstGapSeconds,
    sessionCount: metrics.sessions.length,
    burstCount: metrics.bursts.length,
    reactions: metrics.reactions,
    tempo: metrics.tempo,
    surface: metrics.surface,
  };
}

function absolutePrivatePath(value: string | undefined, label: string): string {
  if (value === undefined) throw new CliError("usage", `${label} is required`);
  if (!isAbsolute(value)) throw new CliError("unsafe-path", `${label} must be an absolute private path`);
  return resolve(value);
}

function translateIMessageError(error: unknown): never {
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

function translateContactsError(error: unknown): never {
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

function translateBundleError(error: unknown): never {
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

function translateXArchiveError(error: unknown): never {
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

function translateAgenticContractError(error: unknown, label: string): never {
  if (error instanceof CliError) throw error;
  if (error instanceof AgenticMessagingV1ContractError) {
    throw new CliError("invalid-data", `${label} does not satisfy its versioned private contract`, {
      cause: error,
    });
  }
  throw new CliError("invalid-data", `${label} could not be validated safely`, { cause: error });
}

export async function runCommand(argv: readonly string[], io: CommandIo): Promise<void> {
  const parsed = parseArguments(argv);
  if (parsed.flags.has("version")) {
    rejectUnused(parsed, [], ["version"]);
    if (parsed.positionals.length !== 0) throw new CliError("usage", "--version takes no command");
    io.stdout(`${MESSAGE_LIKE_ME_VERSION}\n`);
    return;
  }
  if (parsed.flags.has("help") || parsed.positionals.length === 0) {
    if (parsed.flags.has("help")) rejectUnused(parsed, ["data-dir"], ["help"]);
    io.stdout(HELP);
    return;
  }

  const json = parsed.flags.has("json");
  const [command, subcommand, identifier, ...extra] = parsed.positionals;
  if (extra.length !== 0) throw new CliError("usage", `Unexpected argument ${extra[0]}`);

  if (command === "init" && subcommand === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await writableStore(parsed);
    try {
      const result = { initialized: true, dataDirectory: context.paths.root, database: context.paths.database };
      emit(io, json, result, `Initialized private Message Like Me data at ${context.paths.root}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "ingest" && subcommand === "imessage" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "database"], ["json"]);
    const context = await writableStore(parsed);
    try {
      let snapshot;
      try {
        snapshot = readIMessageDatabase(parsed.options.get("database") ?? DEFAULT_IMESSAGE_DATABASE, {
          hmacKey: context.key,
        });
      } catch (error) {
        translateIMessageError(error);
      }
      const stored = context.store.replaceCorpus(snapshot, canonicalNow(io), context.key);
      const result = {
        ...stored,
        source: {
          bytes: snapshot.source.bytes,
          modifiedAt: snapshot.source.modifiedAt,
          schemaSha256: snapshot.source.schemaSha256,
        },
        warnings: snapshot.warnings,
      };
      emit(io, json, result, `Ingested ${stored.messages} messages across ${stored.conversations} conversations`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "ingest" && subcommand === "bundle" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "input", "overlap-source"], ["json"]);
    const input = absolutePrivatePath(parsed.options.get("input"), "--input");
    const context = await writableStore(parsed);
    try {
      let bundle;
      try {
        bundle = await readMessageBundle(input, { hmacKey: context.key });
      } catch (error) {
        translateBundleError(error);
      }
      const overlapSourceId = parsed.options.get("overlap-source");
      if (overlapSourceId !== undefined && bundle.schemaVersion !== 2) {
        throw new CliError(
          "usage",
          "--overlap-source is supported for a native WhatsApp bundle v2 or an X archive",
        );
      }
      const nativeSource = bundle.schemaVersion === 2 ? bundle.sources[0]! : null;
      const matchingBeeperSources = nativeSource === null
        ? []
        : context.store.listSources().filter((source) =>
          source.kind === "bundle" && source.provider === "beeper" && source.network === "whatsapp")
          .filter((source) => wacliBundleMatchesBeeperWhatsAppSource(
            nativeSource,
            context.store.sourceOverlapEvidence(source.id),
          ));
      if (overlapSourceId === undefined && matchingBeeperSources.length > 0) {
        const ids = matchingBeeperSources.map(({ id }) => id).join(", ");
        throw new CliError(
          "conflict",
          `A Beeper WhatsApp source for this exact account already exists; inspect sources and rerun with --overlap-source ${ids}`,
        );
      }
      const equivalence = overlapSourceId === undefined
        ? undefined
        : planWacliBeeperWhatsAppEquivalence(
          nativeSource!,
          context.store.sourceOverlapEvidence(overlapSourceId),
        );
      if (equivalence !== undefined) {
        io.stderr(
          `Proved ${equivalence.messages.length} exact WhatsApp message overlaps with the named Beeper source; native Wacli evidence will be preferred atomically.\n`,
        );
      }
      const stored = context.store.replaceSources(
        bundle.sources,
        canonicalNow(io),
        context.key,
        equivalence,
      );
      const result = {
        schemaVersion: bundle.schemaVersion,
        manifestSha256: bundle.manifestSha256,
        corpusRevision: stored.corpusRevision,
        sources: stored.sources,
        conversations: stored.sources.reduce((sum, source) => sum + source.conversations, 0),
        messages: stored.sources.reduce((sum, source) => sum + source.messages, 0),
        ...(equivalence === undefined ? {} : {
          reconciliation: {
            conversations: equivalence.conversations.length,
            messages: equivalence.messages.length,
            reactions: equivalence.reactions?.length ?? 0,
          },
        }),
      };
      emit(
        io,
        json,
        result,
        `Ingested ${result.messages} active messages across ${result.conversations} conversations from ${result.sources.length} sources`,
      );
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "ingest" && subcommand === "x-archive" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "input", "overlap-source"], ["json"]);
    const input = absolutePrivatePath(parsed.options.get("input"), "--input");
    const paths = await initializeDataPaths(globalDataPaths(parsed));
    const key = await loadOrCreateInstallKey(paths.installKey);
    io.stderr("Validating one private X archive locally; no data is uploaded.\n");
    let archive;
    try {
      archive = await readXArchive(input);
    } catch (error) {
      translateXArchiveError(error);
    }
    const snapshot = normalizeXArchive(archive, key);
    io.stderr(
      `Validated ${snapshot.messages.length} messages across ${snapshot.conversations.length} ${
        snapshot.conversations.length === 1 ? "conversation" : "conversations"
      }.\n`,
    );
    const store = LocalStore.open(paths.database);
    try {
      const overlapSourceId = parsed.options.get("overlap-source");
      const beeperXSources = store.listSources().filter((source) =>
        source.kind === "bundle" && source.provider === "beeper" && source.network === "x");
      const matchingBeeperSources = beeperXSources.filter((source) => {
        const privateSource = store.source(source.id, true);
        return privateSource !== null && xArchiveMatchesBeeperSource(archive, privateSource);
      });
      if (overlapSourceId === undefined && matchingBeeperSources.length > 0) {
        const ids = matchingBeeperSources.map(({ id }) => id).join(", ");
        throw new CliError(
          "conflict",
          `A Beeper X source for this exact account already exists; inspect sources and rerun with --overlap-source ${ids}`,
        );
      }
      const equivalence = overlapSourceId === undefined
        ? undefined
        : planXArchiveEquivalence(
          archive,
          snapshot,
          store.sourceOverlapEvidence(overlapSourceId),
        );
      if (equivalence !== undefined) {
        io.stderr(
          `Proved ${equivalence.messages.length} exact message overlaps with the named Beeper source; they will be reconciled atomically.\n`,
        );
      }
      io.stderr("Updating the private local Message Like Me store atomically.\n");
      const stored = store.replaceSources(
        [snapshot],
        canonicalNow(io),
        key,
        equivalence,
        ({ phase, completed, total }) => {
          io.stderr(`Processed ${completed} of ${total} ${phase} inside the pending transaction.\n`);
        },
      );
      const source = stored.sources[0]!;
      const outgoingMessages = snapshot.messages.filter(({ direction }) => direction === "outgoing").length;
      const result = {
        archive: {
          sha256: archive.archive.sha256,
          manifestSha256: archive.archive.manifestSha256,
          sizeBytes: archive.archive.sizeBytes,
          generatedAt: archive.archive.generationDate,
          partial: archive.archive.isPartialArchive,
        },
        corpusRevision: stored.corpusRevision,
        source,
        imported: {
          conversations: snapshot.conversations.length,
          messages: snapshot.messages.length,
          incomingMessages: snapshot.messages.length - outgoingMessages,
          outgoingMessages,
          reactions: snapshot.reactionFacts?.length ?? 0,
          replyStateUnavailableMessages: snapshot.messages.length,
        },
        active: {
          conversations: source.conversations,
          messages: source.messages,
        },
        reconciliation: equivalence === undefined ? null : {
          preferredSourceId: equivalence.preferredSourceId,
          conversations: equivalence.conversations.length,
          messages: equivalence.messages.length,
          reactions: equivalence.reactions?.length ?? 0,
          basis: equivalence.basis,
        },
        warnings: snapshot.source.warnings,
      };
      emit(
        io,
        json,
        result,
        `Ingested ${result.imported.messages} X archive messages across ${result.imported.conversations} conversations${
          result.reconciliation === null
            ? ""
            : `; reconciled ${result.reconciliation.messages} exact Beeper duplicates`
        }`,
      );
    } finally {
      store.close();
    }
    return;
  }

  if (command === "ingest" && subcommand === "contacts" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "addressbook"], ["json"]);
    const context = await writableStore(parsed);
    try {
      const override = parsed.options.get("addressbook");
      const sourcePath = override === undefined
        ? DEFAULT_CONTACTS_DIRECTORY
        : absolutePrivatePath(override, "--addressbook");
      let snapshot;
      try {
        snapshot = readMacOSContacts(sourcePath, { hmacKey: context.key });
      } catch (error) {
        translateContactsError(error);
      }
      const stored = context.store.enrichContacts(snapshot, canonicalNow(io), context.key);
      const result = {
        ...stored,
        source: {
          databases: snapshot.sources.length,
          bytes: snapshot.sources.reduce((sum, source) => sum + source.bytes, 0),
          schemaSha256: snapshot.sources.map((source) => source.schemaSha256),
        },
        warnings: snapshot.warnings,
      };
      emit(
        io,
        json,
        result,
        `Matched ${stored.matched} direct conversations and enriched ${stored.enriched} private labels`,
      );
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "contacts" && subcommand === "list" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "min-outgoing", "limit"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const contacts = context.store.listContacts({
        privateLabels: parsed.flags.has("private"),
        minimumOutgoing: integerOption(parsed, "min-outgoing", 1, 0, 10_000_000),
        limit: integerOption(parsed, "limit", 50, 1, 1_000),
      });
      emit(io, json, { contacts }, `${contacts.length} contacts`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "sources" && subcommand === "list" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const sources = context.store.listSources(parsed.flags.has("private"));
      emit(io, json, { sources }, `${sources.length} message sources`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "sources" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const source = context.store.source(identifier, parsed.flags.has("private"));
      if (source === null) throw new CliError("not-found", `Unknown source ${identifier}`);
      emit(io, json, source, `Message source ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "contacts" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json", "private"]);
    const context = await existingStore(parsed);
    try {
      const detail = safeContactDetail(context.store, identifier, parsed.flags.has("private"));
      emit(io, json, detail, `Contact ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "contacts" && subcommand === "resolve" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "limit"], ["json", "private"]);
    if (!parsed.flags.has("private")) {
      throw new CliError("usage", "contacts resolve requires --private");
    }
    const context = await existingStore(parsed);
    try {
      let matches;
      try {
        matches = context.store.resolvePrivateContacts(
          identifier,
          integerOption(parsed, "limit", 10, 1, 50),
        );
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError("usage", "Contact query must be bounded exact text", { cause: error });
      }
      emit(io, json, { exact: true, matches }, `${matches.length} exact private contact matches`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "routes" && subcommand === "list" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "output"], ["json", "private"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      const routes = context.store.routeCandidates(identifier, parsed.flags.has("private"));
      if (routes === null) throw new CliError("not-found", `Unknown contact ${identifier}`);
      const eligible = routes.candidates.filter(({ actionability }) =>
        actionability.state === "wrench-binding-eligible");
      const selection = eligible.length === 0
        ? Object.freeze({ state: "unavailable" as const, eligibleCandidateId: null })
        : eligible.length === 1
          ? Object.freeze({ state: "single-exact-candidate" as const, eligibleCandidateId: eligible[0]!.id })
          : Object.freeze({ state: "ambiguous" as const, eligibleCandidateId: null });
      const result = {
        schemaVersion: 1,
        format: "message-like-me.source-conversation-routes",
        contactId: routes.contactId,
        selection,
        candidates: routes.candidates,
      };
      const bytes = prettyJson(result);
      await atomicWritePrivate(output, bytes);
      const receipt = {
        schemaVersion: 1,
        format: "message-like-me.source-conversation-routes-receipt",
        contactIdSha256: sha256(routes.contactId),
        routesSha256: sha256(bytes),
        candidates: routes.candidates.length,
        eligibleCandidates: eligible.length,
        selectionState: selection.state,
        privateCoordinatesIncluded: parsed.flags.has("private"),
      };
      emit(io, json, receipt, `Wrote ${routes.candidates.length} exact source-conversation routes to a private file`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "inspect" && subcommand === "tempo" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "session-gap", "burst-gap"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const metrics = contactMetrics(context.store, identifier, metricOptions(parsed));
      const result = compactMetrics(metrics);
      emit(io, json, result, `Tempo metrics for ${identifier}: ${metrics.tempo.responseEpisodes} response episodes`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "inspect" && subcommand === "sessions" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "limit", "session-gap", "burst-gap"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const metrics = contactMetrics(context.store, identifier, metricOptions(parsed));
      const limit = integerOption(parsed, "limit", 20, 1, 1_000);
      const sessions = metrics.sessions.slice(-limit);
      const result = { contactId: identifier, total: metrics.sessions.length, sessions };
      emit(io, json, result, `${sessions.length} of ${metrics.sessions.length} sessions for ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "study" && subcommand === "prepare" && identifier !== undefined) {
    rejectUnused(parsed, [
      "data-dir", "output", "limit", "after", "before", "session-gap", "burst-gap",
    ], ["json"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      const after = canonicalTimestampOption(parsed, "after");
      const before = canonicalTimestampOption(parsed, "before");
      let evidence;
      try {
        evidence = contactEvidence(context.store, identifier, { after, before });
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError("usage", error instanceof Error ? error.message : String(error), { cause: error });
      }
      const metrics = analyzeContact(
        evidence.messages,
        evidence.corpusRevision,
        identifier,
        { ...metricOptions(parsed), reactionFacts: evidence.reactions },
      );
      const packet = buildStudyPacket(evidence.messages, metrics, {
        limit: integerOption(parsed, "limit", 24, 1, 50),
        generatedAt: canonicalNow(io),
        evidenceRevision: evidence.evidenceRevision,
        evidenceWindow: { after, before },
      });
      const bytes = prettyJson(packet);
      const packetSha256 = sha256(bytes);
      await atomicWritePrivate(output, bytes);
      context.store.recordStudyPacket({
        sha256: packetSha256,
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        createdAt: packet.generatedAt,
        privatePath: output,
        exampleIds: packet.examples.map(({ id }) => id),
        evidence: {
          firstMessageAt: packet.metrics.firstMessageAt,
          lastMessageAt: packet.metrics.lastMessageAt,
          messageCount: packet.metrics.messageCount,
          outgoingTextMessages: packet.metrics.surface.outgoingTextMessages,
          responseEpisodes: packet.metrics.tempo.responseEpisodes,
          studyExamples: packet.examples.length,
          selectionAlgorithm: packet.selection.algorithm,
          after: packet.evidenceWindow.after,
          before: packet.evidenceWindow.before,
        },
      });
      const result = {
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        packetSha256,
        examples: packet.examples.length,
        evidenceWindow: packet.evidenceWindow,
        output,
      };
      emit(io, json, result, `Prepared ${packet.examples.length} private study examples at ${output} (SHA-256 ${packetSha256})`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "evaluate" && subcommand === "prepare" && identifier !== undefined) {
    rejectUnused(parsed, [
      "data-dir", "after", "before", "prompt-output", "reference-output", "limit",
      "session-gap", "burst-gap",
    ], ["json"]);
    const promptOutput = absolutePrivatePath(parsed.options.get("prompt-output"), "--prompt-output");
    const referenceOutput = absolutePrivatePath(
      parsed.options.get("reference-output"),
      "--reference-output",
    );
    if (promptOutput === referenceOutput) {
      throw new CliError("usage", "--prompt-output and --reference-output must be different paths");
    }
    const after = canonicalTimestampOption(parsed, "after", true)!;
    const before = canonicalTimestampOption(parsed, "before");
    const context = await existingStore(parsed);
    try {
      let evidence;
      try {
        evidence = contactEvidence(context.store, identifier, { after, before });
      } catch (error) {
        if (error instanceof CliError) throw error;
        throw new CliError("usage", error instanceof Error ? error.message : String(error), { cause: error });
      }
      const metrics = analyzeContact(
        evidence.messages,
        evidence.corpusRevision,
        identifier,
        { ...metricOptions(parsed), reactionFacts: evidence.reactions },
      );
      const packets = buildEvaluationPackets(evidence.messages, metrics, {
        after,
        before,
        limit: integerOption(parsed, "limit", 8, 1, 25),
        generatedAt: canonicalNow(io),
        evidenceRevision: evidence.evidenceRevision,
      });
      if (packets.prompt.cases.length === 0) {
        throw new CliError("not-found", "No complete held-out response cases exist in that time window");
      }
      await atomicWritePrivate(promptOutput, prettyJson(packets.prompt));
      await atomicWritePrivate(referenceOutput, prettyJson(packets.reference));
      const result = {
        evaluationId: packets.prompt.evaluationId,
        contactId: identifier,
        corpusRevision: evidence.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        cases: packets.prompt.cases.length,
        evidenceWindow: packets.prompt.evidenceWindow,
        promptOutput,
        referenceOutput,
        referenceNotice: packets.reference.notice,
      };
      emit(
        io,
        json,
        result,
        `Prepared ${packets.prompt.cases.length} held-out cases. Draft from ${promptOutput} before opening ${referenceOutput}`,
      );
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "profile" && subcommand === "apply" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const path = absolutePrivatePath(identifier, "Profile path");
    const profile = await readStyleProfile(path);
    const context = await existingStore(parsed);
    try {
      context.store.applyProfile(profile, canonicalNow(io));
      const result = { applied: true, contactId: profile.contactId, corpusRevision: profile.corpusRevision };
      emit(io, json, result, `Applied current profile for ${profile.contactId}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "profile" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await existingStore(parsed);
    try {
      requireContact(context.store, identifier);
      const result = context.store.profile(identifier);
      if (result === null) throw new CliError("not-found", `No profile exists for ${identifier}`);
      emit(io, json, result, `${result.state} profile for ${identifier}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "profile" && subcommand === "export" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "output"], ["json"]);
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    const context = await existingStore(parsed);
    try {
      requireContact(context.store, identifier);
      const result = context.store.profile(identifier);
      if (result === null) throw new CliError("not-found", `No profile exists for ${identifier}`);
      await atomicWritePrivate(output, prettyJson(result.profile));
      const receipt = { contactId: identifier, state: result.state, output };
      emit(io, json, receipt, `Exported ${result.state} profile to ${output}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "context" && subcommand !== undefined && identifier === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const contactId = subcommand;
    const context = await existingStore(parsed);
    try {
      const result = {
        contact: safeContactDetail(context.store, contactId, false),
        metrics: compactMetrics(contactMetrics(context.store, contactId)),
        profile: context.store.profile(contactId),
      };
      emit(io, json, result, `Drafting context for ${contactId}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "handoff" && subcommand === "prepare" && identifier !== undefined) {
    rejectUnused(parsed, [
      "data-dir", "request", "wrench-context", "draft", "output",
    ], ["json"]);
    const requestPath = absolutePrivatePath(parsed.options.get("request"), "--request");
    const wrenchContextPath = absolutePrivatePath(parsed.options.get("wrench-context"), "--wrench-context");
    const draftPath = absolutePrivatePath(parsed.options.get("draft"), "--draft");
    const output = absolutePrivatePath(parsed.options.get("output"), "--output");
    if (new Set([requestPath, wrenchContextPath, draftPath, output]).size !== 4) {
      throw new CliError("usage", "Handoff request, Wrench context, draft, and output paths must be different");
    }
    let request;
    let wrenchContext;
    let draft;
    try {
      request = parseAgentMessageHandoffRequestV1(await readStablePrivateJson(
        requestPath,
        "Private handoff request file",
        AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes,
      ));
      wrenchContext = parseWrenchMessagingContextBindingV1(await readStablePrivateJson(
        wrenchContextPath,
        "Private Wrench context file",
        AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes,
      ));
      draft = parseAgentMessageDraftV1(await readStablePrivateJson(
        draftPath,
        "Private draft file",
        AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes,
      ));
    } catch (error) {
      translateAgenticContractError(error, "Private handoff input");
    }
    const createdAt = canonicalNow(io);
    if (wrenchContext.validatedAt > createdAt || wrenchContext.expiresAt <= createdAt) {
      throw new CliError("conflict", "The private Wrench context is not current; collect a fresh exact context");
    }
    const context = await existingStore(parsed);
    let published = false;
    try {
      const preparation = context.store.handoffPreparation(identifier, request.routeCandidateId);
      const expiresAt = new Date(Math.min(
        Date.parse(createdAt) + AGENTIC_MESSAGING_V1_LIMITS.handoffLifetimeMilliseconds,
        Date.parse(wrenchContext.expiresAt),
      )).toISOString();
      const handoff = createAgentMessageHandoffV1({
        createdAt,
        expiresAt,
        contact: {
          contactId: preparation.contactId,
          routeCandidateId: preparation.candidate.id,
          sourceId: preparation.candidate.sourceId,
          conversationId: preparation.candidate.conversationId,
        },
        evidence: {
          corpusRevision: preparation.corpusRevision,
          sourceRevision: preparation.candidate.sourceRevision,
          profileState: preparation.profileState,
          profileEvidenceRevision: preparation.profileEvidenceRevision,
        },
        wrenchContext,
        draft,
      });
      await atomicWritePrivate(output, prettyJson(handoff));
      published = true;
      const audit = context.store.recordPreparedHandoff(handoff);
      emit(io, json, audit, `Prepared private handoff ${audit.handoffId} with ${audit.partCount} message parts`);
    } catch (error) {
      if (published) await unlink(output).catch(() => undefined);
      if (error instanceof AgenticMessagingV1ContractError) {
        translateAgenticContractError(error, "Private handoff");
      }
      throw error;
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "handoff" && subcommand === "verify" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const input = absolutePrivatePath(identifier, "Handoff path");
    let handoff;
    try {
      handoff = parseAgentMessageHandoffV1(await readStablePrivateJson(
        input,
        "Private handoff file",
        AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes,
      ));
    } catch (error) {
      translateAgenticContractError(error, "Private handoff file");
    }
    const result = {
      valid: true,
      handoffId: handoff.handoffId,
      handoffSha256: handoff.integrity.canonicalSha256,
      contactIdSha256: sha256(handoff.contact.contactId),
      routeCandidateIdSha256: sha256(handoff.contact.routeCandidateId),
      sourceIdSha256: sha256(handoff.contact.sourceId),
      conversationIdSha256: sha256(handoff.contact.conversationId),
      corpusRevision: handoff.evidence.corpusRevision,
      sourceRevision: handoff.evidence.sourceRevision,
      profileState: handoff.evidence.profileState,
      profileEvidenceRevision: handoff.evidence.profileEvidenceRevision,
      wrenchContractHash: handoff.wrench.contractHash,
      routeRefSha256: handoff.wrench.routeRefSha256,
      contextRefSha256: handoff.wrench.contextRefSha256,
      exactDataRevisionSha256: handoff.wrench.exactDataRevision,
      latestMessageRevisionSha256: handoff.wrench.latestMessageRevision,
      turnDigest: wrenchMessagingTurnDigestV1(handoff),
      partCount: handoff.turn.bubbles.length,
      createdAt: handoff.createdAt,
      expiresAt: handoff.expiresAt,
      expired: handoff.expiresAt <= canonicalNow(io),
    };
    emit(io, json, result, `Verified private handoff ${handoff.handoffId}`);
    return;
  }

  if (command === "handoff" && subcommand === "record" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir", "wrench-receipt"], ["json"]);
    const receiptPath = absolutePrivatePath(parsed.options.get("wrench-receipt"), "--wrench-receipt");
    let receipt: unknown;
    try {
      receipt = await readStablePrivateJson(
        receiptPath,
        "Private Wrench receipt file",
        AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes,
      );
    } catch (error) {
      translateAgenticContractError(error, "Private Wrench receipt file");
    }
    const context = await existingStore(parsed);
    try {
      let audit;
      try {
        audit = context.store.recordHandoffReceipt(identifier, receipt);
      } catch (error) {
        if (error instanceof AgenticMessagingV1ContractError) {
          translateAgenticContractError(error, "Private Wrench receipt file");
        }
        throw error;
      }
      emit(io, json, audit, `Recorded body-free Wrench audit for ${audit.handoffId}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "handoffs" && subcommand === "show" && identifier !== undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const context = await existingStore(parsed);
    try {
      const audit = context.store.handoffAudit(identifier);
      emit(io, json, audit, `${audit.state} handoff audit ${audit.handoffId}`);
    } finally {
      context.store.close();
    }
    return;
  }

  if (command === "skill" && subcommand === "path" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const path = bundledSkillPath();
    emit(io, json, { path }, path);
    return;
  }

  if (command === "skill" && subcommand === "install" && identifier === undefined) {
    rejectUnused(parsed, ["data-dir", "target", "scope", "project"], ["force", "json"]);
    const target = (parsed.options.get("target") ?? "codex") as SkillTarget;
    const scope = (parsed.options.get("scope") ?? "user") as SkillScope;
    if (target !== "codex" && target !== "claude" && target !== "agents") {
      throw new CliError("usage", "--target must be codex, claude, or agents");
    }
    if (scope !== "user" && scope !== "project") {
      throw new CliError("usage", "--scope must be user or project");
    }
    const project = parsed.options.get("project");
    if (project !== undefined && scope !== "project") {
      throw new CliError("usage", "--project requires --scope project");
    }
    const destination = await installSkill({
      target,
      scope,
      ...(project === undefined ? {} : { projectDirectory: project }),
      force: parsed.flags.has("force"),
    });
    emit(io, json, { destination, target, scope }, `Installed message-like-me skill at ${destination}`);
    return;
  }

  if (command === "doctor" && subcommand === undefined) {
    rejectUnused(parsed, ["data-dir"], ["json"]);
    const requested = globalDataPaths(parsed);
    const initialized = await exists(requested.database);
    if (!initialized) {
      const result = {
        ok: true,
        initialized: false,
        dataDirectory: requested.root,
        defaultMessagesDatabase: DEFAULT_IMESSAGE_DATABASE,
        defaultContactsDirectory: DEFAULT_CONTACTS_DIRECTORY,
      };
      emit(io, json, result, `Message Like Me is not initialized at ${requested.root}`);
      return;
    }
    const context = await existingStore(parsed);
    try {
      const status = context.store.doctor();
      const result = {
        ok: status.quickCheck === "ok" && status.foreignKeyViolations === 0,
        initialized: true,
        dataDirectory: context.paths.root,
        database: context.paths.database,
        ...status,
      };
      emit(io, json, result, result.ok ? "Message Like Me local state is healthy" : "Message Like Me local state needs attention");
    } finally {
      context.store.close();
    }
    return;
  }

  throw new CliError("usage", `Unknown command\n\n${HELP}`);
}
