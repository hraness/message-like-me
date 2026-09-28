import type { Metadata } from 'next';

export const SITE_NAME = 'Textbutler';
export const SITE_ORIGIN = 'https://textbutler.app';
export const SITE_TITLE = 'Textbutler | AI in your messages';
export const SITE_HEADLINE = 'AI in your messages.';
export const SITE_DESCRIPTION =
  'An assistant for your iMessage, WhatsApp, and Beeper chats on a Mac. Say “butler” in a chat you’ve turned on and get a clearly marked reply. Your coding agent can set it up.';
// The one-sentence "what it is": README line 5, the launch post, and the CLI
// description use the same words.
export const SITE_WHAT_IT_IS =
  'Textbutler puts a clearly marked AI assistant in the iMessage, WhatsApp, and Beeper chats you choose on your Mac, and it answers when someone says “butler”.';
// The one development-status statement. Pages render it where they state the
// status; README.md repeats it word for word and a site test keeps them equal.
export const SITE_STATUS_LABEL = 'In development';
export const SITE_STATUS =
  `${SITE_STATUS_LABEL}. Textbutler runs from source on a Mac: there is no app to download and no published Textbutler package, and new installs start paused. It connects to iMessage, WhatsApp, and Beeper through Ghostget. Replies can be written by a local model through Ollama (in testing), by Qwen 3.5 Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or Devin subscription through xcb. Automatic replies have worked end to end over iMessage in our testing. Try them on your own account, especially over WhatsApp or Beeper, before you rely on them.`;
// The canonical reply-writer sentence, reused verbatim wherever the options are named.
export const REPLY_WRITERS_SENTENCE =
  'Replies can be written by a local model through Ollama (in testing), by Qwen 3.5 Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or Devin subscription through xcb.';
export const REPLY_WRITERS_PRECEDENCE =
  'If you choose one with a command, that choice wins. Otherwise a saved Gateway key wins over a local model. Web search is off by default. When you turn it on, it uses your Gateway key, even when a local model writes the replies.';
export const SOCIAL_IMAGE_ALT = 'The Textbutler mark and the words “AI in your messages” beside a message bubble that reads 🤖{ 👀 }.';
// The prompt a reader pastes into Claude Code, Codex, or Devin. It follows the
// written guide; there is no Textbutler setup skill or one-line installer yet.
export const AGENT_SETUP_PROMPT = [
  'Set up Textbutler on this Mac: https://github.com/hraness/textbutler',
  'Follow docs/textbutler/getting-started.md step by step.',
  'If Ghostget isn\'t installed, set it up first: https://ghostget.com/docs/tutorials/getting-started',
  'Connect my iMessage, and WhatsApp or Beeper if I use them.',
  'For replies, use a local Ollama model if one is running; otherwise ask me which option I want.',
  'Run `textbutler doctor` after each step and do what it says.',
  'Stop and tell me whenever macOS asks for a permission, a pairing, or a key.',
  'Leave every contact turned off and don\'t send any messages.',
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
