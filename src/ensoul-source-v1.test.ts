import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonicalJson, sha256 } from "./canonical-json.ts";
import {
  buildEnsoulMessagesSourcePacketV1,
  ensoulSubjectMessages,
  ensoulSubjectReactions,
  type EnsoulMessagesSourcePacketV1,
} from "./ensoul-source-v1.ts";
import { analyzeContact } from "./metrics.ts";
import type { CorpusMessage, CorpusReactionFact } from "./types.ts";
import { writeSyntheticXPublicPostsArchive } from "./test-x-archive-fixture.ts";

const CORPUS_REVISION = "a".repeat(64);
const EVIDENCE_REVISION = "b".repeat(64);
const PERSON_ID = `person_${"c".repeat(64)}`;
const GENERATED_AT = "2026-09-02T12:00:00.000Z";

function message(
  id: string,
  sourceRowId: number,
  sentAt: string,
  direction: "incoming" | "outgoing",
  body: string | null,
  overrides: Partial<CorpusMessage> = {},
): CorpusMessage {
  return {
    id,
    sourceRowId,
    sourceGuid: `guid-${id}`,
    conversationId: "conversation_synthetic",
    sentAt,
    direction,
    body,
    bodySource: body === null ? "unavailable" : "text",
    kind: body === null ? "attachment" : "text",
    replyToSourceGuid: null,
    replyState: "none",
    editedAt: null,
    retractedAt: null,
    service: "synthetic",
    attachmentCount: body === null ? 1 : 0,
    ...overrides,
  };
}

function conversation(): readonly CorpusMessage[] {
  return Object.freeze([
    message("owner-opens", 1, "2026-08-01T10:00:00.000Z", "outgoing", "Owner opens"),
    message("system", 2, "2026-08-01T10:00:10.000Z", "incoming", "Joined", { kind: "system" }),
    message("contact-responds", 3, "2026-08-01T10:01:00.000Z", "incoming", "Contact responds"),
    message("retracted", 4, "2026-08-01T10:01:10.000Z", "incoming", "Removed", {
      retractedAt: "2026-08-01T10:01:20.000Z",
    }),
    message("owner-follows", 5, "2026-08-01T10:02:00.000Z", "outgoing", "Owner follows"),
  ]);
}

function packetFor(
  messages: readonly CorpusMessage[],
  subjectRole: "owner" | "contact",
  contactId = subjectRole === "contact" ? PERSON_ID : "conversation_synthetic",
): EnsoulMessagesSourcePacketV1 {
  const relative = ensoulSubjectMessages(messages, subjectRole);
  const metrics = analyzeContact(relative, CORPUS_REVISION, contactId);
  return buildEnsoulMessagesSourcePacketV1(relative, metrics, {
    subjectRole,
    contactScopeKind: subjectRole === "contact" ? "person" : "conversation",
    scopeContext: {
      group: false,
      participantCount: 1,
      conversationCount: 1,
      services: ["iMessage"],
    },
    generatedAt: GENERATED_AT,
    evidenceRevision: EVIDENCE_REVISION,
    evidenceWindow: {
      after: "2026-08-01T00:00:00.000Z",
      before: "2026-09-01T00:00:00.000Z",
    },
    limit: 4,
  });
}

describe("Ensoul messages source v1", () => {
  test("rebases message and reaction authorship onto the selected subject", () => {
    const messages = conversation();
    expect(ensoulSubjectMessages(messages, "owner").map(({ direction }) => direction))
      .toEqual(messages.map(({ direction }) => direction));
    expect(ensoulSubjectMessages(messages, "contact").map(({ direction }) => direction))
      .toEqual(["incoming", "outgoing", "outgoing", "outgoing", "incoming"]);

    const reaction: CorpusReactionFact = {
      id: "reaction", externalId: "external", targetExternalId: "target",
      conversationId: "conversation_synthetic", direction: "incoming", body: "heart",
      reactedAt: null, state: "active",
    };
    expect(ensoulSubjectReactions([reaction], "contact")[0]!.direction).toBe("outgoing");
  });

  test("emits subject-relative private records without system or retracted prose", () => {
    const owner = packetFor(conversation(), "owner");
    expect(owner.schemaVersion).toBe("ensoul.source-packet.v1");
    expect(owner.digestCanonicalization).toBe("JCS-RFC8785");
    expect(owner.scope.payloadSchema).toBe("ensoul.messages-source.v1");
    expect(owner.subject).toEqual({
      localId: "owner",
      kind: "owner",
      identityBasis: "local Message Like Me installation owner",
    });
    expect(owner.scope).toMatchObject({
      completeness: "sampled",
      adapter: "message-like-me",
      sourceCutoff: "2026-08-01T10:02:00.000Z",
      limits: {
        subjectRole: "owner",
        group: false,
        participantCount: 1,
        conversationCount: 1,
        services: ["iMessage"],
        after: "2026-08-01T00:00:00.000Z",
        before: "2026-09-01T00:00:00.000Z",
        sessionGapSeconds: 28_800,
        burstGapSeconds: 300,
      },
    });
    expect(owner.records.map(({ content, authorRole }) => [content.text, authorRole])).toEqual([
      ["Contact responds", "counterpart"],
      ["Owner follows", "subject"],
    ]);
    expect(owner.records.map(({ contentRole, authorshipConfidence, sentStatus }) =>
      [contentRole, authorshipConfidence, sentStatus])).toEqual([
      ["original", "strong", "received"],
      ["original", "strong", "sent"],
    ]);
    expect(JSON.stringify(owner)).not.toContain("Joined");
    expect(JSON.stringify(owner)).not.toContain("Removed");
    const episodeRoles = new Map<string, Set<string>>();
    for (const record of owner.records) {
      expect(record.provenance.runId).toMatch(/^response:sha256:[a-f0-9]{64}$/u);
      const roles = episodeRoles.get(record.provenance.runId) ?? new Set<string>();
      roles.add(record.authorRole);
      episodeRoles.set(record.provenance.runId, roles);
    }
    expect([...episodeRoles.values()].every((roles) =>
      roles.has("subject") && roles.has("counterpart"))).toBe(true);

    const contact = packetFor(conversation(), "contact");
    expect(contact.subject.localId).toBe(PERSON_ID);
    expect(contact.subject.kind).toBe("contact");
    expect(contact.scope.limits.subjectRole).toBe("contact");
    expect(contact.records.map(({ content, authorRole }) => [content.text, authorRole])).toEqual([
      ["Owner opens", "counterpart"],
      ["Contact responds", "subject"],
    ]);
    expect(contact.records.map(({ sentStatus }) => sentStatus)).toEqual(["sent", "received"]);
  });

  test("derives canonical record and packet digests deterministically", () => {
    const forward = packetFor(conversation(), "owner");
    const reverse = packetFor([...conversation()].reverse(), "owner");
    expect(reverse).toEqual(forward);

    for (const record of forward.records) {
      const { digest, ...base } = record;
      expect(digest).toBe(`sha256:${sha256(canonicalJson(base))}`);
      expect(record.provenance.contentSha256).toBe(sha256(canonicalJson(record.content)));
    }
    const { packetDigest, ...base } = forward;
    expect(packetDigest).toBe(`sha256:${sha256(canonicalJson(base))}`);
    expect(forward.packetId).toMatch(/^message-like-me:sha256:[a-f0-9]{64}$/u);
  });

  test("records the exact session and burst semantics that selected the evidence", () => {
    const relative = ensoulSubjectMessages(conversation(), "owner");
    const metrics = analyzeContact(relative, CORPUS_REVISION, "conversation_synthetic", {
      sessionGapSeconds: 3_600,
      burstGapSeconds: 60,
    });
    const packet = buildEnsoulMessagesSourcePacketV1(relative, metrics, {
      subjectRole: "owner",
      contactScopeKind: "conversation",
      scopeContext: {
        group: false,
        participantCount: 1,
        conversationCount: 2,
        services: ["iMessage", "SMS"],
      },
      generatedAt: GENERATED_AT,
      evidenceRevision: EVIDENCE_REVISION,
    });
    expect(packet.scope.limits.sessionGapSeconds).toBe(3_600);
    expect(packet.scope.limits.burstGapSeconds).toBe(60);
    expect(packet.scope.limits).toMatchObject({
      group: false,
      participantCount: 1,
      conversationCount: 2,
      services: ["iMessage", "SMS"],
    });
    expect(Object.keys(packet.scope.limits)).toHaveLength(28);
  });

  test("truncates Unicode on code-point boundaries within the inherited byte budget", () => {
    const packet = packetFor([
      message("long-in", 1, "2026-08-01T10:00:00.000Z", "incoming", "🫶".repeat(5_000)),
      message("short-out", 2, "2026-08-01T10:01:00.000Z", "outgoing", "ok"),
    ], "owner");
    const long = packet.records.find(({ provenance }) => provenance.sourceId === "long-in")!;
    expect(Buffer.byteLength(long.content.text, "utf8")).toBe(4_096);
    expect(long.content.text.endsWith("🫶")).toBe(true);
    expect(long.content.truncated).toBe(true);
    expect(packet.scope.limits.truncatedRecords).toBe(1);
    expect(packet.scope.limits.emittedBodyBytes).toBeLessThanOrEqual(256 * 1_024);
  });

  test("rejects contact attribution outside an exact direct person scope", () => {
    const relative = ensoulSubjectMessages(conversation(), "contact");
    const metrics = analyzeContact(relative, CORPUS_REVISION, "conversation_synthetic");
    expect(() => buildEnsoulMessagesSourcePacketV1(relative, metrics, {
      subjectRole: "contact",
      contactScopeKind: "conversation",
      scopeContext: {
        group: false,
        participantCount: 1,
        conversationCount: 1,
        services: ["iMessage"],
      },
      generatedAt: GENERATED_AT,
      evidenceRevision: EVIDENCE_REVISION,
    })).toThrow("exact direct person_ scope");
  });

  test("rejects ambiguous multi-participant scopes", () => {
    const relative = ensoulSubjectMessages(conversation(), "owner");
    const metrics = analyzeContact(relative, CORPUS_REVISION, "conversation_synthetic");
    expect(() => buildEnsoulMessagesSourcePacketV1(relative, metrics, {
      subjectRole: "owner",
      contactScopeKind: "conversation",
      scopeContext: {
        group: true,
        participantCount: 2,
        conversationCount: 1,
        services: ["iMessage"],
      },
      generatedAt: GENERATED_AT,
      evidenceRevision: EVIDENCE_REVISION,
    })).toThrow("direct one-to-one scope");
  });

  test("rejects selected messages dated after packet generation", () => {
    const future = [
      message("future-in", 1, "2027-01-01T10:00:00.000Z", "incoming", "future inbound"),
      message("future-out", 2, "2027-01-01T10:01:00.000Z", "outgoing", "future outbound"),
    ];
    const metrics = analyzeContact(future, CORPUS_REVISION, "conversation_synthetic");
    expect(() => buildEnsoulMessagesSourcePacketV1(future, metrics, {
      subjectRole: "owner",
      contactScopeKind: "conversation",
      scopeContext: {
        group: false,
        participantCount: 1,
        conversationCount: 1,
        services: ["iMessage"],
      },
      generatedAt: GENERATED_AT,
      evidenceRevision: EVIDENCE_REVISION,
    })).toThrow("cannot occur after packet generation");
  });

  test("passes the vendored canonical validator with a body-free receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "message-like-me-ensoul-validator-"));
    const path = join(root, "synthetic.ensoul-source.json");
    try {
      const packet = packetFor(conversation(), "owner");
      await writeFile(path, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
      const child = Bun.spawn([
        "python3",
        resolve(import.meta.dir, "../skills/ensoul/scripts/validate_source_packet.py"),
        path,
      ], { stderr: "pipe", stdout: "pipe" });
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({
        valid: true,
        adapter: "message-like-me",
        payloadSchema: "ensoul.messages-source.v1",
        records: packet.records.length,
        claims: 0,
      });
      expect(stdout).not.toContain("Contact responds");
      expect(stdout).not.toContain("Owner follows");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("ships an X public-post producer that round-trips through its validator", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "message-like-me-ensoul-x-producer-")));
    const output = join(root, "x-posts.ensoul-source.json");
    const overCapOutput = join(root, "over-cap.ensoul-source.json");
    try {
      const archive = await writeSyntheticXPublicPostsArchive(root);
      const scripts = resolve(import.meta.dir, "../skills/ensoul/scripts");
      const producer = Bun.spawn([
        "python3", join(scripts, "prepare_x_archive.py"), archive,
        "--output", output, "--limit", "2",
      ], { stderr: "pipe", stdout: "pipe" });
      const [producerExit, producerStdout, producerStderr] = await Promise.all([
        producer.exited,
        new Response(producer.stdout).text(),
        new Response(producer.stderr).text(),
      ]);
      expect(producerExit).toBe(0);
      expect(producerStderr).toBe("");
      expect(JSON.parse(producerStdout)).toMatchObject({ records: 2 });
      expect(await readFile(output, "utf8")).not.toContain("PRIVATE_DM_CANARY");

      const validator = Bun.spawn([
        "python3", join(scripts, "validate_source_packet.py"), output,
      ], { stderr: "pipe", stdout: "pipe" });
      const [validatorExit, validatorStdout, validatorStderr] = await Promise.all([
        validator.exited,
        new Response(validator.stdout).text(),
        new Response(validator.stderr).text(),
      ]);
      expect(validatorExit).toBe(0);
      expect(validatorStderr).toBe("");
      expect(JSON.parse(validatorStdout)).toMatchObject({
        valid: true,
        adapter: "x-archive",
        records: 2,
      });

      const overCap = Bun.spawn([
        "python3", join(scripts, "prepare_x_archive.py"), archive,
        "--output", overCapOutput, "--limit", "2001",
      ], { stderr: "pipe", stdout: "pipe" });
      const [overCapExit, overCapStderr] = await Promise.all([
        overCap.exited,
        new Response(overCap.stderr).text(),
      ]);
      expect(overCapExit).toBe(2);
      expect(overCapStderr).toContain("between 1 and 2000");
      expect(await Bun.file(overCapOutput).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
