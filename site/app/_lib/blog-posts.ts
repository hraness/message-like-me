import type { ArticleIsoDate } from '@hraness/design-kit';

// Post metadata for textbutler.app/blog. Bodies live in content/blog/<slug>.md
// and render into app/blog/posts.generated.ts through `bun run sync:readme`.
// Whether a post is listed or indexed comes from its record in blog-admissions.ts.

export const BLOG_PATH = '/blog' as const;
export const BLOG_FEED_PATH = '/blog/feed.xml' as const;
export const BLOG_TITLE = 'Textbutler blog';
export const BLOG_DESCRIPTION =
  'Posts about Textbutler, AI in your messages: how it decides when to answer, what writes its replies, and the tools it runs on.';

export type BlogPost = Readonly<{
  slug: string;
  title: string;
  dek: string;
  eyebrow: string;
  published: ArticleIsoDate;
  updated?: ArticleIsoDate;
  tags: readonly string[];
  // Registered portfolio relations this post is about; they pick the related products shown.
  relationIds: readonly string[];
}>;

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: 'introducing-textbutler',
    title: 'Introducing Textbutler',
    dek: 'AI in your messages. When someone you’ve turned on texts “butler”, a clearly marked AI assistant answers for you from your Mac. Claude Code, Codex, or Devin can set it up for you.',
    eyebrow: 'Launch',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'messaging', 'imessage', 'local-models', 'ollama', 'macos', 'coding-agents', 'xcb'],
    relationIds: [
      'contract:wrench:message-like-me:exports-private-bundles',
      'contract:message-like-me:peopleblade:shared-bundle-format',
    ],
  },
  {
    slug: 'how-textbutler-uses-xcb',
    title: 'How Textbutler uses xcb to reply on your own subscription',
    dek: 'One of Textbutler’s three reply writers is the Claude Code, Codex, or Devin subscription you already pay for, reached through xcb with no tools of its own.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'xcb', 'subscriptions', 'drafts', 'claude-code', 'codex', 'devin'],
    relationIds: [],
  },
  {
    slug: 'how-textbutler-uses-algal',
    title: 'How Textbutler uses ALGAL to improve replies per contact',
    dek: 'A Textbutler habitat replaces a contact\'s reply plan only after a blinded ALGAL replay scores the new plan no lower on any case and higher on average.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'algal', 'habitats', 'drafts', 'messaging', 'local-first'],
    relationIds: [],
  },
  {
    slug: 'how-textbutler-uses-ghostget',
    title: 'How the legacy history tools use Ghostget to import your message history',
    dek: 'The legacy Message Like Me history tools import Beeper and WhatsApp history from a private folder that Ghostget writes. Live Textbutler replies take a different path.',
    eyebrow: 'Legacy',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'ghostget', 'beeper', 'whatsapp', 'message-history', 'local-first'],
    relationIds: ['contract:wrench:message-like-me:exports-private-bundles'],
  },
];

export type BlogPostPath = `/blog/${string}`;

export function blogPostPath(post: Pick<BlogPost, 'slug'>): BlogPostPath {
  return `/blog/${post.slug}`;
}

export function blogPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function isoTimestamp(date: ArticleIsoDate): string {
  return `${date}T00:00:00.000Z`;
}
