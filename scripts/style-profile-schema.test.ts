import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseStyleProfile } from "../src/profile.ts";
import { syntheticProfileV2 } from "../src/test-fixtures.ts";
import type { StyleProfileV1, StyleProfileV2 } from "../src/types.ts";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function exactObjectKeys(schema: JsonRecord, keys: readonly string[], label: string): void {
  expect(schema.type, `${label} type`).toBe("object");
  expect(schema.additionalProperties, `${label} additionalProperties`).toBe(false);
  const properties = record(schema.properties, `${label}.properties`);
  expect(Object.keys(properties).sort(), `${label} properties`).toEqual([...keys].sort());
  expect([...(schema.required as string[])].sort(), `${label} required`).toEqual([...keys].sort());
}

const profile: StyleProfileV1 = {
  schemaVersion: 1,
  contactId: "contact_fixture",
  corpusRevision: "corpus_fixture",
  packetSha256: "a".repeat(64),
  analyzedAt: "2026-08-21T12:00:00.000Z",
  overview: "Concise, warm, and context sensitive.",
  prose: {
    register: "Informal.",
    capitalization: "Usually lowercase.",
    punctuation: "Light punctuation.",
    vocabulary: "Concrete wording.",
    warmth: "Warm without excess.",
    humor: "Occasional dry humor.",
    openings: ["Direct opening."],
    closings: ["Natural close."],
    notablePatterns: ["Answers the actionable point first."],
  },
  tempo: {
    defaultBundle: "One or two bubbles.",
    singleLongMessage: "Used for a connected explanation.",
    multipleMessages: "Used to separate distinct points.",
    responseTiming: "Timing varies with urgency.",
    followUps: "Short correction or addition when needed.",
  },
  replies: {
    usage: "Sparing.",
    useWhen: ["Disambiguating an older point."],
    avoidWhen: ["The immediately preceding message is clear."],
  },
  contexts: [{
    when: "Several concrete questions arrive together.",
    incomingPattern: "Multiple unrelated asks.",
    responseStrategy: "Cover each ask in order.",
    prosePattern: "Compact clauses.",
    tempoPattern: "Separate bubbles for separate topics.",
    evidenceExampleIds: ["example_fixture"],
  }],
  invariants: ["Preserve the intended meaning."],
  avoid: ["Inventing familiarity."],
  confidence: {
    overall: "medium",
    limitations: ["Synthetic example for schema verification."],
  },
};

test("style-profile-v1 schema and runtime parser share the complete v1 shape", async () => {
  expect(parseStyleProfile(profile)).toEqual(profile);
  const schema = record(
    JSON.parse(
      await readFile(join(import.meta.dir, "..", "schema", "style-profile-v1.schema.json"), "utf8"),
    ) as unknown,
    "schema",
  );
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  exactObjectKeys(schema, [
    "schemaVersion",
    "contactId",
    "corpusRevision",
    "packetSha256",
    "analyzedAt",
    "overview",
    "prose",
    "tempo",
    "replies",
    "contexts",
    "invariants",
    "avoid",
    "confidence",
  ], "profile");

  const properties = record(schema.properties, "schema.properties");
  expect(record(properties.schemaVersion, "schemaVersion").const).toBe(1);
  expect(record(properties.packetSha256, "packetSha256").pattern).toBe("^[a-f0-9]{64}$");
  expect(record(properties.analyzedAt, "analyzedAt").format).toBe("date-time");
  exactObjectKeys(record(properties.prose, "prose"), [
    "register",
    "capitalization",
    "punctuation",
    "vocabulary",
    "warmth",
    "humor",
    "openings",
    "closings",
    "notablePatterns",
  ], "prose");
  exactObjectKeys(record(properties.tempo, "tempo"), [
    "defaultBundle",
    "singleLongMessage",
    "multipleMessages",
    "responseTiming",
    "followUps",
  ], "tempo");
  exactObjectKeys(record(properties.replies, "replies"), [
    "usage",
    "useWhen",
    "avoidWhen",
  ], "replies");
  const contexts = record(properties.contexts, "contexts");
  expect(contexts.type).toBe("array");
  expect(contexts.maxItems).toBe(32);
  exactObjectKeys(record(contexts.items, "contexts.items"), [
    "when",
    "incomingPattern",
    "responseStrategy",
    "prosePattern",
    "tempoPattern",
    "evidenceExampleIds",
  ], "contexts.items");
  exactObjectKeys(record(properties.confidence, "confidence"), [
    "overall",
    "limitations",
  ], "confidence");
  const confidenceProperties = record(
    record(properties.confidence, "confidence").properties,
    "confidence.properties",
  );
  expect(record(confidenceProperties.overall, "confidence.overall").enum).toEqual([
    "low",
    "medium",
    "high",
  ]);

  const definitions = record(schema.$defs, "$defs");
  expect(record(definitions.identifier, "identifier")).toMatchObject({
    type: "string",
    minLength: 1,
    maxLength: 128,
  });
  expect(record(definitions.profileText, "profileText")).toMatchObject({
    type: "string",
    minLength: 1,
    maxLength: 4_096,
  });
  expect(record(definitions.textList, "textList")).toMatchObject({
    type: "array",
    maxItems: 32,
  });
  expect(record(record(definitions.textList, "textList").items, "textList.items")).toMatchObject({
    type: "string",
    minLength: 1,
    maxLength: 1_024,
  });
});

test("style-profile-v2 schema and runtime parser share the complete closed shape", async () => {
  const profileV2 = syntheticProfileV2() as StyleProfileV2;
  expect(parseStyleProfile(profileV2)).toEqual(profileV2);
  const schema = record(
    JSON.parse(
      await readFile(join(import.meta.dir, "..", "schema", "style-profile-v2.schema.json"), "utf8"),
    ) as unknown,
    "schema",
  );

  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  exactObjectKeys(schema, [
    "schemaVersion",
    "contactId",
    "corpusRevision",
    "packetSha256",
    "analyzedAt",
    "evidence",
    "overview",
    "prose",
    "tempo",
    "replies",
    "contexts",
    "claims",
    "invariants",
    "avoid",
    "confidence",
  ], "profile-v2");

  const properties = record(schema.properties, "schema.properties");
  expect(record(properties.schemaVersion, "schemaVersion").const).toBe(2);
  expect(record(properties.contactId, "contactId").$ref).toBe("#/$defs/identifier");
  expect(record(properties.corpusRevision, "corpusRevision").$ref).toBe("#/$defs/digest");
  expect(record(properties.packetSha256, "packetSha256").$ref).toBe("#/$defs/digest");
  expect(record(properties.analyzedAt, "analyzedAt").$ref).toBe("#/$defs/timestamp");

  exactObjectKeys(record(properties.evidence, "evidence"), [
    "evidenceRevision",
    "firstMessageAt",
    "lastMessageAt",
    "messageCount",
    "outgoingTextMessages",
    "responseEpisodes",
    "studyExamples",
    "selectionAlgorithm",
    "after",
    "before",
  ], "evidence");
  const evidenceProperties = record(
    record(properties.evidence, "evidence").properties,
    "evidence.properties",
  );
  expect(record(evidenceProperties.evidenceRevision, "evidenceRevision").$ref)
    .toBe("#/$defs/digest");
  expect(record(evidenceProperties.selectionAlgorithm, "selectionAlgorithm").const)
    .toBe("bounded-diverse-response-contexts-v1");
  expect(record(evidenceProperties.studyExamples, "studyExamples")).toMatchObject({
    type: "integer",
    minimum: 0,
    maximum: 50,
  });

  exactObjectKeys(record(properties.prose, "prose"), [
    "register",
    "capitalization",
    "punctuation",
    "vocabulary",
    "warmth",
    "humor",
    "openingPatterns",
    "closingPatterns",
    "notablePatterns",
  ], "prose");
  exactObjectKeys(record(properties.tempo, "tempo"), [
    "defaultBundle",
    "singleLongMessage",
    "multipleMessages",
    "responseTiming",
    "followUps",
  ], "tempo");
  exactObjectKeys(record(properties.replies, "replies"), [
    "usage",
    "useWhen",
    "avoidWhen",
  ], "replies");

  const contexts = record(properties.contexts, "contexts");
  expect(contexts).toMatchObject({ type: "array", maxItems: 32 });
  exactObjectKeys(record(contexts.items, "contexts.items"), [
    "when",
    "incomingPattern",
    "responseStrategy",
    "prosePattern",
    "tempoPattern",
    "evidenceExampleIds",
  ], "contexts.items");

  const claims = record(properties.claims, "claims");
  expect(claims).toMatchObject({ type: "array", maxItems: 64 });
  exactObjectKeys(record(claims.items, "claims.items"), [
    "dimension",
    "statement",
    "basis",
    "appliesWhen",
    "supportExampleIds",
    "counterexampleIds",
    "supportCount",
    "confidence",
    "draftingConsequence",
  ], "claims.items");
  const claimProperties = record(record(claims.items, "claims.items").properties, "claims.properties");
  expect(record(claimProperties.dimension, "claims.dimension").enum).toEqual([
    "prose",
    "tempo",
    "reply",
    "context",
  ]);
  expect(record(claimProperties.basis, "claims.basis").enum).toEqual(["measured", "inferred"]);

  exactObjectKeys(record(properties.confidence, "confidence"), [
    "overall",
    "prose",
    "tempo",
    "replies",
    "contexts",
    "limitations",
  ], "confidence");

  const definitions = record(schema.$defs, "$defs");
  expect(Object.keys(definitions).sort()).toEqual([
    "confidence",
    "count",
    "digest",
    "identifier",
    "nullableTimestamp",
    "profileText",
    "textList",
    "timestamp",
  ]);
  expect(record(definitions.digest, "digest")).toMatchObject({
    type: "string",
    pattern: "^[a-f0-9]{64}$",
  });
  expect(record(definitions.count, "count")).toMatchObject({
    type: "integer",
    minimum: 0,
    maximum: 10_000_000,
  });
  expect(record(definitions.confidence, "confidence").enum).toEqual([
    "low",
    "medium",
    "high",
  ]);

  const withUnknownField = {
    ...profileV2,
    unrecognized: true,
  };
  expect(() => parseStyleProfile(withUnknownField)).toThrow("profile.unrecognized is not supported");
});
