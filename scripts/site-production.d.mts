import type { SiteProductionSubject } from "./release-production-authority.mjs";

export function qualifyExistingSiteProduction(input: Readonly<{
  api: unknown;
  subject: SiteProductionSubject;
  baselineReceipt: unknown;
  maxPolls?: number;
  pollIntervalMilliseconds?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}>): Promise<Readonly<{ deploymentId: number; statusId: number }>>;

export function assertConsumedSiteStatus(api: unknown, subject: SiteProductionSubject): Promise<void>;
export function assertSiteInvocation(environment: Readonly<Record<string, string | undefined>>): Readonly<{
  sourceSha: string; ciRunId: number; ciRunAttempt: number; buildRunId: number; buildRunAttempt: 1;
}>;
