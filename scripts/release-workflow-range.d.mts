export type WorkflowRangeGitResult = Readonly<{
  exitCode: number;
  stderr: Uint8Array;
  stdout: Uint8Array;
}>;

export type WorkflowRangeGitRunner = (
  arguments_: readonly string[],
) => WorkflowRangeGitResult;

export type WorkflowRangeReceipt = Readonly<{
  newCommitCount: number;
  newCommitDigest: string;
  previousSha: string;
  productionRef: "refs/heads/website-production";
  schema: "message-like-me-workflow-range-v1";
  verifiedSha: string;
  workflowTreeOid: string;
}>;

export const MAXIMUM_WORKFLOW_RANGE_COMMITS: 250;

export function verifyWorkflowRange(input: Readonly<{
  previousSha: string;
  runner?: WorkflowRangeGitRunner;
  verifiedSha: string;
  workingDirectory?: string;
}>): WorkflowRangeReceipt;

export function assertWorkflowRangeReceipt(
  value: unknown,
  expected: Readonly<{ previousSha: string; verifiedSha: string }>,
): WorkflowRangeReceipt;

export function encodeWorkflowRangeReceipt(value: unknown): string;
export function decodeWorkflowRangeReceipt(value: unknown): WorkflowRangeReceipt;
