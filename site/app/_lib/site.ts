import { marketing, marketingHeading } from "../../portfolio-copy";
import type { Metadata } from 'next';

import { SOCIAL_IMAGE_ALT } from './social';

export const SITE_NAME = marketing.names.name;
export const SITE_ORIGIN = 'https://textbutler.app';
export const SITE_TITLE = marketingHeading("site-title");
export const SITE_HEADLINE = marketing.hero.heading;
export const SITE_DESCRIPTION =
  marketing.meta;
// The one-sentence "what it is": README line 5, the launch post, and the CLI
// description use the same words.
export const SITE_WHAT_IT_IS =
  'TextButler adds an assistant to the iMessage, WhatsApp, and Beeper chats you choose on your Mac. By default, it answers “butler” requests and marks its replies as AI.';
// The machine-readable development stage is distinct from the brief setup
// fact shared by the homepage, README, and discovery text.
export const SITE_STATUS_LABEL = 'In development';
export const SITE_STATUS =
  'TextButler runs on your Mac. New installs start paused until you choose which chats it can answer.';
// The canonical reply-writer sentence, reused verbatim wherever the options are named.
export const REPLY_WRITERS_SENTENCE =
  'Replies can be written by a local model through Ollama, by Qwen through your own Vercel AI Gateway key, or by your Claude Code, Codex, or Devin subscription through xcb.';
export const REPLY_WRITERS_PRECEDENCE =
  'If you choose one with a command, that choice wins. Otherwise a saved Gateway key wins, and with no key saved, an Ollama server already serving the pinned model is picked up when the background service starts. When a Gateway key is saved, the butler can also search the web for the people you turn on (in your own chat, only when you ask), using your key even when a local model writes the replies. It refuses any search that reuses words from your private messages, and you can turn search off for one person from the command line.';
export { SOCIAL_IMAGE_ALT };
// The prompt a reader pastes into a coding agent follows the setup guide.
export const AGENT_SETUP_PROMPT = [
  'Set up TextButler on this Mac: https://github.com/hraness/textbutler',
  'Follow docs/textbutler/getting-started.md step by step.',
  'Install or update GhostGet to exactly 0.18.71: https://ghostget.com/docs/tutorials/getting-started',
  'Check `ghostget --version`, then restart or reconnect TextButler\'s GhostGet host so it checks the new capabilities.',
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
// The immutable legacy release coordinate; not a TextButler app version.
export const SOFTWARE_VERSION = '0.8.24';
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
  '/': '2026-10-01',
  '/sources': '2026-09-11',
  '/docs': '2026-10-01',
  '/methodology': '2026-09-11',
  '/research': '2026-09-11',
  '/about': '2026-10-01',
  '/compare/ghostreply': '2026-10-01',
} as const;
