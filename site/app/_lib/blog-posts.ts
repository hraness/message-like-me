import type { ArticleIsoDate } from '@hraness/design-kit';

// Post metadata for textbutler.app/blog. Bodies live in content/blog/<slug>.md
// and render into app/blog/posts.generated.ts through `bun run sync:readme`.
// Whether a post is listed or indexed comes from its record in blog-admissions.ts.

export const BLOG_PATH = '/blog' as const;
export const BLOG_FEED_PATH = '/blog/feed.xml' as const;
export const BLOG_TITLE = 'TextButler blog';
export const BLOG_DESCRIPTION =
  'Posts about TextButler, AI in your messages: how it decides when to answer, what writes its replies, and the tools it runs on.';
// The blog share card's copy, written to fit the card as drawn (see scripts/social-image.test.ts).
// The page's own heading is "Blog", which the card shows as its eyebrow, so the
// card headline names what the posts are about instead of repeating it.
export const BLOG_CARD_HEADLINE = 'Posts about TextButler';
export const BLOG_CARD_DESCRIPTION = 'How it decides when to answer, what writes its replies, and the tools it runs on.';

// Share-card copy for a post, written to fit the card without being shortened.
// Fields left out fall back to the post's own title, dek, and eyebrow.
export type BlogPostCard = Readonly<{ headline?: string; description?: string; eyebrow?: string }>;

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
  card?: BlogPostCard;
}>;

export const BLOG_POSTS: readonly BlogPost[] = [
  {
    slug: 'introducing-textbutler',
    title: 'Introducing TextButler',
    dek: 'AI in your messages. When someone you’ve turned on texts “butler”, a clearly marked AI assistant answers for you from your Mac. Claude Code, Codex, or Devin can set it up for you.',
    eyebrow: 'Launch',
    published: '2026-09-24',
    updated: '2026-09-30',
    tags: ['textbutler', 'messaging', 'imessage', 'local-models', 'ollama', 'macos', 'coding-agents', 'xcb'],
    relationIds: [
      'contract:wrench:message-like-me:exports-private-bundles',
      'contract:message-like-me:peopleblade:shared-bundle-format',
    ],
    card: { description: 'AI in your messages. A clearly marked AI assistant answers for you from your Mac.' },
  },
  {
    slug: 'how-textbutler-uses-xcb',
    title: 'How TextButler uses xcb to reply on your own subscription',
    dek: 'One of TextButler’s three reply writers is the Claude Code, Codex, or Devin subscription you already pay for, reached through xcb with no tools of its own.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'xcb', 'subscriptions', 'drafts', 'claude-code', 'codex', 'devin'],
    relationIds: [],
    card: {
      headline: 'How TextButler uses xcb',
      description: 'One reply writer is your AI subscription.',
    },
  },
  {
    slug: 'how-textbutler-uses-algal',
    title: 'How TextButler uses ALGAL to improve replies per contact',
    dek: 'A TextButler habitat replaces a contact\'s reply plan only after a blinded ALGAL replay scores the new plan no lower on any case and higher on average.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'algal', 'habitats', 'drafts', 'messaging', 'local-first'],
    relationIds: [],
    card: {
      headline: 'How TextButler uses ALGAL',
      description: 'A new reply plan must win a blinded replay.',
    },
  },
  {
    slug: 'how-textbutler-uses-ghostget',
    title: 'How the legacy history tools use GhostGet to import your message history',
    dek: 'The legacy Message Like Me history tools import Beeper and WhatsApp history from a private folder that GhostGet writes. Live TextButler replies take a different path.',
    eyebrow: 'Legacy',
    published: '2026-09-24',
    updated: '2026-09-28',
    tags: ['textbutler', 'ghostget', 'beeper', 'whatsapp', 'message-history', 'local-first'],
    relationIds: ['contract:wrench:message-like-me:exports-private-bundles'],
    card: {
      headline: 'How TextButler uses GhostGet',
      description: 'It reads and sends live messages via GhostGet.',
      eyebrow: 'Integration',
    },
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
