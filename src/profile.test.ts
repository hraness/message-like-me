import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStyleProfile, readStyleProfile } from "./profile.ts";
import { syntheticProfile, syntheticProfileV2 } from "./test-fixtures.ts";

describe("style profile validation", () => {
  test("parses the closed profile contract", () => {
    expect(parseStyleProfile(syntheticProfile())).toMatchObject({
      schemaVersion: 1,
      contactId: "contact_0123456789abcdef",
      confidence: { overall: "medium" },
    });
  });

  test("parses evidence-bound schema version two profiles", () => {
    expect(parseStyleProfile(syntheticProfileV2())).toMatchObject({
      schemaVersion: 2,
      contactId: "contact_0123456789abcdef",
      evidence: {
        evidenceRevision: "c".repeat(64),
        studyExamples: 8,
      },
      confidence: { tempo: "medium", replies: "low" },
    });
  });

  test("rejects extra fields and stale schema versions", () => {
    expect(() => parseStyleProfile(syntheticProfile({ remotePrompt: "upload it" }))).toThrow("not supported");
    expect(() => parseStyleProfile(syntheticProfile({ schemaVersion: 3 }))).toThrow("schemaVersion");
    expect(() => parseStyleProfile(syntheticProfileV2({
      evidence: { ...(syntheticProfileV2() as { evidence: object }).evidence, evidenceRevision: "nope" },
    }))).toThrow("evidenceRevision");
  });

  test("reads one bounded owner-private physical profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-profile-"));
    const path = join(root, "profile.json");
    try {
      await writeFile(path, JSON.stringify(syntheticProfile()), { mode: 0o600 });
      expect(await readStyleProfile(path)).toMatchObject({
        contactId: "contact_0123456789abcdef",
        confidence: { overall: "medium" },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects symlinked and group- or world-readable profile inputs", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-profile-path-"));
    const physical = join(root, "physical.json");
    const linked = join(root, "linked.json");
    try {
      await writeFile(physical, JSON.stringify(syntheticProfile()), { mode: 0o600 });
      await symlink(physical, linked);
      await expect(readStyleProfile(linked)).rejects.toThrow("symbolic link");

      await chmod(physical, 0o644);
      await expect(readStyleProfile(physical)).rejects.toThrow("private permissions");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects a profile before reading beyond its file-size bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-profile-bound-"));
    const path = join(root, "oversized.json");
    try {
      await writeFile(path, Buffer.alloc(4 * 1024 * 1024 + 1), { mode: 0o600 });
      await expect(readStyleProfile(path)).rejects.toThrow("4194304 bytes");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
