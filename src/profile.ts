import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { CliError } from "./errors.ts";
import {
  LEGACY_PROFILE_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  type ProfileClaimV2,
  type StyleProfile,
  type StyleProfileV1,
  type StyleProfileV2,
} from "./types.ts";

type JsonObject = Record<string, unknown>;
const MAX_PROFILE_FILE_BYTES = 4 * 1024 * 1024;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("invalid-data", `${label} must be an object`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new CliError("invalid-data", `${label}.${key} is not supported`);
  }
  for (const key of keys) {
    if (!(key in value)) throw new CliError("invalid-data", `${label}.${key} is required`);
  }
}

function text(value: unknown, label: string, maximum = 4_096): string {
  if (typeof value !== "string") throw new CliError("invalid-data", `${label} must be text`);
  const result = value.trim();
  if (result.length < 1 || Buffer.byteLength(result) > maximum) {
    throw new CliError("invalid-data", `${label} must contain 1-${maximum} UTF-8 bytes`);
  }
  if (/\u0000/u.test(result)) throw new CliError("invalid-data", `${label} contains a NUL byte`);
  return result;
}

function textArray(value: unknown, label: string, maximumItems = 32): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new CliError("invalid-data", `${label} must contain at most ${maximumItems} items`);
  }
  return value.map((item, index) => text(item, `${label}[${index}]`, 1_024));
}

function isoTimestamp(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  const date = new Date(parsed);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== parsed) {
    throw new CliError("invalid-data", `${label} must be a canonical ISO timestamp`);
  }
  return parsed;
}

function nullableIsoTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : isoTimestamp(value, label);
}

function digest(value: unknown, label: string): string {
  const parsed = text(value, label, 64);
  if (!/^[a-f0-9]{64}$/u.test(parsed)) {
    throw new CliError("invalid-data", `${label} must be lowercase SHA-256`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string, maximum = 10_000_000): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new CliError("invalid-data", `${label} must be an integer from 0 through ${maximum}`);
  }
  return value as number;
}

function confidenceLevel(value: unknown, label: string): "low" | "medium" | "high" {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new CliError("invalid-data", `${label} must be low, medium, or high`);
  }
  return value;
}

function parseStyleProfileV1(value: unknown): StyleProfileV1 {
  const root = object(value, "profile");
  exactKeys(root, [
    "schemaVersion", "contactId", "corpusRevision", "packetSha256", "analyzedAt",
    "overview", "prose", "tempo", "replies", "contexts", "invariants", "avoid", "confidence",
  ], "profile");
  if (root.schemaVersion !== LEGACY_PROFILE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `profile.schemaVersion must be ${LEGACY_PROFILE_SCHEMA_VERSION}`);
  }
  const contactId = text(root.contactId, "profile.contactId", 128);
  const corpusRevision = text(root.corpusRevision, "profile.corpusRevision", 128);
  const packetSha256 = text(root.packetSha256, "profile.packetSha256", 64);
  if (!/^[a-f0-9]{64}$/u.test(packetSha256)) {
    throw new CliError("invalid-data", "profile.packetSha256 must be lowercase SHA-256");
  }

  const prose = object(root.prose, "profile.prose");
  exactKeys(prose, [
    "register", "capitalization", "punctuation", "vocabulary", "warmth", "humor",
    "openings", "closings", "notablePatterns",
  ], "profile.prose");
  const tempo = object(root.tempo, "profile.tempo");
  exactKeys(tempo, [
    "defaultBundle", "singleLongMessage", "multipleMessages", "responseTiming", "followUps",
  ], "profile.tempo");
  const replies = object(root.replies, "profile.replies");
  exactKeys(replies, ["usage", "useWhen", "avoidWhen"], "profile.replies");
  const confidence = object(root.confidence, "profile.confidence");
  exactKeys(confidence, ["overall", "limitations"], "profile.confidence");
  if (!Array.isArray(root.contexts) || root.contexts.length > 32) {
    throw new CliError("invalid-data", "profile.contexts must contain at most 32 items");
  }

  const overall = confidence.overall;
  if (overall !== "low" && overall !== "medium" && overall !== "high") {
    throw new CliError("invalid-data", "profile.confidence.overall must be low, medium, or high");
  }

  return {
    schemaVersion: LEGACY_PROFILE_SCHEMA_VERSION,
    contactId,
    corpusRevision,
    packetSha256,
    analyzedAt: isoTimestamp(root.analyzedAt, "profile.analyzedAt"),
    overview: text(root.overview, "profile.overview", 8_192),
    prose: {
      register: text(prose.register, "profile.prose.register"),
      capitalization: text(prose.capitalization, "profile.prose.capitalization"),
      punctuation: text(prose.punctuation, "profile.prose.punctuation"),
      vocabulary: text(prose.vocabulary, "profile.prose.vocabulary"),
      warmth: text(prose.warmth, "profile.prose.warmth"),
      humor: text(prose.humor, "profile.prose.humor"),
      openings: textArray(prose.openings, "profile.prose.openings"),
      closings: textArray(prose.closings, "profile.prose.closings"),
      notablePatterns: textArray(prose.notablePatterns, "profile.prose.notablePatterns"),
    },
    tempo: {
      defaultBundle: text(tempo.defaultBundle, "profile.tempo.defaultBundle"),
      singleLongMessage: text(tempo.singleLongMessage, "profile.tempo.singleLongMessage"),
      multipleMessages: text(tempo.multipleMessages, "profile.tempo.multipleMessages"),
      responseTiming: text(tempo.responseTiming, "profile.tempo.responseTiming"),
      followUps: text(tempo.followUps, "profile.tempo.followUps"),
    },
    replies: {
      usage: text(replies.usage, "profile.replies.usage"),
      useWhen: textArray(replies.useWhen, "profile.replies.useWhen"),
      avoidWhen: textArray(replies.avoidWhen, "profile.replies.avoidWhen"),
    },
    contexts: root.contexts.map((item, index) => {
      const context = object(item, `profile.contexts[${index}]`);
      exactKeys(context, [
        "when", "incomingPattern", "responseStrategy", "prosePattern", "tempoPattern", "evidenceExampleIds",
      ], `profile.contexts[${index}]`);
      return {
        when: text(context.when, `profile.contexts[${index}].when`),
        incomingPattern: text(context.incomingPattern, `profile.contexts[${index}].incomingPattern`),
        responseStrategy: text(context.responseStrategy, `profile.contexts[${index}].responseStrategy`),
        prosePattern: text(context.prosePattern, `profile.contexts[${index}].prosePattern`),
        tempoPattern: text(context.tempoPattern, `profile.contexts[${index}].tempoPattern`),
        evidenceExampleIds: textArray(context.evidenceExampleIds, `profile.contexts[${index}].evidenceExampleIds`),
      };
    }),
    invariants: textArray(root.invariants, "profile.invariants"),
    avoid: textArray(root.avoid, "profile.avoid"),
    confidence: {
      overall,
      limitations: textArray(confidence.limitations, "profile.confidence.limitations"),
    },
  };
}

function parseStyleProfileV2(value: unknown): StyleProfileV2 {
  const root = object(value, "profile");
  exactKeys(root, [
    "schemaVersion", "contactId", "corpusRevision", "packetSha256", "analyzedAt",
    "evidence", "overview", "prose", "tempo", "replies", "contexts", "claims",
    "invariants", "avoid", "confidence",
  ], "profile");
  if (root.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `profile.schemaVersion must be ${PROFILE_SCHEMA_VERSION}`);
  }
  const contactId = text(root.contactId, "profile.contactId", 128);
  const corpusRevision = digest(root.corpusRevision, "profile.corpusRevision");
  const packetSha256 = digest(root.packetSha256, "profile.packetSha256");

  const evidence = object(root.evidence, "profile.evidence");
  exactKeys(evidence, [
    "evidenceRevision", "firstMessageAt", "lastMessageAt", "messageCount",
    "outgoingTextMessages", "responseEpisodes", "studyExamples", "selectionAlgorithm",
    "after", "before",
  ], "profile.evidence");
  if (evidence.selectionAlgorithm !== "bounded-diverse-response-contexts-v1") {
    throw new CliError(
      "invalid-data",
      "profile.evidence.selectionAlgorithm must be bounded-diverse-response-contexts-v1",
    );
  }
  const firstMessageAt = nullableIsoTimestamp(evidence.firstMessageAt, "profile.evidence.firstMessageAt");
  const lastMessageAt = nullableIsoTimestamp(evidence.lastMessageAt, "profile.evidence.lastMessageAt");
  const after = nullableIsoTimestamp(evidence.after, "profile.evidence.after");
  const before = nullableIsoTimestamp(evidence.before, "profile.evidence.before");
  if (firstMessageAt !== null && lastMessageAt !== null && firstMessageAt > lastMessageAt) {
    throw new CliError("invalid-data", "profile.evidence.firstMessageAt must not follow lastMessageAt");
  }
  if (after !== null && before !== null && after >= before) {
    throw new CliError("invalid-data", "profile.evidence.after must be earlier than before");
  }

  const prose = object(root.prose, "profile.prose");
  exactKeys(prose, [
    "register", "capitalization", "punctuation", "vocabulary", "warmth", "humor",
    "openingPatterns", "closingPatterns", "notablePatterns",
  ], "profile.prose");
  const tempo = object(root.tempo, "profile.tempo");
  exactKeys(tempo, [
    "defaultBundle", "singleLongMessage", "multipleMessages", "responseTiming", "followUps",
  ], "profile.tempo");
  const replies = object(root.replies, "profile.replies");
  exactKeys(replies, ["usage", "useWhen", "avoidWhen"], "profile.replies");
  const confidence = object(root.confidence, "profile.confidence");
  exactKeys(confidence, [
    "overall", "prose", "tempo", "replies", "contexts", "limitations",
  ], "profile.confidence");
  if (!Array.isArray(root.contexts) || root.contexts.length > 32) {
    throw new CliError("invalid-data", "profile.contexts must contain at most 32 items");
  }
  if (!Array.isArray(root.claims) || root.claims.length > 64) {
    throw new CliError("invalid-data", "profile.claims must contain at most 64 items");
  }

  const contexts = root.contexts.map((item, index) => {
    const context = object(item, `profile.contexts[${index}]`);
    exactKeys(context, [
      "when", "incomingPattern", "responseStrategy", "prosePattern", "tempoPattern",
      "evidenceExampleIds",
    ], `profile.contexts[${index}]`);
    return {
      when: text(context.when, `profile.contexts[${index}].when`),
      incomingPattern: text(context.incomingPattern, `profile.contexts[${index}].incomingPattern`),
      responseStrategy: text(context.responseStrategy, `profile.contexts[${index}].responseStrategy`),
      prosePattern: text(context.prosePattern, `profile.contexts[${index}].prosePattern`),
      tempoPattern: text(context.tempoPattern, `profile.contexts[${index}].tempoPattern`),
      evidenceExampleIds: textArray(
        context.evidenceExampleIds,
        `profile.contexts[${index}].evidenceExampleIds`,
      ),
    };
  });
  const claims: ProfileClaimV2[] = root.claims.map((item, index) => {
    const claim = object(item, `profile.claims[${index}]`);
    exactKeys(claim, [
      "dimension", "statement", "basis", "appliesWhen", "supportExampleIds",
      "counterexampleIds", "supportCount", "confidence", "draftingConsequence",
    ], `profile.claims[${index}]`);
    if (
      claim.dimension !== "prose" && claim.dimension !== "tempo"
      && claim.dimension !== "reply" && claim.dimension !== "context"
    ) throw new CliError("invalid-data", `profile.claims[${index}].dimension is invalid`);
    if (claim.basis !== "measured" && claim.basis !== "inferred") {
      throw new CliError("invalid-data", `profile.claims[${index}].basis must be measured or inferred`);
    }
    return {
      dimension: claim.dimension,
      statement: text(claim.statement, `profile.claims[${index}].statement`),
      basis: claim.basis,
      appliesWhen: text(claim.appliesWhen, `profile.claims[${index}].appliesWhen`),
      supportExampleIds: textArray(
        claim.supportExampleIds,
        `profile.claims[${index}].supportExampleIds`,
      ),
      counterexampleIds: textArray(
        claim.counterexampleIds,
        `profile.claims[${index}].counterexampleIds`,
      ),
      supportCount: nonNegativeInteger(claim.supportCount, `profile.claims[${index}].supportCount`),
      confidence: confidenceLevel(claim.confidence, `profile.claims[${index}].confidence`),
      draftingConsequence: text(
        claim.draftingConsequence,
        `profile.claims[${index}].draftingConsequence`,
      ),
    };
  });

  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    contactId,
    corpusRevision,
    packetSha256,
    analyzedAt: isoTimestamp(root.analyzedAt, "profile.analyzedAt"),
    evidence: {
      evidenceRevision: digest(
        evidence.evidenceRevision,
        "profile.evidence.evidenceRevision",
      ),
      firstMessageAt,
      lastMessageAt,
      messageCount: nonNegativeInteger(evidence.messageCount, "profile.evidence.messageCount"),
      outgoingTextMessages: nonNegativeInteger(
        evidence.outgoingTextMessages,
        "profile.evidence.outgoingTextMessages",
      ),
      responseEpisodes: nonNegativeInteger(
        evidence.responseEpisodes,
        "profile.evidence.responseEpisodes",
      ),
      studyExamples: nonNegativeInteger(evidence.studyExamples, "profile.evidence.studyExamples", 50),
      selectionAlgorithm: "bounded-diverse-response-contexts-v1",
      after,
      before,
    },
    overview: text(root.overview, "profile.overview", 8_192),
    prose: {
      register: text(prose.register, "profile.prose.register"),
      capitalization: text(prose.capitalization, "profile.prose.capitalization"),
      punctuation: text(prose.punctuation, "profile.prose.punctuation"),
      vocabulary: text(prose.vocabulary, "profile.prose.vocabulary"),
      warmth: text(prose.warmth, "profile.prose.warmth"),
      humor: text(prose.humor, "profile.prose.humor"),
      openingPatterns: textArray(prose.openingPatterns, "profile.prose.openingPatterns"),
      closingPatterns: textArray(prose.closingPatterns, "profile.prose.closingPatterns"),
      notablePatterns: textArray(prose.notablePatterns, "profile.prose.notablePatterns"),
    },
    tempo: {
      defaultBundle: text(tempo.defaultBundle, "profile.tempo.defaultBundle"),
      singleLongMessage: text(tempo.singleLongMessage, "profile.tempo.singleLongMessage"),
      multipleMessages: text(tempo.multipleMessages, "profile.tempo.multipleMessages"),
      responseTiming: text(tempo.responseTiming, "profile.tempo.responseTiming"),
      followUps: text(tempo.followUps, "profile.tempo.followUps"),
    },
    replies: {
      usage: text(replies.usage, "profile.replies.usage"),
      useWhen: textArray(replies.useWhen, "profile.replies.useWhen"),
      avoidWhen: textArray(replies.avoidWhen, "profile.replies.avoidWhen"),
    },
    contexts,
    claims,
    invariants: textArray(root.invariants, "profile.invariants"),
    avoid: textArray(root.avoid, "profile.avoid"),
    confidence: {
      overall: confidenceLevel(confidence.overall, "profile.confidence.overall"),
      prose: confidenceLevel(confidence.prose, "profile.confidence.prose"),
      tempo: confidenceLevel(confidence.tempo, "profile.confidence.tempo"),
      replies: confidenceLevel(confidence.replies, "profile.confidence.replies"),
      contexts: confidenceLevel(confidence.contexts, "profile.confidence.contexts"),
      limitations: textArray(confidence.limitations, "profile.confidence.limitations"),
    },
  };
}

export function parseStyleProfile(value: unknown): StyleProfile {
  const root = object(value, "profile");
  if (root.schemaVersion === LEGACY_PROFILE_SCHEMA_VERSION) return parseStyleProfileV1(root);
  if (root.schemaVersion === PROFILE_SCHEMA_VERSION) return parseStyleProfileV2(root);
  throw new CliError(
    "invalid-data",
    `profile.schemaVersion must be ${LEGACY_PROFILE_SCHEMA_VERSION} or ${PROFILE_SCHEMA_VERSION}`,
  );
}

export async function readStyleProfile(path: string): Promise<StyleProfile> {
  let parsed: unknown;
  try {
    const handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      const privateMode = (before.mode & 0o077) === 0;
      const owned = typeof process.getuid !== "function" || before.uid === process.getuid();
      if (!before.isFile() || before.nlink !== 1 || !owned || !privateMode) {
        throw new CliError(
          "unsafe-path",
          "Profile must be one current-user-owned regular non-symlink file with private permissions",
        );
      }
      if (!Number.isSafeInteger(before.size) || before.size < 1 || before.size > MAX_PROFILE_FILE_BYTES) {
        throw new CliError(
          "invalid-data",
          `Profile must contain 1-${MAX_PROFILE_FILE_BYTES} bytes`,
        );
      }

      // Read through the validated descriptor and reserve one extra byte so a
      // concurrently growing file cannot cross the checked bound unnoticed.
      const bytes = Buffer.alloc(before.size + 1);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (
        offset !== before.size
        || after.dev !== before.dev
        || after.ino !== before.ino
        || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs
        || after.ctimeMs !== before.ctimeMs
      ) {
        throw new CliError("conflict", "Profile changed while it was being read");
      }
      parsed = JSON.parse(bytes.subarray(0, offset).toString("utf8")) as unknown;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new CliError("unsafe-path", `Profile path ${path} must not be a symbolic link`, {
        cause: error,
      });
    }
    throw new CliError("invalid-data", `Could not read profile JSON at ${path}`, { cause: error });
  }
  return parseStyleProfile(parsed);
}
