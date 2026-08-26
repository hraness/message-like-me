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
    '',
    '## Canonical pages',
    `- ${absoluteUrl('/')}`,
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
