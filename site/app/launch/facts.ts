import type { LaunchFacts, LaunchStatus } from '@hraness/design-kit/launch';

import { SITE_STATUS_LABEL } from '../_lib/site';

/**
 * Every number and status the launch post, its social kit, and the launch
 * film captions use, typed once with the record it comes from.
 * scripts/launch.test.ts reads those records and fails when a value here
 * drifts from them.
 */
export const LAUNCH_STATUS = SITE_STATUS_LABEL satisfies LaunchStatus;

export const launchFacts = {
  status: {
    value: LAUNCH_STATUS,
    source: 'site/app/_lib/site.ts SITE_STATUS_LABEL, the one development-status label README.md repeats',
  },
  cooldown: {
    value: '5 minutes',
    source: 'packages/textbutler/src/config.ts default contact humanCooldownMs: 300_000',
  },
  debounce: {
    value: '8 seconds',
    source: 'packages/textbutler/src/config.ts default contact debounceMs: 8_000',
  },
  hourlyCap: {
    value: '12',
    source: 'packages/textbutler/src/config.ts default contact maxRepliesPerHour: 12',
  },
  smartConfidence: {
    value: '85%',
    source: 'packages/textbutler/src/decision.ts smart mode replies only at confidence >= 0.85',
  },
  draftExpiry: {
    value: '15 minutes',
    source: 'packages/textbutler/src/owner-replies.ts DRAFT_TTL_MS = 15 * 60_000',
  },
  gatewayBudget: {
    value: '$1',
    source: 'packages/textbutler/src/default-reply-model.ts gateway driver dailyBudgetUsd: 1',
  },
  localModelSize: {
    value: '2.5 GB',
    source: 'README.md reply-writer table and docs/textbutler/getting-started.md: the pinned qwen3:4b-instruct-2507-q4_K_M model is about 2.5 GB',
  },
  replyWriters: {
    value: 'three',
    source: 'site/app/_lib/site.ts REPLY_WRITERS_SENTENCE: a local model, your own Vercel AI Gateway key, or your subscription through xcb',
  },
} as const satisfies LaunchFacts;

export type LaunchFactKey = keyof typeof launchFacts;
