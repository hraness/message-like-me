import {
  absoluteUrl,
  ARCHITECTURE_URL,
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
    '## Current Textbutler development status',
    'Textbutler is a macOS app and daemon foundation for a personal message butler. The source includes contact workspaces, editable memory, scoped control requests, smart and keyword-only response policy, global pause, and a configurable active contact limit (default five). Codex and Claude are the intended coding-agent providers.',
    'Every butler text reply is designed to be visibly identified. Default disclosure: 🤖{ hello this is my response }. The character, begin symbol, and end symbol are configurable per contact. The default keyword is butler.',
    'Live automatic replies remain disabled pending Ghostget transport and provider sandbox qualification. There is no signed Textbutler Mac download yet. Files and reactions are transport design seams; stickers, Linq, and iMessage mini apps are not claimed as supported. The website has no upload or contact form.',
    'The intended agent permission boundary is one contact workspace, public web requests, and explicitly available conversation actions. General shell commands, other contact folders, provider credentials, and permission changes are excluded. Hosted agents process the context they receive under their own data policies.',
    `Architecture: ${ARCHITECTURE_URL}`,
    '',
    '## Legacy Message Like Me history tools',
    'The following catalog describes the published Message Like Me history reader and its checked historical producer versions. It is not a Textbutler live transport support matrix. Installing the legacy package does not install Textbutler or enable automatic replies.',
    'Beeper via Ghostget lets users bring a finished private bundle into the same local evidence corpus as other sources. Ghostget v0.17.1 adapter beeper-local v2.4.0 owns 32 reviewed Beeper operations: 26 run through one pinned Beeper CLI 0.6.2 executable, including supported actions and writes, plus six fixed Desktop loopback reads. The executable’s reported 0.6.2 is runtime authority; the upstream tagged packages/cli/package.json declaration of 0.6.1 is provenance only. Message Like Me receives no provider credentials, never calls Ghostget or Beeper operations, and never sends; it does not claim complete history.',
    'Supported sources are Apple Messages; X data archive DMs, not X Chat; the finished Beeper bundle from Ghostget’s internal bounded v1 export; native WhatsApp via Ghostget and official Wacli through a one-account v2 bundle; and macOS Contacts for optional label enrichment. Every ingest path is read-only with respect to its source. Message Like Me does not invoke provider operations or access a network.',
    'The Ghostget v0.17.1 and Wacli v0.15.0 WhatsApp producer omits reaction-shaped rows with reaction-state-unproven because current active or removed state cannot be proved. An empty reaction artifact is unobservable reaction behavior, not evidence that no reactions occurred.',
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
