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
    'Supported sources are Apple Messages; X data archive DMs, not X Chat; Beeper via Wrench through a bounded v1 bundle; native WhatsApp via Wrench and official Wacli through a one-account v2 bundle; and macOS Contacts for optional label enrichment. Message Like Me never receives provider credentials or Wacli session state, invokes Wrench or provider operations, accesses a network, or sends messages.',
    'The verified Wrench v0.16.3 and Wacli v0.15.0 WhatsApp producer omits reaction-shaped rows with reaction-state-unproven because current active or removed state cannot be proved. An empty reaction artifact is unobservable reaction behavior, not evidence that no reactions occurred. The separately verified Beeper producer remains Wrench v0.16.1 with Beeper CLI v0.6.2.',
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
