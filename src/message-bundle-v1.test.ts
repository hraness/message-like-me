import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import {
  LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS,
  LOCAL_MESSAGE_BUNDLE_V1_FORMAT,
  LOCAL_MESSAGE_BUNDLE_V1_LIMITS,
  LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID,
  LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION,
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID,
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
  MessageBundleV1ContractError,
  assertLocalMessageBundleV1SourceTransformVersion,
  isLocalMessageBundleV1SourceTransformVersion,
  localMessageBundleV1BundleSha256,
  localMessageBundleV1ManifestProjection,
  parseLocalMessageBundleV1Manifest,
  parseLocalMessageBundleV1Record,
} from "./message-bundle-v1.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

const GOLDEN = join(import.meta.dir, "fixtures", "beeper-message-like-me-v1");

describe("local message bundle v1 public contract", () => {
  test("parses the checked producer fixture without changing one canonical byte", async () => {
    const manifestBytes = await readFile(join(GOLDEN, "manifest.json"));
    const parsedManifest = parseLocalMessageBundleV1Manifest(
      JSON.parse(manifestBytes.toString("utf8")) as unknown,
    );
    expect(parsedManifest).toMatchObject({
      schemaVersion: LOCAL_MESSAGE_BUNDLE_V1_SCHEMA_VERSION,
      format: LOCAL_MESSAGE_BUNDLE_V1_FORMAT,
      source: {
        id: LOCAL_MESSAGE_BUNDLE_V1_SOURCE_ID,
        version: LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
      },
      provider: { id: LOCAL_MESSAGE_BUNDLE_V1_PROVIDER_ID },
    });
    expect(`${canonicalJson(parsedManifest)}\n`).toBe(manifestBytes.toString("utf8"));
    expect(localMessageBundleV1BundleSha256(
      localMessageBundleV1ManifestProjection(parsedManifest),
    )).toBe(parsedManifest.integrity.bundleSha256);
    expect(sha256(manifestBytes)).toBe(
      "dcef93293af9af0f3b0ff303992517ce2eece6d4bf0b7477e30c0b9d77a2c7f1",
    );

    for (const artifact of LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS) {
      const artifactText = await readFile(join(GOLDEN, artifact.path), "utf8");
      const lines = artifactText === "" ? [] : artifactText.slice(0, -1).split("\n");
      expect(artifactText === "" || artifactText.endsWith("\n")).toBeTrue();
      const records = lines.map((line, index) => parseLocalMessageBundleV1Record(
        JSON.parse(line) as unknown,
        artifact.kind,
        `${artifact.path}:${index + 1}`,
      ));
      expect(records.map((record) => `${canonicalJson(record)}\n`).join(""))
        .toBe(artifactText);
      expect(records).toHaveLength(parsedManifest.counts[artifact.kind]);
    }
  });

  test("makes source-transform compatibility explicit and fail-closed", async () => {
    expect(isLocalMessageBundleV1SourceTransformVersion("1.1.0")).toBeTrue();
    expect(isLocalMessageBundleV1SourceTransformVersion("1.0.0")).toBeFalse();
    expect(assertLocalMessageBundleV1SourceTransformVersion("1.1.0")).toBe("1.1.0");
    expect(() => assertLocalMessageBundleV1SourceTransformVersion("1.0.0"))
      .toThrow("supported source transform: 1.1.0");

    const manifest = object(JSON.parse(
      await readFile(join(GOLDEN, "manifest.json"), "utf8"),
    ) as unknown, "manifest");
    object(manifest.source, "manifest.source").version = "1.0.0";
    expect(() => parseLocalMessageBundleV1Manifest(manifest))
      .toThrow("supported source transform: 1.1.0");
  });

  test("rejects foreign record keys with a stable public contract error", async () => {
    const [line] = (await readFile(join(GOLDEN, "accounts.ndjson"), "utf8")).split("\n");
    const account = object(JSON.parse(line!) as unknown, "account");
    account.unexpected = true;
    try {
      parseLocalMessageBundleV1Record(account, "account", "accounts.ndjson:1");
      throw new Error("Expected strict record rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(MessageBundleV1ContractError);
      expect(error).toMatchObject({ code: "message-bundle-v1-contract" });
      expect(String(error)).toContain("must contain exactly");
    }
  });

  test("rejects symbols and accessors without invoking foreign getters", async () => {
    const [line] = (await readFile(join(GOLDEN, "accounts.ndjson"), "utf8")).split("\n");
    const withSymbol = object(JSON.parse(line!) as unknown, "account");
    Object.defineProperty(withSymbol, Symbol("foreign"), {
      enumerable: true,
      value: "private",
    });
    expect(() => parseLocalMessageBundleV1Record(withSymbol, "account"))
      .toThrow("enumerable string data properties");

    const withAccessor = object(JSON.parse(line!) as unknown, "account");
    let invoked = false;
    Object.defineProperty(withAccessor, "displayName", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "private";
      },
    });
    expect(() => parseLocalMessageBundleV1Record(withAccessor, "account"))
      .toThrow("enumerable string data properties");
    expect(invoked).toBeFalse();

    const conversationLine = (await readFile(
      join(GOLDEN, "conversations.ndjson"),
      "utf8",
    )).split("\n")[0]!;
    const conversation = object(JSON.parse(conversationLine) as unknown, "conversation");
    const participantIds = conversation.participantIds as unknown[];
    delete participantIds[0];
    expect(() => parseLocalMessageBundleV1Record(conversation, "conversation"))
      .toThrow("dense array of data properties");
  });

  test("rejects custom, proxied, and sparse manifest arrays through the public error type", async () => {
    const manifestText = await readFile(join(GOLDEN, "manifest.json"), "utf8");
    const customWarnings = object(JSON.parse(manifestText) as unknown, "manifest");
    const warnings = customWarnings.warnings as unknown[];
    let inheritedMapInvoked = false;
    Object.setPrototypeOf(warnings, Object.create(Array.prototype, {
      map: {
        get: () => {
          inheritedMapInvoked = true;
          return Array.prototype.map;
        },
      },
    }));
    expect(() => parseLocalMessageBundleV1Manifest(customWarnings))
      .toThrow(MessageBundleV1ContractError);
    expect(inheritedMapInvoked).toBeFalse();

    const proxiedArtifacts = object(JSON.parse(manifestText) as unknown, "manifest");
    proxiedArtifacts.artifacts = new Proxy(proxiedArtifacts.artifacts as unknown[], {});
    expect(() => parseLocalMessageBundleV1Manifest(proxiedArtifacts))
      .toThrow(MessageBundleV1ContractError);

    const sparseArtifacts = object(JSON.parse(manifestText) as unknown, "manifest");
    const sparse = sparseArtifacts.artifacts as unknown[];
    delete sparse[0];
    expect(() => parseLocalMessageBundleV1Manifest(sparseArtifacts))
      .toThrow(MessageBundleV1ContractError);
  });

  test("keeps runtime constants aligned with the published JSON Schema", async () => {
    const schema = object(JSON.parse(await readFile(
      join(import.meta.dir, "..", "schema", "local-message-bundle-v1.schema.json"),
      "utf8",
    )) as unknown, "schema");
    const definitions = object(schema.$defs, "schema.$defs");
    const manifest = object(definitions.manifest, "schema.$defs.manifest");
    const manifestProperties = object(manifest.properties, "manifest.properties");
    const source = object(manifestProperties.source, "manifest.properties.source");
    const sourceProperties = object(source.properties, "manifest.properties.source.properties");
    expect(object(sourceProperties.version, "source.version").const)
      .toBe(LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION);
    expect(object(definitions.identifier, "identifier").maxLength)
      .toBe(LOCAL_MESSAGE_BUNDLE_V1_LIMITS.identifierBytes);
    expect(object(definitions.body, "body").maxLength)
      .toBe(LOCAL_MESSAGE_BUNDLE_V1_LIMITS.bodyBytes);
    expect(object(definitions.artifact, "artifact").properties).toBeDefined();
  });
});
