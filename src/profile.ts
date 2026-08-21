import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { CliError } from "./errors.ts";
import { PROFILE_SCHEMA_VERSION, type StyleProfileV1 } from "./types.ts";

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

export function parseStyleProfile(value: unknown): StyleProfileV1 {
  const root = object(value, "profile");
  exactKeys(root, [
    "schemaVersion", "contactId", "corpusRevision", "packetSha256", "analyzedAt",
    "overview", "prose", "tempo", "replies", "contexts", "invariants", "avoid", "confidence",
  ], "profile");
  if (root.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    throw new CliError("invalid-data", `profile.schemaVersion must be ${PROFILE_SCHEMA_VERSION}`);
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
    schemaVersion: PROFILE_SCHEMA_VERSION,
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

export async function readStyleProfile(path: string): Promise<StyleProfileV1> {
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
