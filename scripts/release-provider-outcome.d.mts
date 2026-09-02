export interface ReleaseProviderApi {
  advanceRef?(
    repository: string,
    expectedOldSha: string,
    verifiedSha: string,
    verifiedTag: string,
  ): Promise<void>;
  get?(endpoint: string): Promise<unknown>;
  getWithServerDate?(endpoint: string): Promise<unknown>;
  graphql?(input: Readonly<{
    after?: string;
    name: string;
    owner: string;
    query: string;
  }>): Promise<unknown>;
}

export interface ProductionDeployment {
  readonly createdAt: string;
  readonly createdMilliseconds: number;
  readonly id: number;
  readonly sha: string;
}

export interface DeploymentStatus {
  readonly createdAt: string;
  readonly createdMilliseconds: number;
  readonly id: number;
  readonly nodeId: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly updatedMilliseconds: number;
}

export const releaseRestRequestBudget: Readonly<{
  githubTokenLimit: number;
  headroom: number;
  maxPolls: number;
  pollIntervalMilliseconds: number;
  providerBaseline: number;
  providerOutcome: number;
  providerPromotion: number;
  surroundingRelease: number;
  total: number;
}>;

export const releaseGraphqlRequestBudget: Readonly<{
  githubPointLimit: number;
  headroom: number;
  maxCostPerRequest: number;
  maxPoints: number;
  providerBaseline: number;
  providerOutcome: number;
  totalRequests: number;
}>;

export function parseIncludedGitHubResponse(text: string, label?: string): Readonly<{
  body: unknown;
  serverDate: string;
}>;

export function parseOptionalIncludedGitHubResponse(
  text: string,
  label?: string,
): Readonly<{ found: boolean; value: unknown }>;

export function encodeProviderReceipt(value: unknown): string;
export function decodeProviderReceipt(value: unknown, label?: string): unknown;

export function collectProductionDeployments(
  api: ReleaseProviderApi,
  repository: string,
): Promise<readonly ProductionDeployment[]>;

export function collectDeploymentStatuses(
  api: ReleaseProviderApi,
  repository: string,
  deploymentId: number,
): Promise<readonly DeploymentStatus[]>;

export function assertReleaseTagNewerThanPublished(input: Readonly<{
  api: ReleaseProviderApi;
  repository: string;
  verifiedTag: string;
}>): Promise<void>;

export function exactPublishedRelease(
  value: unknown,
  tag: string,
  label?: string,
): unknown;

export function revalidateReleaseAuthority(input: Readonly<{
  api: ReleaseProviderApi;
  defaultBranch: string;
  eventName: string;
  recoveryWorkflowSha: string;
  repository: string;
  verifiedSha: string;
  verifiedTag: string;
}>): Promise<void>;

export function createProviderBaseline(input: Readonly<{
  api: ReleaseProviderApi;
  repository: string;
  verifiedSha: string;
}>): Promise<unknown>;

export function promoteWebsiteProduction(input: Readonly<{
  api: ReleaseProviderApi;
  baselineReceipt: unknown;
  defaultBranch: string;
  eventName: string;
  recoveryWorkflowSha: string;
  repository: string;
  verifiedSha: string;
  verifiedTag: string;
}>): Promise<unknown>;

export function waitForProviderOutcome(input: Readonly<{
  api: ReleaseProviderApi;
  baselineReceipt: unknown;
  defaultBranch: string;
  eventName: string;
  maxPolls?: number;
  pollIntervalMilliseconds?: number;
  promotionReceipt: unknown;
  recoveryWorkflowSha: string;
  repository?: string;
  sleep?: (milliseconds: number) => Promise<void>;
  verifiedSha?: string;
  verifiedTag?: string;
}>): Promise<Readonly<{ deploymentId: number; statusId: number }>>;
