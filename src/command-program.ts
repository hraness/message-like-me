import { Effect, Exit, type Scope } from "effect";
import { integerOption, parseArguments, rejectUnused } from "./args.ts";
import { AGENTIC_MESSAGING_V1_LIMITS, AgenticMessagingV1ContractError, createAgentMessageHandoffV1, parseAgentMessageDraftV1, parseAgentMessageHandoffRequestV1, parseAgentMessageHandoffV1, parseGhostgetMessagingContextBindingV1, ghostgetMessagingTurnDigestV1 } from "./agentic-messaging-v1.ts";
import { prettyJson, sha256 } from "./canonical-json.ts";
import { HELP, handoffExpiry, metricOptions, canonicalTimestampOption, ensoulSubjectOption, compactMetrics, absolutePrivatePath } from "./command-input.ts";
import { agenticContractFailure, commandFailure, usageFailure, type CommandFailure } from "./command-failure.ts";
import { CommandArtifacts } from "./command-artifacts.ts";
import { CommandPlatform, type CommandStore } from "./command-platform.ts";
import { CliError } from "./errors.ts";
import { buildEnsoulMessagesSourcePacketV1, ensoulSubjectMessages, ensoulSubjectReactions } from "./ensoul-source-v1.ts";
import { analyzeContact, buildEvaluationPackets, buildStudyPacket } from "./metrics.ts";
import type { SkillScope, SkillTarget } from "./skill-install.ts";
import { skillInstallWarning } from "./skill-install-model.ts";
import type { LocalStore } from "./store.ts";
import type { ContactMetrics } from "./types.ts";
import { MESSAGE_LIKE_ME_VERSION } from "./version.ts";
import { normalizeXArchive, planXArchiveEquivalence, xArchiveMatchesBeeperSource } from "./x-source.ts";
import { planWacliBeeperWhatsAppEquivalence, wacliBundleMatchesBeeperWhatsAppSource } from "./whatsapp-source.ts";
function requireContact(store: CommandStore, contactId: string, privateLabels = false): Effect.Effect<NonNullable<ReturnType<LocalStore["conversation"]>>, CommandFailure> {
  return Effect.gen(function* () {
    if (contactId.length < 1 || contactId.length > 256)
      return yield* Effect.fail(commandFailure(new CliError("usage", "Invalid contact ID")));
    const conversation = (yield* store.conversation(contactId, privateLabels));
    if (conversation === null)
      return yield* Effect.fail(commandFailure(new CliError("not-found", `Unknown contact ${contactId}`)));
    return conversation;
  });
}
function contactEvidence(store: CommandStore, contactId: string, window?: Readonly<{
  after: string | null;
  before: string | null;
}>): Effect.Effect<NonNullable<ReturnType<LocalStore["contactCorpus"]>>, CommandFailure> {
  return Effect.gen(function* () {
    if (contactId.length < 1 || contactId.length > 256)
      return yield* Effect.fail(commandFailure(new CliError("usage", "Invalid contact ID")));
    const evidence = (yield* store.contactCorpus(contactId, window));
    if (evidence === null)
      return yield* Effect.fail(commandFailure(new CliError("not-found", `Unknown contact ${contactId}`)));
    return evidence;
  });
}
function contactMetrics(store: CommandStore, contactId: string, options: Parameters<typeof analyzeContact>[3] = {}): Effect.Effect<ContactMetrics, CommandFailure> {
  return Effect.gen(function* () {
    const evidence = (yield* contactEvidence(store, contactId));
    return analyzeContact(evidence.messages, evidence.corpusRevision, contactId, {
      ...options,
      reactionFacts: evidence.reactions,
    });
  });
}
function safeContactDetail(store: CommandStore, contactId: string, privateLabels: boolean): Effect.Effect<unknown, CommandFailure> {
  return Effect.gen(function* () {
    const conversation = (yield* requireContact(store, contactId, privateLabels));
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
  });
}
export function commandProgram(argv: readonly string[]): Effect.Effect<void, CommandFailure, CommandPlatform | CommandArtifacts | Scope.Scope> {
  return Effect.gen(function* () {
    const platform = yield* CommandPlatform;
    const artifacts = yield* CommandArtifacts;
    const parsed = parseArguments(argv);
    if (parsed.flags.has("version")) {
      rejectUnused(parsed, [], ["version"]);
      if (parsed.positionals.length !== 0)
        return yield* Effect.fail(commandFailure(new CliError("usage", "--version takes no command")));
      yield* platform.stdout(`${MESSAGE_LIKE_ME_VERSION}\n`);
      return;
    }
    if (parsed.flags.has("help") || parsed.positionals.length === 0) {
      if (parsed.flags.has("help"))
        rejectUnused(parsed, ["data-dir"], ["help"]);
      yield* platform.stdout(HELP);
      return;
    }
    const json = parsed.flags.has("json");
    const [command, subcommand, identifier, ...extra] = parsed.positionals;
    if (extra.length !== 0)
      return yield* Effect.fail(commandFailure(new CliError("usage", `Unexpected argument ${extra[0]}`)));
    if (command === "init" && subcommand === undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const context = (yield* platform.writableSession(parsed.options.get("data-dir")));
      const result = { initialized: true, dataDirectory: context.paths.root, database: context.paths.database };
      yield* platform.emit(json, result, `Initialized private Message Like Me data at ${context.paths.root}`);
      return;
    }
    if (command === "ingest" && subcommand === "imessage" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir", "database"], ["json"]);
      const context = (yield* platform.writableSession(parsed.options.get("data-dir")));
      const snapshot = (yield* platform.readIMessage(parsed.options.get("database") ?? platform.defaultMessagesDatabase, context.key));
      const stored = (yield* context.store.replaceCorpus(snapshot, (yield* platform.now), context.key));
      const result = {
        ...stored,
        source: {
          bytes: snapshot.source.bytes,
          modifiedAt: snapshot.source.modifiedAt,
          schemaSha256: snapshot.source.schemaSha256,
        },
        warnings: snapshot.warnings,
      };
      yield* platform.emit(json, result, `Ingested ${stored.messages} messages across ${stored.conversations} conversations`);
      return;
    }
    if (command === "ingest" && subcommand === "bundle" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir", "input", "overlap-source"], ["json"]);
      const input = absolutePrivatePath(parsed.options.get("input"), "--input");
      const context = (yield* platform.writableSession(parsed.options.get("data-dir")));
      const bundle = (yield* platform.readBundle(input, context.key));
      const overlapSourceId = parsed.options.get("overlap-source");
      if (overlapSourceId !== undefined && bundle.schemaVersion !== 2) {
        return yield* Effect.fail(commandFailure(new CliError("usage", "--overlap-source is supported for a native WhatsApp bundle v2 or an X archive")));
      }
      const nativeSource = bundle.schemaVersion === 2 ? bundle.sources[0]! : null;
      const matchingBeeperSources: Array<ReturnType<LocalStore["listSources"]>[number]> = [];
      if (nativeSource !== null) {
        for (const source of yield* context.store.listSources()) {
          if (source.kind !== "bundle" || source.provider !== "beeper" || source.network !== "whatsapp")
            continue;
          if (wacliBundleMatchesBeeperWhatsAppSource(nativeSource, yield* context.store.sourceOverlapEvidence(source.id))) {
            matchingBeeperSources.push(source);
          }
        }
      }
      if (overlapSourceId === undefined && matchingBeeperSources.length > 0) {
        const ids = matchingBeeperSources.map(({ id }) => id).join(", ");
        return yield* Effect.fail(commandFailure(new CliError("conflict", `A Beeper WhatsApp source for this exact account already exists; inspect sources and rerun with --overlap-source ${ids}`)));
      }
      const equivalence = overlapSourceId === undefined
        ? undefined
        : planWacliBeeperWhatsAppEquivalence(nativeSource!, (yield* context.store.sourceOverlapEvidence(overlapSourceId)));
      if (equivalence !== undefined) {
        yield* platform.stderr(`Proved ${equivalence.messages.length} exact WhatsApp message overlaps with the named Beeper source; native Wacli evidence will be preferred atomically.\n`);
      }
      const stored = (yield* context.store.replaceSources(bundle.sources, (yield* platform.now), context.key, equivalence));
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
      yield* platform.emit(json, result, `Ingested ${result.messages} active messages across ${result.conversations} conversations from ${result.sources.length} sources`);
      return;
    }
    if (command === "ingest" && subcommand === "x-archive" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir", "input", "overlap-source"], ["json"]);
      const input = absolutePrivatePath(parsed.options.get("input"), "--input");
      const paths = (yield* platform.initialize((yield* platform.paths(parsed.options.get("data-dir")))));
      const key = (yield* platform.installKey(paths.installKey));
      yield* platform.stderr("Validating one private X archive locally; no data is uploaded.\n");
      const archive = (yield* platform.readXArchive(input));
      const snapshot = normalizeXArchive(archive, key);
      yield* platform.stderr(`Validated ${snapshot.messages.length} messages across ${snapshot.conversations.length} ${snapshot.conversations.length === 1 ? "conversation" : "conversations"}.\n`);
      const store = (yield* platform.openStore(paths.database));
      const overlapSourceId = parsed.options.get("overlap-source");
      const beeperXSources = (yield* store.listSources()).filter((source) => source.kind === "bundle" && source.provider === "beeper" && source.network === "x");
      const matchingBeeperSources: Array<ReturnType<LocalStore["listSources"]>[number]> = [];
      for (const source of beeperXSources) {
        const privateSource = yield* store.source(source.id, true);
        if (privateSource !== null && xArchiveMatchesBeeperSource(archive, privateSource))
          matchingBeeperSources.push(source);
      }
      if (overlapSourceId === undefined && matchingBeeperSources.length > 0) {
        const ids = matchingBeeperSources.map(({ id }) => id).join(", ");
        return yield* Effect.fail(commandFailure(new CliError("conflict", `A Beeper X source for this exact account already exists; inspect sources and rerun with --overlap-source ${ids}`)));
      }
      const equivalence = overlapSourceId === undefined
        ? undefined
        : planXArchiveEquivalence(archive, snapshot, (yield* store.sourceOverlapEvidence(overlapSourceId)));
      if (equivalence !== undefined) {
        yield* platform.stderr(`Proved ${equivalence.messages.length} exact message overlaps with the named Beeper source; they will be reconciled atomically.\n`);
      }
      yield* platform.stderr("Updating the private local Message Like Me store atomically.\n");
      const stored = (yield* store.replaceSourcesWithProgress([snapshot], (yield* platform.now), key, equivalence));
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
      (yield* platform.emit(json, result, `Ingested ${result.imported.messages} X archive messages across ${result.imported.conversations} conversations${result.reconciliation === null
        ? ""
        : `; reconciled ${result.reconciliation.messages} exact Beeper duplicates`}`));
      return;
    }
    if (command === "ingest" && subcommand === "contacts" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir", "addressbook"], ["json"]);
      const context = (yield* platform.writableSession(parsed.options.get("data-dir")));
      const override = parsed.options.get("addressbook");
      const sourcePath = override === undefined
        ? platform.defaultContactsDirectory
        : absolutePrivatePath(override, "--addressbook");
      const snapshot = (yield* platform.readContacts(sourcePath, context.key));
      const stored = (yield* context.store.enrichContacts(snapshot, (yield* platform.now), context.key));
      const result = {
        ...stored,
        source: {
          databases: snapshot.sources.length,
          bytes: snapshot.sources.reduce((sum, source) => sum + source.bytes, 0),
          schemaSha256: snapshot.sources.map((source) => source.schemaSha256),
        },
        warnings: snapshot.warnings,
      };
      yield* platform.emit(json, result, `Matched ${stored.matched} direct conversations and enriched ${stored.enriched} private labels`);
      return;
    }
    if (command === "contacts" && subcommand === "list" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir", "min-outgoing", "limit"], ["json", "private"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const contacts = (yield* context.store.listContacts({
        privateLabels: parsed.flags.has("private"),
        minimumOutgoing: integerOption(parsed, "min-outgoing", 1, 0, 10000000),
        limit: integerOption(parsed, "limit", 50, 1, 1000),
      }));
      yield* platform.emit(json, { contacts }, `${contacts.length} contacts`);
      return;
    }
    if (command === "sources" && subcommand === "list" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir"], ["json", "private"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const sources = (yield* context.store.listSources(parsed.flags.has("private")));
      yield* platform.emit(json, { sources }, `${sources.length} message sources`);
      return;
    }
    if (command === "sources" && subcommand === "show" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir"], ["json", "private"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const source = (yield* context.store.source(identifier, parsed.flags.has("private")));
      if (source === null)
        return yield* Effect.fail(commandFailure(new CliError("not-found", `Unknown source ${identifier}`)));
      yield* platform.emit(json, source, `Message source ${identifier}`);
      return;
    }
    if (command === "contacts" && subcommand === "show" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir"], ["json", "private"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const detail = (yield* safeContactDetail(context.store, identifier, parsed.flags.has("private")));
      yield* platform.emit(json, detail, `Contact ${identifier}`);
      return;
    }
    if (command === "contacts" && subcommand === "resolve" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir", "limit"], ["json", "private"]);
      if (!parsed.flags.has("private")) {
        return yield* Effect.fail(commandFailure(new CliError("usage", "contacts resolve requires --private")));
      }
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const matches = (yield* context.store.resolvePrivateContacts(identifier, integerOption(parsed, "limit", 10, 1, 50)));
      yield* platform.emit(json, { exact: true, matches }, `${matches.length} exact private contact matches`);
      return;
    }
    if (command === "routes" && subcommand === "list" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir", "output"], ["json", "private"]);
      const output = absolutePrivatePath(parsed.options.get("output"), "--output");
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const routes = (yield* context.store.routeCandidates(identifier, parsed.flags.has("private")));
      if (routes === null)
        return yield* Effect.fail(commandFailure(new CliError("not-found", `Unknown contact ${identifier}`)));
      const eligible = routes.candidates.filter(({ actionability }) => actionability.state === "wrench-binding-eligible");
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
      yield* artifacts.write(output, bytes);
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
      yield* platform.emit(json, receipt, `Wrote ${routes.candidates.length} exact source-conversation routes to a private file`);
      return;
    }
    if (command === "inspect" && subcommand === "tempo" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir", "session-gap", "burst-gap"], ["json"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const metrics = (yield* contactMetrics(context.store, identifier, metricOptions(parsed)));
      const result = compactMetrics(metrics);
      yield* platform.emit(json, result, `Tempo metrics for ${identifier}: ${metrics.tempo.responseEpisodes} response episodes`);
      return;
    }
    if (command === "inspect" && subcommand === "sessions" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir", "limit", "session-gap", "burst-gap"], ["json"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const metrics = (yield* contactMetrics(context.store, identifier, metricOptions(parsed)));
      const limit = integerOption(parsed, "limit", 20, 1, 1000);
      const sessions = metrics.sessions.slice(-limit);
      const result = { contactId: identifier, total: metrics.sessions.length, sessions };
      yield* platform.emit(json, result, `${sessions.length} of ${metrics.sessions.length} sessions for ${identifier}`);
      return;
    }
    if (command === "study" && subcommand === "prepare" && identifier !== undefined) {
      rejectUnused(parsed, [
        "data-dir", "output", "limit", "after", "before", "session-gap", "burst-gap",
      ], ["json"]);
      const output = absolutePrivatePath(parsed.options.get("output"), "--output");
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const after = canonicalTimestampOption(parsed, "after");
      const before = canonicalTimestampOption(parsed, "before");
      const evidence = yield* contactEvidence(context.store, identifier, { after, before }).pipe(Effect.mapError((failure) => failure.cause instanceof CliError ? failure : commandFailure(new CliError("usage", failure.cause instanceof Error ? failure.cause.message : String(failure.cause), { cause: failure.cause }))));
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier, { ...metricOptions(parsed), reactionFacts: evidence.reactions });
      const packet = buildStudyPacket(evidence.messages, metrics, {
        limit: integerOption(parsed, "limit", 24, 1, 50),
        generatedAt: (yield* platform.now),
        evidenceRevision: evidence.evidenceRevision,
        evidenceWindow: { after, before },
      });
      const bytes = prettyJson(packet);
      const packetSha256 = sha256(bytes);
      const studyReceipt = {
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
      };
      yield* artifacts.publishWithReceipt(output, bytes, context.store.recordStudyPacket(studyReceipt), context.store.studyPacketReceiptStatus(studyReceipt));
      const result = {
        contactId: identifier,
        corpusRevision: metrics.corpusRevision,
        evidenceRevision: evidence.evidenceRevision,
        packetSha256,
        examples: packet.examples.length,
        evidenceWindow: packet.evidenceWindow,
        output,
      };
      yield* platform.emit(json, result, `Prepared ${packet.examples.length} private study examples at ${output} (SHA-256 ${packetSha256})`);
      return;
    }
    if (command === "ensoul" && subcommand === "prepare" && identifier !== undefined) {
      rejectUnused(parsed, [
        "data-dir", "subject", "output", "limit", "after", "before", "session-gap", "burst-gap",
      ], ["json"]);
      const subjectRole = ensoulSubjectOption(parsed);
      const output = absolutePrivatePath(parsed.options.get("output"), "--output");
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const scope = (yield* requireContact(context.store, identifier));
      if (scope.group || scope.participantCount !== 1) {
        return yield* Effect.fail(commandFailure(new CliError("usage", "Ensoul message packets require a direct one-to-one scope")));
      }
      if (subjectRole === "contact"
        && (!/^person_[a-f0-9]{64}$/u.test(identifier)
          || scope.scopeKind !== "person"
          || scope.group
          || scope.participantCount !== 1)) {
        return yield* Effect.fail(commandFailure(new CliError("usage", "--subject contact requires an exact direct person_ scope resolved from Contacts")));
      }
      const after = canonicalTimestampOption(parsed, "after");
      const before = canonicalTimestampOption(parsed, "before");
      const evidence = yield* contactEvidence(context.store, identifier, { after, before }).pipe(Effect.mapError((failure) => failure.cause instanceof CliError ? failure : commandFailure(new CliError("usage", failure.cause instanceof Error ? failure.cause.message : String(failure.cause), { cause: failure.cause }))));
      const messages = ensoulSubjectMessages(evidence.messages, subjectRole);
      const reactions = ensoulSubjectReactions(evidence.reactions, subjectRole);
      const metrics = analyzeContact(messages, evidence.corpusRevision, identifier, { ...metricOptions(parsed), reactionFacts: reactions });
      const generatedAt = yield* platform.now.pipe(Effect.mapError((failure) => usageFailure(failure.cause)));
      const packet = yield* Effect.try({ try: () => buildEnsoulMessagesSourcePacketV1(messages, metrics, {
          subjectRole,
          contactScopeKind: scope.scopeKind,
          scopeContext: {
            group: scope.group,
            participantCount: scope.participantCount,
            conversationCount: scope.conversationCount,
            services: scope.services,
          },
          generatedAt,
          evidenceRevision: evidence.evidenceRevision,
          evidenceWindow: { after, before },
          limit: integerOption(parsed, "limit", 24, 1, 50),
        }), catch: usageFailure });
      const bytes = prettyJson(packet);
      const packetSha256 = sha256(bytes);
      yield* artifacts.write(output, bytes);
      const result = {
        subject: subjectRole,
        contactId: identifier,
        corpusRevision: packet.scope.limits.corpusRevision,
        evidenceRevision: packet.scope.sourceRevision,
        packetId: packet.packetId,
        packetDigest: packet.packetDigest,
        packetSha256,
        records: packet.records.length,
        sessionGapSeconds: packet.scope.limits.sessionGapSeconds,
        burstGapSeconds: packet.scope.limits.burstGapSeconds,
        scope: {
          kind: packet.scope.limits.contactScopeKind,
          group: packet.scope.limits.group,
          participantCount: packet.scope.limits.participantCount,
          conversationCount: packet.scope.limits.conversationCount,
          services: packet.scope.limits.services,
        },
        evidenceWindow: {
          after: packet.scope.limits.after,
          before: packet.scope.limits.before,
        },
        output,
      };
      yield* platform.emit(json, result, `Prepared ${packet.records.length} private Ensoul message records at ${output} (SHA-256 ${packetSha256})`);
      return;
    }
    if (command === "evaluate" && subcommand === "prepare" && identifier !== undefined) {
      rejectUnused(parsed, [
        "data-dir", "after", "before", "prompt-output", "reference-output", "limit",
        "session-gap", "burst-gap",
      ], ["json"]);
      const promptOutput = absolutePrivatePath(parsed.options.get("prompt-output"), "--prompt-output");
      const referenceOutput = absolutePrivatePath(parsed.options.get("reference-output"), "--reference-output");
      if (promptOutput === referenceOutput) {
        return yield* Effect.fail(commandFailure(new CliError("usage", "--prompt-output and --reference-output must be different paths")));
      }
      const after = canonicalTimestampOption(parsed, "after", true)!;
      const before = canonicalTimestampOption(parsed, "before");
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const evidence = yield* contactEvidence(context.store, identifier, { after, before }).pipe(Effect.mapError((failure) => failure.cause instanceof CliError ? failure : commandFailure(new CliError("usage", failure.cause instanceof Error ? failure.cause.message : String(failure.cause), { cause: failure.cause }))));
      const metrics = analyzeContact(evidence.messages, evidence.corpusRevision, identifier, { ...metricOptions(parsed), reactionFacts: evidence.reactions });
      const packets = buildEvaluationPackets(evidence.messages, metrics, {
        after,
        before,
        limit: integerOption(parsed, "limit", 8, 1, 25),
        generatedAt: (yield* platform.now),
        evidenceRevision: evidence.evidenceRevision,
      });
      if (packets.prompt.cases.length === 0) {
        return yield* Effect.fail(commandFailure(new CliError("not-found", "No complete held-out response cases exist in that time window")));
      }
      yield* artifacts.writePair([
        { path: promptOutput, bytes: prettyJson(packets.prompt) },
        { path: referenceOutput, bytes: prettyJson(packets.reference) },
      ]);
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
      yield* platform.emit(json, result, `Prepared ${packets.prompt.cases.length} held-out cases. Draft from ${promptOutput} before opening ${referenceOutput}`);
      return;
    }
    if (command === "profile" && subcommand === "apply" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const path = absolutePrivatePath(identifier, "Profile path");
      const profile = (yield* platform.readProfile(path));
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      yield* context.store.applyProfile(profile, (yield* platform.now));
      const result = { applied: true, contactId: profile.contactId, corpusRevision: profile.corpusRevision };
      yield* platform.emit(json, result, `Applied current profile for ${profile.contactId}`);
      return;
    }
    if (command === "profile" && subcommand === "show" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      yield* requireContact(context.store, identifier);
      const result = (yield* context.store.profile(identifier));
      if (result === null)
        return yield* Effect.fail(commandFailure(new CliError("not-found", `No profile exists for ${identifier}`)));
      yield* platform.emit(json, result, `${result.state} profile for ${identifier}`);
      return;
    }
    if (command === "profile" && subcommand === "export" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir", "output"], ["json"]);
      const output = absolutePrivatePath(parsed.options.get("output"), "--output");
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      yield* requireContact(context.store, identifier);
      const result = (yield* context.store.profile(identifier));
      if (result === null)
        return yield* Effect.fail(commandFailure(new CliError("not-found", `No profile exists for ${identifier}`)));
      yield* artifacts.write(output, prettyJson(result.profile));
      const receipt = { contactId: identifier, state: result.state, output };
      yield* platform.emit(json, receipt, `Exported ${result.state} profile to ${output}`);
      return;
    }
    if (command === "context" && subcommand !== undefined && identifier === undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const contactId = subcommand;
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const result = {
        contact: (yield* safeContactDetail(context.store, contactId, false)),
        metrics: compactMetrics((yield* contactMetrics(context.store, contactId))),
        profile: (yield* context.store.profile(contactId)),
      };
      yield* platform.emit(json, result, `Drafting context for ${contactId}`);
      return;
    }
    if (command === "handoff" && subcommand === "prepare" && identifier !== undefined) {
      rejectUnused(parsed, [
        "data-dir", "request", "ghostget-context", "draft", "output",
      ], ["json"]);
      const requestPath = absolutePrivatePath(parsed.options.get("request"), "--request");
      const ghostgetContextPath = absolutePrivatePath(parsed.options.get("ghostget-context"), "--ghostget-context");
      const draftPath = absolutePrivatePath(parsed.options.get("draft"), "--draft");
      const output = absolutePrivatePath(parsed.options.get("output"), "--output");
      if (new Set([requestPath, ghostgetContextPath, draftPath, output]).size !== 4) {
        return yield* Effect.fail(commandFailure(new CliError("usage", "Handoff request, Ghostget context, draft, and output paths must be different")));
      }
      const request = yield* platform.readPrivateJson(requestPath, "Private handoff request file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes).pipe(
        Effect.flatMap((value) => Effect.try({ try: () => parseAgentMessageHandoffRequestV1(value), catch: commandFailure })),
        Effect.mapError((failure) => agenticContractFailure(failure.cause, "Private handoff input")),
      );
      const ghostgetContext = yield* platform.readPrivateJson(ghostgetContextPath, "Private Ghostget context file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes).pipe(
        Effect.flatMap((value) => Effect.try({ try: () => parseGhostgetMessagingContextBindingV1(value), catch: commandFailure })),
        Effect.mapError((failure) => agenticContractFailure(failure.cause, "Private handoff input")),
      );
      const draft = yield* platform.readPrivateJson(draftPath, "Private draft file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes).pipe(
        Effect.flatMap((value) => Effect.try({ try: () => parseAgentMessageDraftV1(value), catch: commandFailure })),
        Effect.mapError((failure) => agenticContractFailure(failure.cause, "Private handoff input")),
      );
      const createdAt = (yield* platform.now);
      if (ghostgetContext.validatedAt > createdAt || ghostgetContext.expiresAt <= createdAt) {
        return yield* Effect.fail(commandFailure(new CliError("conflict", "The private Ghostget context is not current; collect a fresh exact context")));
      }
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      yield* Effect.gen(function* () {
        const preparation = (yield* context.store.handoffPreparation(identifier, request.routeCandidateId));
        const expiresAt = handoffExpiry(createdAt, ghostgetContext.expiresAt, AGENTIC_MESSAGING_V1_LIMITS.handoffLifetimeMilliseconds);
        const handoff = yield* Effect.try({ try: () => createAgentMessageHandoffV1({
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
          ghostgetContext,
          draft,
        }), catch: commandFailure });
        const audit = yield* artifacts.publishWithReceipt(output, prettyJson(handoff), context.store.recordPreparedHandoff(handoff), context.store.preparedHandoffReceiptStatus(handoff));
        yield* platform.emit(json, audit, `Prepared private handoff ${audit.handoffId} with ${audit.partCount} message parts`);
      }).pipe(Effect.mapError((failure) => failure.cause instanceof AgenticMessagingV1ContractError
        ? agenticContractFailure(failure.cause, "Private handoff") : failure));
      return;
    }
    if (command === "handoff" && subcommand === "verify" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const input = absolutePrivatePath(identifier, "Handoff path");
      const handoff = yield* platform.readPrivateJson(input, "Private handoff file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes).pipe(
        Effect.flatMap((value) => Effect.try({ try: () => parseAgentMessageHandoffV1(value), catch: commandFailure })),
        Effect.mapError((failure) => agenticContractFailure(failure.cause, "Private handoff file")),
      );
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
        turnDigest: ghostgetMessagingTurnDigestV1(handoff),
        partCount: handoff.turn.bubbles.length,
        createdAt: handoff.createdAt,
        expiresAt: handoff.expiresAt,
        expired: handoff.expiresAt <= (yield* platform.now),
      };
      yield* platform.emit(json, result, `Verified private handoff ${handoff.handoffId}`);
      return;
    }
    if (command === "handoff" && subcommand === "record" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir", "ghostget-receipt"], ["json"]);
      const receiptPath = absolutePrivatePath(parsed.options.get("ghostget-receipt"), "--ghostget-receipt");
      const receipt = yield* platform.readPrivateJson(receiptPath, "Private Ghostget receipt file", AGENTIC_MESSAGING_V1_LIMITS.privateJsonBytes).pipe(
        Effect.mapError((failure) => agenticContractFailure(failure.cause, "Private Ghostget receipt file")),
      );
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const audit = yield* context.store.recordHandoffReceipt(identifier, receipt).pipe(Effect.mapError((failure) =>
        failure.cause instanceof AgenticMessagingV1ContractError ? agenticContractFailure(failure.cause, "Private Ghostget receipt file") : failure));
      yield* platform.emit(json, audit, `Recorded body-free Ghostget audit for ${audit.handoffId}`);
      return;
    }
    if (command === "handoffs" && subcommand === "show" && identifier !== undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const audit = (yield* context.store.handoffAudit(identifier));
      yield* platform.emit(json, audit, `${audit.state} handoff audit ${audit.handoffId}`);
      return;
    }
    if (command === "skill" && subcommand === "path" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const path = (yield* platform.skillPath);
      yield* platform.emit(json, { path }, path);
      return;
    }
    if (command === "skill" && subcommand === "install" && identifier === undefined) {
      rejectUnused(parsed, ["data-dir", "target", "scope", "project"], ["force", "json"]);
      const target = (parsed.options.get("target") ?? "codex") as SkillTarget;
      const scope = (parsed.options.get("scope") ?? "user") as SkillScope;
      if (target !== "codex" && target !== "claude" && target !== "agents") {
        return yield* Effect.fail(commandFailure(new CliError("usage", "--target must be codex, claude, or agents")));
      }
      if (scope !== "user" && scope !== "project") {
        return yield* Effect.fail(commandFailure(new CliError("usage", "--scope must be user or project")));
      }
      const project = parsed.options.get("project");
      if (project !== undefined && scope !== "project") {
        return yield* Effect.fail(commandFailure(new CliError("usage", "--project requires --scope project")));
      }
      const installed = (yield* platform.installSkill({
        target,
        scope,
        ...(project === undefined ? {} : { projectDirectory: project }),
        force: parsed.flags.has("force"),
      }));
      const destinations = Exit.isSuccess(installed.operation) ? installed.operation.value : null;
      const output = destinations === null ? Exit.asVoid(installed.operation) : yield* Effect.exit(platform.emit(json,
        { destination: destinations.messageLikeMe, destinations, target, scope },
        `Installed message-like-me and ensoul skills at ${destinations.messageLikeMe} and ${destinations.ensoul}`));
      const warning = skillInstallWarning({ ...installed, operation: Exit.isFailure(output) ? output : installed.operation });
      const diagnostic = warning === null ? Exit.void : yield* Effect.exit(platform.stderr(warning));
      // A broken diagnostic writer cannot replace a primary failure, even undefined.
      if (Exit.isFailure(output)) return yield* output;
      yield* diagnostic;
      return;
    }
    if (command === "doctor" && subcommand === undefined) {
      rejectUnused(parsed, ["data-dir"], ["json"]);
      const requested = (yield* platform.paths(parsed.options.get("data-dir")));
      const initialized = (yield* platform.exists(requested.database));
      if (!initialized) {
        const result = {
          ok: true,
          initialized: false,
          dataDirectory: requested.root,
          defaultMessagesDatabase: platform.defaultMessagesDatabase,
          defaultContactsDirectory: platform.defaultContactsDirectory,
        };
        yield* platform.emit(json, result, `Message Like Me is not initialized at ${requested.root}`);
        return;
      }
      const context = (yield* platform.existingSession(parsed.options.get("data-dir")));
      const status = (yield* context.store.doctor());
      const result = {
        ok: status.quickCheck === "ok" && status.foreignKeyViolations === 0,
        initialized: true,
        dataDirectory: context.paths.root,
        database: context.paths.database,
        ...status,
      };
      yield* platform.emit(json, result, result.ok ? "Message Like Me local state is healthy" : "Message Like Me local state needs attention");
      return;
    }
    return yield* Effect.fail(commandFailure(new CliError("usage", `Unknown command\n\n${HELP}`)));
  });
}
