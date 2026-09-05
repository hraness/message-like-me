import type { SpawnSyncReturns, SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export interface RefWriterEnvironment {
  readonly [key: string]: string | undefined;
}

export interface RefWriterPushReceipt {
  readonly classification: "fast-forward";
  readonly fromSha: string;
  readonly protectedRef: "refs/heads/website-production" | "refs/heads/website-production-writer-canary";
  readonly summarySha256: string;
  readonly toSha: string;
}

export function websiteProductionPushArguments(
  expectedOldSha: string,
  verifiedSha: string,
): readonly string[];

export function websiteProductionCanaryPushArguments(
  expectedOldSha: string,
  targetSha: string,
): readonly string[];

export function websiteProductionCanaryStaleLeasePushArguments(
  staleExpectedSha: string,
): readonly string[];

export function parseWebsiteProductionCanaryRequiredStatusDenial(error: unknown): Readonly<{
  classification: "required-status-missing";
  diagnosticSha256: string;
}>;

export function parseWebsiteProductionRequiredStatusDenial(error: unknown): Readonly<{
  classification: "required-status-missing";
  diagnosticSha256: string;
}>;

export function verifiedReleaseFetchArguments(
  verifiedTag: string,
): readonly string[];

export function advanceWebsiteProductionRef(options: Readonly<{
  environment: RefWriterEnvironment;
  expectedOldSha: string;
  repository: string;
  spawnImplementation(
    command: string,
    arguments_: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string>;
  verifiedSha: string;
  verifiedTag: string;
}>): Readonly<RefWriterPushReceipt>;

export function advanceWebsiteProductionCanaryRef(options: Readonly<{
  environment: RefWriterEnvironment;
  expectedOldSha: string;
  repository: string;
  spawnImplementation(
    command: string,
    arguments_: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string>;
  targetSha: string;
  workflowSha: string;
}>): Readonly<RefWriterPushReceipt>;

export function proveWebsiteProductionCanaryStaleLease(options: Readonly<{
  currentSha: string;
  environment: RefWriterEnvironment;
  repository: string;
  spawnImplementation(
    command: string,
    arguments_: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string>;
  staleExpectedSha: string;
}>): Readonly<{
  classification: "stale-info";
  diagnosticSha256: string;
}>;

export function advanceWebsiteProductionRefFromEnvironment(input: Readonly<{
  environment: RefWriterEnvironment;
  expectedOldSha: string;
  repository: string;
  verifiedSha: string;
  verifiedTag: string;
}>): Readonly<RefWriterPushReceipt>;

export function proveWebsiteProductionRequiredStatusDenialFromEnvironment(input: Readonly<{
  environment: RefWriterEnvironment;
  expectedOldSha: string;
  repository: string;
  verifiedSha: string;
  verifiedTag: string;
}>): Readonly<{
  classification: "required-status-missing";
  diagnosticSha256: string;
}>;

export function advanceWebsiteProductionCanaryRefFromEnvironment(input: Readonly<{
  environment: RefWriterEnvironment;
  expectedOldSha: string;
  repository: string;
  targetSha: string;
  workflowSha: string;
}>): Readonly<RefWriterPushReceipt>;

export function proveWebsiteProductionCanaryStaleLeaseFromEnvironment(input: Readonly<{
  currentSha: string;
  environment: RefWriterEnvironment;
  repository: string;
  staleExpectedSha: string;
}>): Readonly<{
  classification: "stale-info";
  diagnosticSha256: string;
}>;
