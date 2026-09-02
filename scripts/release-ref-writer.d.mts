import type { SpawnSyncReturns, SpawnSyncOptionsWithStringEncoding } from "node:child_process";

export interface RefWriterEnvironment {
  readonly [key: string]: string | undefined;
}

export function websiteProductionPushArguments(
  expectedOldSha: string,
  verifiedSha: string,
): readonly string[];

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
}>): void;

export function advanceWebsiteProductionRefFromEnvironment(input: Readonly<{
  environment: RefWriterEnvironment;
  expectedOldSha: string;
  repository: string;
  verifiedSha: string;
  verifiedTag: string;
}>): void;
