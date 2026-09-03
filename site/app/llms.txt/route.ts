import {
  absoluteUrl,
  GITHUB_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
} from '../_lib/site';

export function GET() {
  const body = [
    `# ${SITE_NAME}`,
    '',
    SITE_DESCRIPTION,
    '',
    'The website is informational. It never receives private message history, contacts, profiles, or drafts.',
    'Supported sources are Apple Messages; X data archive DMs, not X Chat; Beeper via Wrench v0.16.4 adapter beeper-local v2.3.0 and its internal bounded v1 export; native WhatsApp via Wrench and official Wacli through a one-account v2 bundle; and macOS Contacts for optional label enrichment. Wrench reviews 32 Beeper operations: 27 use its pinned CLI 0.6.2 executable and 5 use fixed Desktop reads. The tagged packages/cli/package.json value 0.6.1 is provenance only, not runtime authority. Message Like Me owns zero Beeper operations, provider credentials, or live sessions; it does not claim complete history, invoke Wrench or provider operations, access a network, or send messages.',
    'The Wrench v0.16.4 and Wacli v0.15.0 WhatsApp producer omits reaction-shaped rows with reaction-state-unproven because current active or removed state cannot be proved. An empty reaction artifact is unobservable reaction behavior, not evidence that no reactions occurred.',
    '',
    '## Canonical pages',
    `- ${absoluteUrl('/')}`,
    `- ${absoluteUrl('/sources')}`,
    `- ${absoluteUrl('/docs')}`,
    `- ${absoluteUrl('/methodology')}`,
    `- ${absoluteUrl('/research')}`,
    `- ${absoluteUrl('/about')}`,
    '',
    '## Source',
    `- ${GITHUB_URL}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
