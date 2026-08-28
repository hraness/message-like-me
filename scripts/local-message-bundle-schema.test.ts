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
  const artifactPrefixes = array(artifacts.prefixItems, "manifest.artifacts.prefixItems");
  expect(artifactPrefixes).toHaveLength(6);
  for (const [index, prefixValue] of artifactPrefixes.entries()) {
    const prefix = object(prefixValue, `manifest.artifacts.prefixItems[${index}]`);
    const refinement = object(
      array(prefix.allOf, `manifest.artifacts.prefixItems[${index}].allOf`)[1],
      `manifest.artifacts.prefixItems[${index}].allOf[1]`,
    );
    expect(refinement.type).toBe("object");
  }

  const mimeType = object(definitions.mimeType, "mimeType");
  expect(mimeType.maxLength).toBe(256);
  expect(mimeType.pattern).toBe("^[^\\u0000]*$");
  expect(mimeType.description).toBe("Runtime bound is 256 UTF-8 bytes.");
  const attachment = object(definitions.attachment, "attachment");
  const attachmentProperties = object(attachment.properties, "attachment.properties");
  expect(object(attachmentProperties.mimeType, "attachment.mimeType").$ref)
    .toBe("#/$defs/nullableMimeType");

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

test("local message bundle schema publishes the native WhatsApp v2 contract", async () => {
  const schema = object(JSON.parse(await readFile(join(
    import.meta.dir,
    "..",
    "schema",
    "local-message-bundle-v2.schema.json",
  ), "utf8")) as unknown, "schema");
  expect(schema.$id).toBe("https://messagelikeme.com/schema/local-message-bundle-v2.schema.json");
  const definitions = object(schema.$defs, "schema.$defs");
  expect(object(definitions.network, "network").const).toBe("whatsapp");
  const conversation = object(definitions.conversation, "conversation");
  const conversationProperties = object(conversation.properties, "conversation.properties");
  expect(object(conversationProperties.type, "conversation.type").enum).toEqual(["direct", "group"]);
  const manifest = object(definitions.manifest, "manifest");
  const properties = object(manifest.properties, "manifest.properties");
  expect(object(properties.schemaVersion, "manifest.schemaVersion").const).toBe(2);
  const source = object(properties.source, "manifest.source");
  const sourceProperties = object(source.properties, "manifest.source.properties");
  expect(object(sourceProperties.id, "manifest.source.id").const).toBe("wacli-local");
  expect(object(sourceProperties.version, "manifest.source.version").const).toBe("1.0.0");
  const provider = object(properties.provider, "manifest.provider");
  const providerProperties = object(provider.properties, "manifest.provider.properties");
  expect(object(providerProperties.id, "manifest.provider.id").const).toBe("whatsapp");
  expect(object(providerProperties.version, "manifest.provider.version").const).toBe("0.15.0");
  const counts = object(object(properties.counts, "manifest.counts").properties, "counts.properties");
  expect(object(counts.account, "counts.account")).toMatchObject({ minimum: 1, maximum: 1 });
});
