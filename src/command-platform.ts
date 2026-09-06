import { lstat } from "node:fs/promises";
import { Context, Effect, Layer, Ref, type Scope } from "effect";

import { prettyJson } from "./canonical-json.ts";
import { readMessageBundle } from "./bundle.ts";
import { DEFAULT_CONTACTS_DIRECTORY, readMacOSContacts } from "./contacts.ts";
import { CliError } from "./errors.ts";
import { DEFAULT_IMESSAGE_DATABASE, readIMessageDatabase } from "./imessage.ts";
import type { CommandIo } from "./io.ts";
import { dataPaths, initializeDataPaths, loadOrCreateInstallKey, type DataPaths } from "./paths.ts";
import { readStyleProfile } from "./profile.ts";
import { readStablePrivateJson } from "./private-json.ts";
import { bundledSkillPath, installSkill } from "./skill-install.ts";
import { LocalStore } from "./store.ts";
import { readXArchive } from "./x-archive.ts";
import { commandFailure, translateAgenticContractError, translateBundleError, translateContactsError, translateIMessageError,
  translateXArchiveError, type CommandFailure } from "./command-failure.ts";
import { AgenticMessagingV1ContractError } from "./agentic-messaging-v1.ts";

type StoreMethod = "conversation" | "contactCorpus" | "replaceCorpus" | "replaceSources"
  | "enrichContacts" | "listContacts" | "listSources" | "source" | "sourceOverlapEvidence"
  | "resolvePrivateContacts" | "routeCandidates" | "profile" | "recordStudyPacket" | "applyProfile"
  | "handoffPreparation" | "recordPreparedHandoff" | "recordHandoffReceipt" | "handoffAudit" | "doctor"
  | "studyPacketReceiptStatus" | "preparedHandoffReceiptStatus";

/** Only declared operations cross the store boundary; the SQLite handle never escapes. */
export type CommandStore = {
  readonly [K in StoreMethod]: (...args: Parameters<LocalStore[K]>) => Effect.Effect<ReturnType<LocalStore[K]>, CommandFailure>;
} & {
  replaceSourcesWithProgress(...args: Parameters<LocalStore["replaceSources"]>): Effect.Effect<ReturnType<LocalStore["replaceSources"]>, CommandFailure>;
};
export type ExistingSession = Readonly<{ paths: DataPaths; store: CommandStore }>;
export type WritableSession = ExistingSession & Readonly<{ key: Uint8Array }>;

export interface CommandPlatformService {
  readonly defaultMessagesDatabase: string;
  readonly defaultContactsDirectory: string;
  readonly now: Effect.Effect<string, CommandFailure>;
  readonly skillPath: Effect.Effect<string, CommandFailure>;
  stdout(text: string): Effect.Effect<void, CommandFailure>;
  stderr(text: string): Effect.Effect<void, CommandFailure>;
  emit(json: boolean, value: unknown, human: string): Effect.Effect<void, CommandFailure>;
  paths(explicit?: string): Effect.Effect<DataPaths, CommandFailure>;
  initialize(paths: DataPaths): Effect.Effect<DataPaths, CommandFailure>;
  installKey(path: string): Effect.Effect<Uint8Array, CommandFailure>;
  exists(path: string): Effect.Effect<boolean, CommandFailure>;
  existingSession(explicit?: string): Effect.Effect<ExistingSession, CommandFailure, Scope.Scope>;
  writableSession(explicit?: string): Effect.Effect<WritableSession, CommandFailure, Scope.Scope>;
  openStore(path: string): Effect.Effect<CommandStore, CommandFailure, Scope.Scope>;
  readIMessage(path: string, key: Uint8Array): Effect.Effect<ReturnType<typeof readIMessageDatabase>, CommandFailure>;
  readContacts(path: string, key: Uint8Array): Effect.Effect<ReturnType<typeof readMacOSContacts>, CommandFailure>;
  readBundle(path: string, key: Uint8Array): Effect.Effect<Awaited<ReturnType<typeof readMessageBundle>>, CommandFailure>;
  readXArchive(path: string): Effect.Effect<Awaited<ReturnType<typeof readXArchive>>, CommandFailure>;
  readProfile(path: string): Effect.Effect<Awaited<ReturnType<typeof readStyleProfile>>, CommandFailure>;
  readPrivateJson(path: string, label: string, maximumBytes: number): Effect.Effect<unknown, CommandFailure>;
  installSkill(options: Parameters<typeof installSkill>[0]): Effect.Effect<Awaited<ReturnType<typeof installSkill>>, CommandFailure>;
}

export class CommandPlatform extends Context.Tag("@hraness/message-like-me/CommandPlatform")<CommandPlatform, CommandPlatformService>() {}

function translatedFailure(translate: (error: unknown) => never, error: unknown): CommandFailure {
  try { translate(error); } catch (translated) { return commandFailure(translated); }
}

/** Native calls, synchronous SQL transactions, and private-path setup remain here. */
export function commandPlatformLive(io: CommandIo,
  cleanupFailure: Ref.Ref<CommandFailure | null>): Layer.Layer<CommandPlatform> {
  const attempt = <A>(tryOperation: () => A): Effect.Effect<A, CommandFailure> =>
    Effect.try({ try: tryOperation, catch: commandFailure });
  const foreign = <A>(tryOperation: () => Promise<A>): Effect.Effect<A, CommandFailure> =>
    Effect.tryPromise({ try: tryOperation, catch: commandFailure });
  const paths = (explicit?: string): Effect.Effect<DataPaths, CommandFailure> => attempt(() => dataPaths(explicit));
  const initialize = (requested: DataPaths): Effect.Effect<DataPaths, CommandFailure> => foreign(() => initializeDataPaths(requested));
  const installKey = (path: string): Effect.Effect<Uint8Array, CommandFailure> => foreign(() => loadOrCreateInstallKey(path));
  const exists = (path: string): Effect.Effect<boolean, CommandFailure> => foreign(async () => {
    try { await lstat(path); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  });
  const openStore = (path: string): Effect.Effect<CommandStore, CommandFailure, Scope.Scope> => Effect.acquireRelease(
    attempt(() => LocalStore.open(path)),
    (store) => attempt(() => store.close()).pipe(Effect.matchEffect({
      onFailure: (failure) => Ref.set(cleanupFailure, failure),
      onSuccess: () => Effect.void,
    })),
  ).pipe(Effect.map((store): CommandStore => ({
    conversation: (...args) => attempt(() => store.conversation(...args)),
    contactCorpus: (...args) => attempt(() => store.contactCorpus(...args)),
    replaceCorpus: (...args) => attempt(() => store.replaceCorpus(...args)),
    replaceSources: (...args) => attempt(() => store.replaceSources(...args)),
    enrichContacts: (...args) => attempt(() => store.enrichContacts(...args)),
    listContacts: (...args) => attempt(() => store.listContacts(...args)),
    listSources: (...args) => attempt(() => store.listSources(...args)),
    source: (...args) => attempt(() => store.source(...args)),
    sourceOverlapEvidence: (...args) => attempt(() => store.sourceOverlapEvidence(...args)),
    resolvePrivateContacts: (...args) => attempt(() => store.resolvePrivateContacts(...args)).pipe(Effect.mapError((failure) =>
      failure.cause instanceof CliError ? failure : commandFailure(new CliError("usage", "Contact query must be bounded exact text", { cause: failure.cause })))),
    routeCandidates: (...args) => attempt(() => store.routeCandidates(...args)),
    profile: (...args) => attempt(() => store.profile(...args)),
    recordStudyPacket: (...args) => attempt(() => store.recordStudyPacket(...args)),
    applyProfile: (...args) => attempt(() => store.applyProfile(...args)),
    handoffPreparation: (...args) => attempt(() => store.handoffPreparation(...args)),
    recordPreparedHandoff: (...args) => attempt(() => store.recordPreparedHandoff(...args)).pipe(Effect.mapError((failure) =>
      failure.cause instanceof AgenticMessagingV1ContractError
        ? translatedFailure((error) => translateAgenticContractError(error, "Private handoff"), failure.cause) : failure)),
    recordHandoffReceipt: (...args) => attempt(() => store.recordHandoffReceipt(...args)).pipe(Effect.mapError((failure) =>
      failure.cause instanceof AgenticMessagingV1ContractError
        ? translatedFailure((error) => translateAgenticContractError(error, "Private Wrench receipt file"), failure.cause) : failure)),
    studyPacketReceiptStatus: (...args) => attempt(() => store.studyPacketReceiptStatus(...args)),
    preparedHandoffReceiptStatus: (...args) => attempt(() => store.preparedHandoffReceiptStatus(...args)),
    handoffAudit: (...args) => attempt(() => store.handoffAudit(...args)),
    doctor: (...args) => attempt(() => store.doctor(...args)),
    replaceSourcesWithProgress: (sources, now, key, equivalence) => attempt(() => store.replaceSources(
      sources, now, key, equivalence,
      ({ phase, completed, total }) => io.stderr(`Processed ${completed} of ${total} ${phase} inside the pending transaction.\n`),
    )),
  })));
  const existingSession = (explicit?: string): Effect.Effect<ExistingSession, CommandFailure, Scope.Scope> => Effect.gen(function* () {
    const requested = yield* paths(explicit);
    if (!(yield* exists(requested.root)) || !(yield* exists(requested.database))) {
      return yield* Effect.fail(commandFailure(new CliError("not-found", "Message Like Me is not initialized; run messagelikeme init or an ingest command")));
    }
    const initialized = yield* initialize(requested);
    return { paths: initialized, store: yield* openStore(initialized.database) };
  });
  const writableSession = (explicit?: string): Effect.Effect<WritableSession, CommandFailure, Scope.Scope> => Effect.gen(function* () {
    const initialized = yield* initialize(yield* paths(explicit));
    const key = yield* installKey(initialized.installKey);
    return { paths: initialized, key, store: yield* openStore(initialized.database) };
  });
  return Layer.succeed(CommandPlatform, {
    defaultMessagesDatabase: DEFAULT_IMESSAGE_DATABASE,
    defaultContactsDirectory: DEFAULT_CONTACTS_DIRECTORY,
    now: attempt(() => {
      const date = io.now();
      if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new CliError("internal", "Clock returned an invalid time");
      return date.toISOString();
    }),
    skillPath: attempt(bundledSkillPath),
    stdout: (text) => attempt(() => io.stdout(text)),
    stderr: (text) => attempt(() => io.stderr(text)),
    emit: (json, value, human) => attempt(() => io.stdout(json ? prettyJson(value) : `${human}\n`)),
    paths, initialize, installKey, exists, existingSession, writableSession, openStore,
    readIMessage: (path, key) => Effect.try({ try: () => readIMessageDatabase(path, { hmacKey: key }), catch: (error) => translatedFailure(translateIMessageError, error) }),
    readContacts: (path, key) => Effect.try({ try: () => readMacOSContacts(path, { hmacKey: key }), catch: (error) => translatedFailure(translateContactsError, error) }),
    readBundle: (path, key) => Effect.tryPromise({ try: () => readMessageBundle(path, { hmacKey: key }), catch: (error) => translatedFailure(translateBundleError, error) }),
    readXArchive: (path) => Effect.tryPromise({ try: () => readXArchive(path), catch: (error) => translatedFailure(translateXArchiveError, error) }),
    readProfile: (path) => foreign(() => readStyleProfile(path)),
    readPrivateJson: (path, label, maximumBytes) => foreign(() => readStablePrivateJson(path, label, maximumBytes)),
    installSkill: (options) => foreign(() => installSkill(options)),
  });
}
