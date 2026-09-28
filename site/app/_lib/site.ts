import type { Metadata } from 'next';

export const SITE_NAME = 'Textbutler';
export const SITE_ORIGIN = 'https://textbutler.app';
export const SITE_TITLE = 'Textbutler: AI in your iMessage and WhatsApp chats on Mac';
export const SITE_HEADLINE = 'AI in your messages.';
export const SITE_DESCRIPTION =
  'When someone you’ve turned on texts “butler”, a clearly marked AI assistant answers for you from your Mac, in iMessage, WhatsApp, and Beeper. Claude Code, Codex, or Devin can set it up for you.';
// The one-sentence "what it is": README line 5, the launch post, and the CLI
// description use the same words.
export const SITE_WHAT_IT_IS =
  'Textbutler puts a clearly marked AI assistant in the iMessage, WhatsApp, and Beeper chats you choose on your Mac, and it answers when someone says “butler”.';
// The one development-status statement. Pages render it where they state the
// status; README.md repeats it word for word and a site test keeps them equal.
export const SITE_STATUS_LABEL = 'In development';
export const SITE_STATUS =
  `${SITE_STATUS_LABEL}. Textbutler runs on a Mac, built from its source code: there’s no app to download yet, and new installs start paused. Automatic replies have worked end to end over iMessage in our testing. Try them on your own account, especially over WhatsApp or Beeper, before you rely on them.`;
// The canonical reply-writer sentence, reused verbatim wherever the options are named.
export const REPLY_WRITERS_SENTENCE =
  'Replies can be written by a local model through Ollama (in testing), by Qwen 3.5 Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or Devin subscription through xcb.';
export const REPLY_WRITERS_PRECEDENCE =
  'If you choose one with a command, that choice wins. Otherwise a saved Gateway key wins, and with no key saved, an Ollama server already serving the pinned model is picked up when the background service starts. When a Gateway key is saved, the butler can also search the web for the people you turn on (in your own chat, only when you ask), using your key even when a local model writes the replies. It refuses any search that reuses words from your private messages, and you can turn search off for one person from the command line.';
export const SOCIAL_IMAGE_ALT = 'The words “AI in your messages” beside an iPhone Messages chat: a friend asks “Butler, what time did Sam say?”, and the answer arrives marked 🤖{ }.';
// The prompt a reader pastes into Claude Code, Codex, or Devin. It follows the
// written guide; there is no Textbutler setup skill or one-line installer yet.
export const AGENT_SETUP_PROMPT = [
  'Set up Textbutler on this Mac: https://github.com/hraness/textbutler',
  'Follow docs/textbutler/getting-started.md step by step.',
  'If Ghostget isn\'t installed, set it up first: https://ghostget.com/docs/tutorials/getting-started',
  'Connect my iMessage, and WhatsApp or Beeper if I use them.',
  'For replies, if Ollama is running with qwen3:4b-instruct-2507-q4_K_M, choose it with `textbutler providers local`; otherwise ask me which option I want.',
  'Run `textbutler doctor` after each step and do what it says.',
  'Stop and tell me whenever macOS asks for a permission, a pairing, or a key.',
  'Leave every chat turned off and don\'t send any messages.',
].join('\n');
export const GITHUB_URL = 'https://github.com/hraness/textbutler';
export const ARCHITECTURE_URL = `${GITHUB_URL}/blob/main/docs/textbutler/architecture.md`;
export const GETTING_STARTED_URL = `${GITHUB_URL}/blob/main/docs/textbutler/getting-started.md`;
export const MESSAGING_APPS_URL = `${GITHUB_URL}/blob/main/docs/textbutler/messaging-apps.md`;
export const AGENT_CLI_URL = `${GITHUB_URL}/blob/main/docs/textbutler/agent-cli.md`;
export const SUBSCRIPTION_GUIDE_URL = `${GITHUB_URL}/blob/main/docs/textbutler/native-subscription.md`;
export const GHOSTGET_SETUP_URL = 'https://ghostget.com/docs/tutorials/getting-started';
export const XCB_URL = 'https://github.com/hraness/xcb';
// The immutable legacy release coordinate; not a Textbutler app version.
export const SOFTWARE_VERSION = '0.8.22';
export const RELEASE_URL = `${GITHUB_URL}/releases/tag/v${SOFTWARE_VERSION}`;

export const CANONICAL_PAGE_PATHS = [
  '/',
  '/about',
  '/sources',
  '/docs',
  '/methodology',
  '/research',
  '/compare/ghostreply',
] as const;

export type CanonicalPagePath = (typeof CANONICAL_PAGE_PATHS)[number];
export type SitePath = `/${string}`;

export function absoluteUrl(path: SitePath = '/'): string {
  if (path === '/') return SITE_ORIGIN;
  return new URL(path, `${SITE_ORIGIN}/`).toString();
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</gu, '\\u003c');
}

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: CanonicalPagePath;
}): Metadata {
  const url = absoluteUrl(path);
  const resolvedTitle = path === '/' ? { absolute: title } : title;
  const socialTitle = path === '/' ? title : `${title} | ${SITE_NAME}`;
  return {
    title: resolvedTitle,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: socialTitle,
      description,
      images: [{
        url: absoluteUrl('/opengraph-image'),
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: SOCIAL_IMAGE_ALT,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description,
      images: [{
        url: absoluteUrl('/opengraph-image'),
        alt: SOCIAL_IMAGE_ALT,
      }],
    },
  };
}

// Each page carries the date its content last changed materially. Set these by
// hand: Vercel builds from shallow clones, so Git history is not available.
// The docs page publishes its dateModified from this table too.
export const PAGE_LAST_MODIFIED = {
  '/': '2026-09-28',
  '/sources': '2026-09-11',
  '/docs': '2026-09-28',
  '/methodology': '2026-09-11',
  '/research': '2026-09-11',
  '/about': '2026-09-28',
  '/compare/ghostreply': '2026-09-28',
} as const;
