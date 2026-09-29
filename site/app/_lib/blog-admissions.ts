import type { ArticleAdmission, ArticleIsoDate, ArticleSourceRecord } from '@hraness/design-kit';

// Editorial review records for every post under /blog, validated by
// assertArticleAdmissions() in scripts/blog.test.tsx. A quarantined post is
// readable but noindex and stays out of the sitemap, feed, llms.txt, and the
// blog index. The review is a disclosed AI review; humanReview stays null.

const REVIEWED_ON: ArticleIsoDate = '2026-09-24';
const REASSESS_ON: ArticleIsoDate = '2026-11-05';
const REVIEW = {
  reviewer: 'Claude Opus 5.5 (claude-opus-5-5) editorial review',
  reviewerType: 'ai',
  reviewedOn: REVIEWED_ON,
} as const;
// The launch rewrite was reviewed on its own date by claims and clarity
// reviewer runs separate from the drafting run (launch workflow, 2026-09-28).
const LAUNCH_REVIEWED_ON: ArticleIsoDate = '2026-09-28';
const LAUNCH_REASSESS_ON: ArticleIsoDate = '2026-11-09';
const LAUNCH_REVIEW = {
  reviewer: 'Claude Opus 5.5 (claude-opus-5-5) independent claims and clarity review',
  reviewerType: 'ai',
  reviewedOn: LAUNCH_REVIEWED_ON,
} as const;

type Repository = 'textbutler' | 'ghostget' | 'algal' | 'xcb' | 'design-kit';

function source(title: string, repository: Repository, path: string, checkedOn: ArticleIsoDate = REVIEWED_ON): ArticleSourceRecord {
  const kind = path.endsWith('/') ? 'tree' : 'blob';
  return {
    title,
    url: `https://github.com/hraness/${repository}/${kind}/main/${path.replace(/\/$/u, '')}`,
    checkedOn,
  };
}
const launchSource = (title: string, repository: Repository, path: string) => source(title, repository, path, LAUNCH_REVIEWED_ON);

export const BLOG_ADMISSIONS = [
  {
    href: '/blog/introducing-textbutler',
    lifecycle: 'indexable',
    readerJob: 'Understand what Textbutler does in my chats, what writes its replies and what leaves my Mac, how much setup my coding agent can do for me, and what works today.',
    nonObviousAnswer: 'It answers only when someone says “butler” (whole word, any capitalization) in a one-to-one chat you turned on, sends 🤖{ 👀 } first as a plain text message because tapbacks are unavailable on a stock Mac, skips rather than queues a request that arrives within 5 minutes of your own message, and searches chat history only in the owner’s own chat unless the owner enables it for another person; with a local Ollama model the reply is written on the Mac, but a saved Gateway key still wins unless you choose local explicitly, and web search needs a saved Gateway key and is on for turned-on people once one is saved.',
    originalContribution: 'Explains the trigger, checks, acknowledgment, reply-writer precedence and privacy map, and the split between what an agent can set up and what macOS makes a person do, from the source code.',
    hostFit: 'The product launch post on the product host. It links the xcb and ALGAL integration posts and the Ghostget and xcb hubs along registered relations.',
    nearestUrls: [
      { url: 'https://textbutler.app/', distinction: 'The home page shows the product at a glance; this post walks through one conversation, the reasoning behind each default, and what is live versus coming.' },
      { url: 'https://textbutler.app/docs', distinction: 'The docs page is the README reference; this post is the short narrative a new reader starts with.' },
    ],
    sources: [
      launchSource('Contact defaults: keyword, cooldown, debounce, hourly cap, disclosure marker', 'textbutler', 'packages/textbutler/src/config.ts'),
      launchSource('Reply decision: keyword match, owner invocation, smart-mode confidence', 'textbutler', 'packages/textbutler/src/decision.ts'),
      launchSource('Acknowledgment and send path', 'textbutler', 'packages/textbutler/src/runtime.ts'),
      launchSource('Reply writer precedence, local model pin, Gateway daily budget', 'textbutler', 'packages/textbutler/src/default-reply-model.ts'),
      launchSource('Textbutler status sentence (SITE_STATUS)', 'textbutler', 'site/app/_lib/site.ts'),
      launchSource('xcb client: tool-free generation contract', 'textbutler', 'packages/textbutler/src/xcb-client.ts'),
      launchSource('Getting started', 'textbutler', 'docs/textbutler/getting-started.md'),
      launchSource('Messaging apps and live limitations', 'textbutler', 'docs/textbutler/messaging-apps.md'),
      launchSource('Agent JSON CLI', 'textbutler', 'docs/textbutler/agent-cli.md'),
      launchSource('messagelikeme.com permanent redirects', 'textbutler', 'site/next.config.ts'),
    ],
    observations: [
      'The acknowledgment is the marked text 🤖{ 👀 }, not a tapback, and a request inside the 5-minute owner cooldown is skipped rather than deferred.',
      'Local Ollama auto-detection applies only when no Gateway key is saved; the post keeps the local route tagged as in testing until it becomes the default on main.',
      'History search is on in the owner’s own chat and off for other contacts unless the plan enables it; the examples answer only from messages visible in the same chat.',
      'Learning (habitat evolution) and its 64-entry memory run only when an evolution model is configured, which no default sets; the post presents it as optional and off by default.',
    ],
    scores: { readerUtility: 2, originalEvidence: 2, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    owner: 'Hraness',
    drafting: 'ai-from-source',
    review: LAUNCH_REVIEW,
    humanReview: null,
    reassessOn: LAUNCH_REASSESS_ON,
    harmIfWrong: 'A reader could expect the local model to be used even with a Gateway key saved, expect a skipped request to be answered later, or trust a marker they have removed for a person.',
    refreshTriggers: [
      'Change to SITE_STATUS or the reply-writer precedence (the local model becoming the default)',
      'A Textbutler setup Agent Skill or one-line installer ships',
      'Change to keyword, cooldown, debounce, hourly cap, smart-mode threshold or disclosure marker (config.ts, decision.ts)',
      'Change to the acknowledgment, draft expiry or digest send (runtime.ts, owner-replies.ts)',
      'Change to the pinned local model or the Gateway daily budget (default-reply-model.ts)',
      'WhatsApp or Beeper automatic replies gain live testing comparable to iMessage',
      'Registration or change of the Textbutler relations to xcb, ALGAL, Ghostget or PeopleBlade',
      'Bun version pin changes in package.json',
    ],
  },
  {
    // runtime:message-like-me:xcb:drafts-replies-through is registered in the
    // portfolio facts since @hraness/design-kit v0.18.2.
    href: '/blog/how-textbutler-uses-xcb',
    lifecycle: 'indexable',
    readerJob: 'Decide whether to use an existing Claude Code, Codex, or Devin subscription as Textbutler\'s reply writer through xcb, and know what each side holds before setting it up.',
    nonObviousAnswer: 'xcb holds the login and runs a tool-free model; Textbutler pins the xcb executable by SHA-256, sends prompts on stdin, rejects replies whose account, model or JSON keys do not match, and carries out every contact action itself. A failed subscription call waits and never falls through to the billed Claude API.',
    originalContribution: 'Traces the xcb call path from Textbutler source: hash pin, stdin prompt, duplicate-key rejection, step limits, and the separate API route.',
    hostFit: 'A "How Textbutler uses xcb" post on the consumer host. The registered runtime:message-like-me:xcb:drafts-replies-through relation carries the detail sentence this post explains.',
    nearestUrls: [
      { url: 'https://xcb.sh/blog/introducing-xcb', distinction: 'The xcb introduction covers xcb itself; this post covers only how Textbutler calls it.' },
      { url: 'https://textbutler.app/blog/introducing-textbutler', distinction: 'The introduction mentions xcb in one paragraph and links here for the details.' },
    ],
    sources: [
      source('Textbutler xcb client: capability and result parsing, executable hash check, prompt on stdin', 'textbutler', 'packages/textbutler/src/xcb-client.ts'),
      source('Textbutler build record for the xcb route: classify and respond profiles, source hashes', 'textbutler', 'qualification/xcb-textbutler-v1.json'),
      source('Textbutler architecture: xcb application contract, subscription and API routes', 'textbutler', 'docs/textbutler/architecture.md'),
      source('AI subscriptions through xcb: setup, step limits, recovery', 'textbutler', 'docs/textbutler/native-subscription.md'),
      source('Agent account setup and the unavailable Claude API route', 'textbutler', 'packages/textbutler/PROVIDERS.md'),
      source('Accepted xcb account providers (claude, codex, devin)', 'textbutler', 'packages/textbutler/src/host-config.ts'),
      source('Pinned AgentMixer compatibility library', 'textbutler', 'package.json'),
      source('Textbutler status sentence', 'textbutler', 'site/app/_lib/site.ts'),
      source('xcb application API: tool-free generation for applications', 'xcb', 'docs/application-api.md'),
    ],
    observations: [
      'Textbutler host config accepts claude, codex and devin xcb accounts; the subscription is one of three reply writers alongside a local Ollama model and a Vercel AI Gateway key.',
      'The disclosure marker is on by default but clearable: config.ts returns no marker once the owner clears all three symbols.',
    ],
    scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    owner: 'Hraness',
    drafting: 'ai-from-source',
    review: LAUNCH_REVIEW,
    humanReview: null,
    reassessOn: LAUNCH_REASSESS_ON,
    harmIfWrong: 'A reader could assume a failed subscription call falls back to paid API use, or that xcb gives the model file or messaging tools.',
    refreshTriggers: [
      'Change to XCB_LIMITS, stdin input, duplicate-key parsing or verifyXcbExecutable in packages/textbutler/src/xcb-client.ts',
      'Change to accepted xcb providers in packages/textbutler/src/host-config.ts (for example Devin accepted)',
      'xcb README readiness change for Devin, or xcb application API change',
      'Change to step or operation limits, setup flags or recovery in docs/textbutler/native-subscription.md',
      'Change to API route defaults, maximum or price expiry in packages/textbutler/PROVIDERS.md',
      'New or changed drafting profiles in qualification/xcb-textbutler-v1.json',
      'Disclosure marker default change in config.ts, or replies show/send CLI change',
      'SITE_STATUS change in site/app/_lib/site.ts',
      'AgentMixer pin change in package.json',
      'Relation runtime:message-like-me:xcb:drafts-replies-through registered, renamed or removed',
    ],
  },
  {
    // runtime:message-like-me:algal:runs-reply-habitats-on is registered in the
    // portfolio facts since @hraness/design-kit v0.18.2.
    href: '/blog/how-textbutler-uses-algal',
    lifecycle: 'indexable',
    readerJob: 'Understand Textbutler\'s per-contact habitats, decide whether to turn on their learning step, and know what the learning can change, what it cannot, and how to undo it.',
    nonObviousAnswer: 'The plan schema has no field for recipient, provider, permissions or disclosure, so no learned plan can express a change to them; a candidate plan wins only if a blinded judge marks it safe on both replayed cases, scores it no lower on either, and finds an average gain of at least 0.1, and replays run no tools, so tool choice is never measured.',
    originalContribution: 'Lays out the habitat plan schema, run limits, and promotion rule from Textbutler source, and states what the replay does not measure.',
    hostFit: 'A "How Textbutler uses ALGAL" post on the consumer host. The registered runtime:message-like-me:algal:runs-reply-habitats-on relation carries the detail sentence this post explains.',
    nearestUrls: [
      { url: 'https://algal.computer/blog/built-on-algal/', distinction: 'The ALGAL hub lists every product built on it; this post explains Textbutler\'s use only.' },
      { url: 'https://textbutler.app/blog/introducing-textbutler', distinction: 'The introduction describes habitats as the product direction and links here for how they run.' },
    ],
    sources: [
      source('Habitat programs: respond, reflect and judge phases run as ALGAL organisms with fixed budgets', 'textbutler', 'packages/textbutler/src/habitat-program.ts'),
      source('Contact habitats: default reply route, opt-in evolution via host.json, per-conversation isolation, promotion rule, owner controls', 'textbutler', 'docs/textbutler/architecture.md'),
      source('Habitat plan schema, default plan and promotion checks', 'textbutler', 'packages/textbutler/src/contact-habitat.ts'),
      source('Habitat host configuration (habitat.enabled)', 'textbutler', 'packages/textbutler/src/host-config.ts'),
      source('Default habitat config: enabled with evolutionModel null', 'textbutler', 'packages/textbutler/src/default-reply-model.ts', '2026-09-28'),
      source('Tool-free, non-replayable evolution call', 'textbutler', 'packages/textbutler/src/habitat-evolution.ts'),
      source('Live reply runs, blinded replay, judge and run records', 'textbutler', 'packages/textbutler/src/habitat-agent.ts'),
      source('habitats CLI and the pause requirement', 'textbutler', 'packages/textbutler/src/owner-cli.ts'),
      source('ALGAL dependency pinned by commit', 'textbutler', 'package.json'),
      source('Textbutler status label', 'textbutler', 'site/app/_lib/site.ts'),
      source('ALGAL README: organisms, budgets, host-decided selection, the open question', 'algal', 'README.md'),
    ],
    observations: [
      'Replay order is set per case from a hash rather than shuffled, and only the two most recent episodes with follow-ups are replayed.',
      'Only the latest 32 habitat runs per contact are kept in full, so tracing a plan change back to its runs works for recent promotions only.',
    ],
    scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 1, voiceIntegrity: 2, maintenanceValue: 1 },
    owner: 'Hraness',
    drafting: 'ai-from-source',
    review: LAUNCH_REVIEW,
    humanReview: null,
    reassessOn: LAUNCH_REASSESS_ON,
    harmIfWrong: 'A reader could believe learned plans can change who receives messages or which tools run, or that the replay proves replies got better.',
    refreshTriggers: [
      '@hraness/algal pin change in package.json or ALGAL README change to how organisms, budgets or the open question are described',
      'Budget, step or model-call limit change for respond, reflect or judge in packages/textbutler/src/habitat-program.ts',
      'Plan schema change in packages/textbutler/src/contact-habitat.ts',
      'Promotion rule change: replay case count, safety check, per-case or average margin, citation, rollback or ancestor handling',
      'Journal retention change from 32 full run records per contact',
      'habitats CLI rename or argument change in packages/textbutler/src/owner-cli.ts, or change to the pause requirement',
      'Default reply route or learning route change',
      'Relation runtime:message-like-me:algal:runs-reply-habitats-on registered, changed or removed',
      'SITE_STATUS_LABEL change in site/app/_lib/site.ts',
    ],
  },
  {
    // Quarantined: the registered relation detail names Beeper bundles only,
    // while the post also covers the WhatsApp v2 bundle. Widen the relation's
    // detail sentence to mention WhatsApp, or cut the WhatsApp sections, before
    // indexing.
    href: '/blog/how-textbutler-uses-ghostget',
    lifecycle: 'quarantined',
    readerJob: 'Get my Beeper and WhatsApp history into Textbutler without giving Textbutler my messaging logins, and know what the import checks and keeps.',
    nonObviousAnswer: 'Textbutler owns the bundle format and Ghostget checks every record with Textbutler\'s own code at a pinned commit, so the import is a folder handoff: Textbutler verifies all hashes before one database transaction, keeps messages a later export omits, and makes you name the overlapping Beeper source before it imports a native WhatsApp export.',
    originalContribution: 'Shows the folder handoff from both repositories: the shared checking module, the golden sample folder both test suites use, and the re-import rules.',
    hostFit: 'A "How Textbutler uses Ghostget" post for a registered relation whose detail sentence covers Beeper bundles only; the WhatsApp sections go beyond it until the relation is widened.',
    nearestUrls: [
      { url: 'https://ghostget.com/blog/built-on-ghostget', distinction: 'The Ghostget hub lists every product built on it; this post covers the Textbutler import only.' },
      { url: 'https://textbutler.app/sources', distinction: 'The sources page catalogs supported history sources; this post explains how the Ghostget handoff works.' },
    ],
    sources: [
      source('Ghostget Beeper bundle parser built on Textbutler\'s contract module', 'ghostget', 'src/beeper-message-bundle-v1.ts'),
      source('Ghostget WhatsApp bundle parser built on Textbutler\'s v2 contract module', 'ghostget', 'src/whatsapp-message-bundle-v2.ts'),
      source('Ghostget pins @hraness/message-like-me to a fixed Textbutler commit', 'ghostget', 'package.json'),
      source('Golden bundle generator', 'ghostget', 'scripts/generate-beeper-message-like-me-golden.ts'),
      source('Ghostget test: regenerate the golden bundle byte for byte', 'ghostget', 'src/beeper-message-like-me-export.test.ts'),
      source('Textbutler test: import the exact bundle Ghostget emits', 'textbutler', 'src/bundle.test.ts'),
      source('Golden bundle files (identical blobs in both repositories)', 'textbutler', 'src/fixtures/beeper-message-like-me-v1/'),
      source('Bundle format v1 (Beeper)', 'textbutler', 'docs/local-message-bundle-v1.md'),
      source('Bundle format v2 (WhatsApp)', 'textbutler', 'docs/local-message-bundle-v2.md'),
      source('Bundle import checks and what they do not prove', 'textbutler', 'SECURITY.md'),
      source('Export commands and coverage warnings', 'ghostget', 'README.md'),
      source('Textbutler status sentence', 'textbutler', 'site/app/_lib/site.ts'),
    ],
    observations: [
      'All seven golden fixture files have identical Git blob IDs in the Textbutler and Ghostget repositories, kept in step by hand rather than by a shared check.',
      'The Ghostget pin of @hraness/message-like-me is a commit that is not an ancestor of Textbutler main, so the two can drift until the pin is updated.',
    ],
    scores: { readerUtility: 2, originalEvidence: 2, factualConfidence: 2, hostFit: 1, voiceIntegrity: 2, maintenanceValue: 1 },
    owner: 'Hraness',
    drafting: 'ai-from-source',
    review: REVIEW,
    humanReview: null,
    reassessOn: REASSESS_ON,
    harmIfWrong: 'A reader could treat an export as complete history, or store a bundle that holds names, numbers and message text somewhere shared.',
    refreshTriggers: [
      'Change to the detail sentence of contract:wrench:message-like-me:exports-private-bundles, or registration of a WhatsApp relation',
      'Ghostget updates its @hraness/message-like-me pin (package.json)',
      'Change to docs/local-message-bundle-v1.md or v2.md, or a new bundle version',
      'Rename of the messagelikeme command or the ghostget export-message-like-me commands',
      'Change to Textbutler\'s re-import, overlap or rejection rules (src/command-program.ts, src/store.ts, SECURITY.md)',
      'Textbutler status label change or a Textbutler release tag',
      'Ghostget or Textbutler product rename',
    ],
  },
] as const satisfies readonly ArticleAdmission[];

export function blogAdmission(href: string): ArticleAdmission | undefined {
  return (BLOG_ADMISSIONS as readonly ArticleAdmission[]).find((admission) => admission.href === href);
}
