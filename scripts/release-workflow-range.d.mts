export type WorkflowRangeGitResult = Readonly<{
  exitCode: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
}>;

export type WorkflowRangeGitRunner = (
  arguments_: readonly string[],
) => WorkflowRangeGitResult;

type WorkflowRangeReceiptFields = Readonly<{
  newCommitCount: number;
  newCommitDigest: string;
  previousSha: string;
  verifiedSha: string;
  workflowTreeOid: string;
}>;

export type ProductionWorkflowRangeReceipt = WorkflowRangeReceiptFields & Readonly<{
  productionRef: "refs/heads/website-production";
  schema: "message-like-me-workflow-range-v1";
}>;

export type CanaryWorkflowRangeReceipt = WorkflowRangeReceiptFields & Readonly<{
  productionRef: "refs/heads/website-production-writer-canary";
  schema: "message-like-me-canary-workflow-range-v1";
}>;

export type WorkflowRangeReceipt =
  | ProductionWorkflowRangeReceipt
  | CanaryWorkflowRangeReceipt;

export const MAXIMUM_WORKFLOW_RANGE_COMMITS: 250;

export function verifyWorkflowRange(input: Readonly<{
  previousSha: string;
  runner?: WorkflowRangeGitRunner;
  verifiedSha: string;
  workingDirectory?: string;
}>): ProductionWorkflowRangeReceipt;

export function verifyCanaryWorkflowRange(input: Readonly<{
  previousSha: string;
  runner?: WorkflowRangeGitRunner;
  verifiedSha: string;
  workingDirectory?: string;
}>): CanaryWorkflowRangeReceipt;

export function assertWorkflowRangeReceipt(
  value: unknown,
  expected: Readonly<{
    previousSha: string;
    verifiedSha: string;
  }>,
): ProductionWorkflowRangeReceipt;

export function assertCanaryWorkflowRangeReceipt(
  value: unknown,
  expected: Readonly<{ previousSha: string; verifiedSha: string }>,
): CanaryWorkflowRangeReceipt;

export function encodeWorkflowRangeReceipt(value: unknown): string;
export function decodeWorkflowRangeReceipt(value: unknown): WorkflowRangeReceipt;
