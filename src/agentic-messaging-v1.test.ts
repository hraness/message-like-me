import { describe, expect, test } from "bun:test";

import {
  AGENT_MESSAGE_DRAFT_V1_FORMAT,
  AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
  WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR,
  WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
  WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
  WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
  WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR,
  WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
  WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
  createAgentMessageHandoffV1,
  parseAgentMessageDraftV1,
  parseAgentMessageHandoffV1,
  parseAgentMessageHandoffRequestV1,
  parseWrenchMessagingContextBindingV1,
  parseWrenchMessagingReceiptBindingV1,
  wrenchMessagingTurnDigestV1,
} from "./agentic-messaging-v1.ts";
import { canonicalJson, sha256 } from "./canonical-json.ts";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function context(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    format: WRENCH_MESSAGING_CONTEXT_BINDING_V1_FORMAT,
    contractId: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_ID,
    contractHash: WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH,
    routeRef: "route_ref_synthetic_001",
    contextRef: "context_ref_synthetic_001",
    exactDataRevision: HASH_A,
    latestMessageRevision: HASH_B,
    validatedAt: "2026-08-27T11:59:00.000Z",
    expiresAt: "2026-08-27T12:10:00.000Z",
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: AGENTIC_MESSAGING_V1_SCHEMA_VERSION,
    format: AGENT_MESSAGE_DRAFT_V1_FORMAT,
    bubbles: [
      { id: "part_1", text: "synthetic first bubble", replyToRef: null },
      { id: "part_2", text: "synthetic second bubble", replyToRef: "message_ref_001" },
    ],
    ...overrides,
  };
}

function handoff() {
  return createAgentMessageHandoffV1({
    createdAt: "2026-08-27T12:00:00.000Z",
    expiresAt: "2026-08-27T12:05:00.000Z",
    contact: {
      contactId: "contact_synthetic",
      routeCandidateId: `route_${HASH_A}`,
      sourceId: `source_${HASH_B}`,
      conversationId: "conversation_synthetic",
    },
    evidence: {
      corpusRevision: HASH_A,
      sourceRevision: HASH_B,
      profileState: "current",
      profileEvidenceRevision: HASH_C,
    },
    wrenchContext: parseWrenchMessagingContextBindingV1(context()),
    draft: parseAgentMessageDraftV1(draft()),
  });
}

describe("agentic messaging v1 contract", () => {
  test("pins the exact Wrench compatibility descriptor and hash", () => {
    expect(canonicalJson(WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR)).toBe(
      "{\"contractId\":\"wrench.messaging-context-binding.v1\",\"fields\":[\"schemaVersion:1\",\"format:wrench.messaging-context-binding\",\"contractId:wrench.messaging-context-binding.v1\",\"contractHash:sha256\",\"routeRef:opaque\",\"contextRef:opaque\",\"exactDataRevision:sha256\",\"latestMessageRevision:sha256\",\"validatedAt:rfc3339\",\"expiresAt:rfc3339\"],\"format\":\"wrench.messaging-contract-descriptor\",\"schemaVersion\":1}",
    );
    expect(sha256(canonicalJson(WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_DESCRIPTOR)))
      .toBe(WRENCH_MESSAGING_CONTEXT_BINDING_V1_CONTRACT_HASH);
    expect(canonicalJson(WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR)).toBe(
      "{\"contractId\":\"wrench.messaging-receipt-binding.v1\",\"fields\":[\"schemaVersion:1\",\"format:wrench.messaging-receipt-binding\",\"contractId:wrench.messaging-receipt-binding.v1\",\"contractHash:sha256\",\"clientIntentSha256:sha256\",\"routeRefSha256:sha256\",\"contextRefSha256:sha256\",\"turnDigest:sha256\",\"previewDigest:sha256\",\"runId:opaque\",\"state:submitted|failed|partial|indeterminate\",\"partCount:uint\",\"provenPartCount:uint\",\"receiptSha256:sha256\",\"recordedAt:rfc3339\"],\"format\":\"wrench.messaging-contract-descriptor\",\"schemaVersion\":1}",
    );
    expect(sha256(canonicalJson(WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_DESCRIPTOR)))
      .toBe(WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH);
    expect(() => parseWrenchMessagingContextBindingV1(context({ contractHash: HASH_C })))
      .toThrow("unsupported contract identity");
    expect(() => parseWrenchMessagingContextBindingV1(context({ extra: true })))
      .toThrow("must contain exactly");
    expect(() => parseWrenchMessagingContextBindingV1(context({ latestMessageRevision: null })))
      .toThrow();
    expect(parseAgentMessageHandoffRequestV1({
      schemaVersion: 1,
      format: "message-like-me.agent-message-handoff-request",
      routeCandidateId: `route_${HASH_A}`,
    })).toMatchObject({ routeCandidateId: `route_${HASH_A}` });
    expect(() => parseAgentMessageHandoffRequestV1({
      schemaVersion: 1,
      format: "message-like-me.agent-message-handoff-request",
      routeCandidateId: "route-not-canonical",
    })).toThrow("canonical source-conversation route ID");
  });

  test("round-trips one evidence-bound ordered handoff with canonical integrity", () => {
    const value = handoff();
    expect(value.handoffId).toBe(`handoff_${value.integrity.canonicalSha256}`);
    expect(value.integrity.canonicalSha256)
      .toBe("9f054fb8eee492b24b3e35a0e3113c7f0e369bb0db3d3733f409cff824f28f61");
    expect(value.wrench.routeRefSha256).toBe(sha256("route_ref_synthetic_001"));
    expect(wrenchMessagingTurnDigestV1(value))
      .toBe("e187756ed8e224b4fc9fdf0dc33f9b44b753dd12b3b045c4521324268e4144ee");
    expect(value.turn.bubbles.map(({ id }) => id)).toEqual(["part_1", "part_2"]);
    const reparsed = parseAgentMessageHandoffV1(JSON.parse(JSON.stringify(value)) as unknown);
    expect(reparsed).toEqual(value);
    expect(Object.isFrozen(reparsed)).toBeTrue();

    const tampered = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const turn = tampered.turn as { bubbles: Array<{ text: string }> };
    turn.bubbles[0]!.text = "tampered body";
    expect(() => parseAgentMessageHandoffV1(tampered)).toThrow("integrity does not match");
  });

  test("rejects accessors, proxies, sparse arrays, controls, duplicate IDs, and unsafe bounds", () => {
    const accessor = context() as Record<string, unknown>;
    Object.defineProperty(accessor, "routeRef", { enumerable: true, get: () => "secret" });
    expect(() => parseWrenchMessagingContextBindingV1(accessor)).toThrow("data properties");
    expect(() => parseWrenchMessagingContextBindingV1(new Proxy(context() as object, {})))
      .toThrow("plain object");

    const sparse = new Array(2);
    sparse[0] = { id: "part_1", text: "one", replyToRef: null };
    expect(() => parseAgentMessageDraftV1(draft({ bubbles: sparse }))).toThrow("dense array");
    expect(() => parseAgentMessageDraftV1(draft({
      bubbles: [
        { id: "same", text: "one", replyToRef: null },
        { id: "same", text: "two", replyToRef: null },
      ],
    }))).toThrow("repeats a bubble ID");
    expect(() => parseAgentMessageDraftV1(draft({
      bubbles: [{ id: "part_1", text: "unsafe\u0007", replyToRef: null }],
    }))).toThrow("unsupported controls");
    expect(() => parseAgentMessageDraftV1(draft({
      bubbles: [{ id: "part_1", text: "\ud800", replyToRef: null }],
    }))).toThrow("well-formed");
    expect(() => parseAgentMessageDraftV1(draft({
      bubbles: [{ id: "part_1", text: "x".repeat(8 * 1024 + 1), replyToRef: null }],
    }))).toThrow("within 8192 UTF-8 bytes");
    expect(() => createAgentMessageHandoffV1({
      ...handoff(),
      createdAt: "2026-08-27T12:00:00.000Z",
      expiresAt: "2026-08-27T12:10:00.001Z",
      wrenchContext: parseWrenchMessagingContextBindingV1(context({
        expiresAt: "2026-08-27T12:20:00.000Z",
      })),
      draft: parseAgentMessageDraftV1(draft()),
    })).toThrow("timestamps are inconsistent");
  });

  test("enforces body-free receipt prefix state laws", () => {
    const receipt = (overrides: Record<string, unknown> = {}) => {
      const core = {
      schemaVersion: 1,
      format: "wrench.messaging-receipt-binding",
      contractId: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
      contractHash: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
      clientIntentSha256: HASH_A,
      routeRefSha256: sha256("route_ref_synthetic_001"),
      contextRefSha256: sha256("context_ref_synthetic_001"),
      turnDigest: HASH_C,
      previewDigest: HASH_A,
      runId: "run_synthetic_001",
      state: "partial",
      partCount: 3,
      provenPartCount: 1,
      recordedAt: "2026-08-27T12:01:00.000Z",
      ...overrides,
      };
      return { ...core, receiptSha256: sha256(canonicalJson(core)) };
    };
    const vectorHandoff = handoff();
    const vectorCore = {
      schemaVersion: 1,
      format: "wrench.messaging-receipt-binding",
      contractId: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_ID,
      contractHash: WRENCH_MESSAGING_RECEIPT_BINDING_V1_CONTRACT_HASH,
      clientIntentSha256: vectorHandoff.integrity.canonicalSha256,
      routeRefSha256: vectorHandoff.wrench.routeRefSha256,
      contextRefSha256: vectorHandoff.wrench.contextRefSha256,
      turnDigest: wrenchMessagingTurnDigestV1(vectorHandoff),
      previewDigest: HASH_A,
      runId: "run_synthetic_001",
      state: "submitted",
      partCount: 2,
      provenPartCount: 2,
      recordedAt: "2026-08-27T12:01:00.000Z",
    };
    expect(sha256(canonicalJson(vectorCore)))
      .toBe("cd1570937c4c6523454a76b465fa761322f4b50049bf91eabf6cba5e92ca27e9");
    expect(parseWrenchMessagingReceiptBindingV1({
      ...vectorCore,
      receiptSha256: "cd1570937c4c6523454a76b465fa761322f4b50049bf91eabf6cba5e92ca27e9",
    })).toMatchObject({ state: "submitted", provenPartCount: 2 });
    for (const [state, provenPartCount] of [
      ["submitted", 3],
      ["failed", 0],
      ["partial", 1],
      ["partial", 2],
      ["indeterminate", 0],
      ["indeterminate", 1],
      ["indeterminate", 2],
    ] as const) {
      expect(parseWrenchMessagingReceiptBindingV1(receipt({
        state,
        provenPartCount,
      }))).toMatchObject({ state, provenPartCount });
    }
    for (const invalid of [
      receipt({ state: "submitted", provenPartCount: 2 }),
      receipt({ state: "failed", provenPartCount: 1 }),
      receipt({ state: "partial", provenPartCount: 0 }),
      receipt({ state: "partial", provenPartCount: 3 }),
      receipt({ state: "indeterminate", provenPartCount: 3 }),
      receipt({ state: "succeeded", provenPartCount: 3 }),
    ]) expect(() => parseWrenchMessagingReceiptBindingV1(invalid)).toThrow();
    expect(() => parseWrenchMessagingReceiptBindingV1({
      ...receipt(),
      previewDigest: HASH_B,
    })).toThrow("receiptSha256 does not match");
    expect(() => parseWrenchMessagingReceiptBindingV1({
      ...receipt(),
      contractHash: HASH_B,
    })).toThrow("unsupported contract identity");
    expect(() => parseWrenchMessagingReceiptBindingV1({
      ...receipt(),
      routeRef: "raw-ref-is-not-part-of-this-contract",
    })).toThrow("must contain exactly");
    const currentReceipt = receipt();
    const { clientIntentSha256, ...receiptWithoutClientIntent } = currentReceipt;
    expect(() => parseWrenchMessagingReceiptBindingV1({
      ...receiptWithoutClientIntent,
      handoffSha256: clientIntentSha256,
    })).toThrow("must contain exactly");
  });
});
