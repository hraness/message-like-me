import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

test("local message bundle schema publishes the frozen v1 contract", async () => {
  const schema = object(JSON.parse(await readFile(join(
    import.meta.dir,
    "..",
    "schema",
    "local-message-bundle-v1.schema.json",
  ), "utf8")) as unknown, "schema");
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect(schema.$id).toBe("https://messagelikeme.com/schema/local-message-bundle-v1.schema.json");
  expect(array(schema.oneOf, "schema.oneOf")).toHaveLength(7);

  const definitions = object(schema.$defs, "schema.$defs");
  const manifest = object(definitions.manifest, "manifest");
  const manifestProperties = object(manifest.properties, "manifest.properties");
  expect(object(manifestProperties.format, "manifest.format").const)
    .toBe("message-like-me.local-message-bundle");
  const counts = object(object(manifestProperties.counts, "manifest.counts").properties, "counts.properties");
  expect(object(counts.account, "counts.account").maximum).toBe(128);
  const artifacts = object(manifestProperties.artifacts, "manifest.artifacts");
  expect(artifacts.minItems).toBe(6);
  expect(artifacts.maxItems).toBe(6);
  expect(array(artifacts.prefixItems, "manifest.artifacts.prefixItems")).toHaveLength(6);

  const message = object(definitions.message, "message");
  const messageProperties = object(message.properties, "message.properties");
  expect(object(messageProperties.sortKey, "message.sortKey").$ref).toBe("#/$defs/identifier");
  expect(array(object(messageProperties.edit, "message.edit").oneOf, "message.edit.oneOf"))
    .toHaveLength(3);

  const reaction = object(definitions.reaction, "reaction");
  const reactionProperties = object(reaction.properties, "reaction.properties");
  expect(object(reactionProperties.messageProviderId, "reaction.messageProviderId").$ref)
    .toBe("#/$defs/identifier");
  expect(object(reactionProperties.reactedAt, "reaction.reactedAt").$ref)
    .toBe("#/$defs/nullableTimestamp");

  const tombstone = object(definitions.tombstone, "tombstone");
  const tombstoneProperties = object(tombstone.properties, "tombstone.properties");
  expect(object(tombstoneProperties.entityKind, "tombstone.entityKind").enum)
    .toEqual(["conversation", "message", "reaction"]);
});
