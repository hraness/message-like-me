import type { ArticleAdmission, ArticleIsoDate, ArticleSourceRecord } from '@hraness/design-kit';

// Rewritten bodies have an independent AI review bound to their exact content hashes.
// Historical publication dates remain in blog-posts.ts; review dates describe checks.
const CHECKED_ON: ArticleIsoDate = '2026-10-01';
const SOURCE = '52bd21eb186dc2e20198acf47f5e1032bf5b7f5f';
const source = (title: string, path: string): ArticleSourceRecord => ({
  title,
  url: `https://github.com/hraness/textbutler/blob/${SOURCE}/${path}`,
  checkedOn: CHECKED_ON,
});
const shared = {
  lifecycle: 'indexable',
  owner: 'Hraness',
  drafting: 'ai-from-source',
  review: { reviewer: 'Codex GPT-6 independent editorial review', reviewerType: 'ai', reviewedOn: '2026-10-01' },
  humanReview: null,
  reassessOn: '2026-11-12',
  scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 2 },
} as const;

export const BLOG_ADMISSIONS: readonly ArticleAdmission[] = [
  {
    ...shared,
    href: '/blog/introducing-textbutler',
    readerJob: 'Understand how an assistant joins one selected conversation and choose when and where replies are written.',
    nonObviousAnswer: 'Keyword mode and visible AI markers are defaults with separate controls; enabling a conversation, choosing a reply model and sending a reviewed draft are distinct decisions.',
    originalContribution: 'Follows one message through the actual contact controls and explains how local reply generation differs from optional hosted search.',
    hostFit: 'An introduction to the messaging behavior of TextButler on its own site.',
    nearestUrls: [{ url: 'https://textbutler.app/', distinction: 'The homepage presents the product and setup; this article explains one conversation.' }],
    sources: [
      source('Contact defaults and disclosure settings', 'packages/textbutler/src/config.ts'),
      source('Keyword and Smart mode decisions', 'packages/textbutler/src/decision.ts'),
      source('Reply processing and uncertain sends', 'packages/textbutler/src/runtime.ts'),
      source('Reply choices, installation and contact activation', 'docs/textbutler/getting-started.md'),
      source('Contact memory and learning controls', 'docs/textbutler/architecture.md'),
      { title: 'Group enrollment and conversation binding', url: 'https://github.com/hraness/textbutler/blob/c8bad42664638fc27f51cc68920754f003fe7e4a/packages/textbutler/src/automation-owner.ts', checkedOn: CHECKED_ON },
      { title: 'Separate group guidance and editable workspace', url: 'https://github.com/hraness/textbutler/blob/c8bad42664638fc27f51cc68920754f003fe7e4a/packages/textbutler/src/workspace.ts', checkedOn: CHECKED_ON },
      { title: 'Group membership and account checks', url: 'https://github.com/hraness/ghostget/blob/db26d87ed29956016aedfd76b932e7c8b7037c3b/CHANGELOG.md', checkedOn: CHECKED_ON },
    ],
    observations: ['The retained message-flow diagram shows default keyword mode with the marker on; the text introduces that scope before the figure.', 'Hosted reply models receive context, and optional web search can still be hosted when a local model writes the reply.'],
    harmIfWrong: 'A reader might assume the keyword or AI marker is unconditional, or that choosing a local model makes optional search local.',
    refreshTriggers: ['Contact defaults, Smart mode or disclosure controls change', 'Reply provider precedence or search behavior changes', 'Messaging support or installation steps change'],
  },
  {
    ...shared,
    href: '/blog/how-textbutler-uses-ghostget',
    readerJob: 'Understand how TextButler connects to messaging apps without giving a reply model control of the account.',
    nonObviousAnswer: 'GhostGet reads and sends in the selected account; TextButler decides whether to answer and checks the recipient and contact settings before sending a model proposal.',
    originalContribution: 'Explains the current live messaging connection and separates account setup, optional history import, draft review and automatic replies.',
    hostFit: 'Explains the registered runtime:message-like-me:wrench:reads-and-sends-messages-through relationship.',
    nearestUrls: [{ url: 'https://textbutler.app/blog/introducing-textbutler', distinction: 'The introduction covers the whole assistant; this article follows the messaging connection.' }],
    sources: [
      source('Live messaging connection and supported app routes', 'docs/textbutler/messaging-apps.md'),
      source('Conversation selection, history import and activation', 'docs/textbutler/getting-started.md'),
      source('Ownership, contact data and send transactions', 'docs/textbutler/architecture.md'),
      source('Uncertain send handling', 'packages/textbutler/src/runtime.ts'),
    ],
    observations: ['The GhostGet connection is the current live transport; the legacy Message Like Me export importer is a separate historical path.', 'Selecting a conversation creates a disabled contact, and importing recent history does not enable replies.'],
    harmIfWrong: 'A reader could install the retired export tools expecting live replies, or mistake send acceptance for delivery.',
    refreshTriggers: ['GhostGet messaging connection changes', 'Beeper support or required app lifetime changes', 'Conversation selection, draft review or uncertain-send handling changes'],
  },
  {
    ...shared,
    href: '/blog/how-textbutler-uses-xcb',
    readerJob: 'Decide how an existing AI subscription can write replies while TextButler controls conversations and sending.',
    nonObviousAnswer: 'The application call supplies no coding workspace or provider tools; TextButler checks operation proposals for the selected contact, and failed calls do not choose another account or paid API.',
    originalContribution: 'Separates subscription generation, contact operations and message sending with a concrete reply example.',
    hostFit: 'Explains the registered runtime:message-like-me:xcb:drafts-replies-through relationship.',
    nearestUrls: [{ url: 'https://xcb.sh/', distinction: 'xcb describes subscription routing generally; this post covers the TextButler application connection.' }],
    sources: [
      source('Subscription setup and application interface', 'docs/textbutler/native-subscription.md'),
      source('Accepted completed and failed xcb results', 'packages/textbutler/src/xcb-client.ts'),
      source('Application controller: failed results become errors', 'packages/textbutler/src/xcb-host.ts'),
      source('Reply processing failure handling', 'packages/textbutler/src/runtime.ts'),
      source('Current reply options', 'docs/textbutler/getting-started.md'),
    ],
    observations: ['xcb-host.ts throws on failed results; the article does not promise automatic waiting or replay.', 'The selected account and model are passed to each call; native-subscription.md explicitly rules out account or API substitution.'],
    harmIfWrong: 'A reader could expect automatic retries or believe the subscription model can use coding tools to send messages.',
    refreshTriggers: ['xcb application interface changes', 'Account selection or fallback behavior changes', 'Contact operation or draft review controls change'],
  },
  {
    ...shared,
    href: '/blog/how-textbutler-uses-algal',
    readerJob: 'Understand what optional contact learning can change and how to judge the evidence for a proposed reply plan.',
    nonObviousAnswer: 'A candidate must pass a two-case blinded model comparison, while owner instructions and tool choices remain fixed; those scores do not measure future conversation quality.',
    originalContribution: 'Explains the promotion rule without internal budget inventory and preserves the small-sample, model-judge and tool-free replay limits.',
    hostFit: 'Explains the registered runtime:message-like-me:algal:runs-reply-habitats-on relationship.',
    nearestUrls: [{ url: 'https://textbutler.app/blog/introducing-textbutler', distinction: 'The introduction mentions learning; this post explains the comparison and owner controls.' }],
    sources: [
      source('Contact plan selection and promotion checks', 'packages/textbutler/src/contact-habitat.ts'),
      source('Reply programs and replay evaluation', 'packages/textbutler/src/habitat-agent.ts'),
      source('ALGAL runtime execution', 'packages/textbutler/src/habitat-program.ts'),
      source('Learning, contact memory and owner rollback', 'docs/textbutler/architecture.md'),
      source('Optional learning configuration', 'docs/textbutler/getting-started.md'),
    ],
    observations: ['contact-habitat.ts selects two past cases and requires non-regression on each plus a mean gain; owner and memory revisions must still match.', 'The article keeps model-judge uncertainty and tool-free replay scope beside the comparison.'],
    harmIfWrong: 'A reader could treat two model-scored cases as demonstrated improvement in real conversations or expect learning to change permissions.',
    refreshTriggers: ['Plan fields or owner-controlled fields change', 'Replay sample, judge or promotion rule changes', 'Learning defaults or rollback behavior changes'],
  },
];

export function blogAdmission(href: string): ArticleAdmission | undefined {
  return BLOG_ADMISSIONS.find((entry) => entry.href === href);
}
