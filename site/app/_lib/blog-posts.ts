import type { ArticleIsoDate } from '@hraness/design-kit';

// Post metadata for textbutler.app/blog. Bodies live in content/blog/<slug>.md
// and render into app/blog/posts.generated.ts through `bun run sync:readme`.
// Whether a post is listed or indexed comes from its record in blog-admissions.ts.

export const BLOG_PATH = '/blog' as const;
export const BLOG_FEED_PATH = '/blog/feed.xml' as const;
export const BLOG_TITLE = 'TextButler blog';
export const BLOG_DESCRIPTION =
  'Choose who an assistant replies to, how it writes, and which tools it uses.';
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
    slug: 'marked-replies',
    title: 'How TextButler replies stay marked',
    dek: 'The model proposes; trusted code wraps every text in the contact’s visible symbols, non-text replies get a disclosed companion first, and a private journal keeps the record even if the wrap is cleared.',
    eyebrow: 'Explainer',
    published: '2026-10-05',
    tags: ['textbutler', 'messaging', 'disclosure', 'ai-labeling', 'honest-agents', 'local-first'],
    relationIds: [],
    card: {
      headline: 'How replies stay marked',
      description: 'The marker lives in the send path.',
    },
  },
  {
    slug: 'introducing-textbutler',
    title: 'Introducing TextButler',
    dek: 'Choose which conversations an assistant can answer, how it identifies itself, and where replies are written. Start with one reviewed draft.',
    eyebrow: 'Launch',
    published: '2026-09-24',
    updated: '2026-10-01',
    tags: ['textbutler', 'messaging', 'imessage', 'local-models', 'ollama', 'macos', 'coding-agents', 'xcb'],
    relationIds: [
      'runtime:message-like-me:wrench:reads-and-sends-messages-through',
      'runtime:message-like-me:xcb:drafts-replies-through',
      'runtime:message-like-me:algal:runs-reply-habitats-on',
    ],
    card: { description: 'Choose which chats an assistant can answer.' },
  },
  {
    slug: 'how-textbutler-uses-xcb',
    title: 'How TextButler uses xcb to reply on your own subscription',
    dek: 'Run replies through a model subscription you already use, while keeping contact permissions and sending in TextButler.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-10-01',
    tags: ['textbutler', 'xcb', 'subscriptions', 'drafts', 'claude-code', 'codex', 'devin'],
    relationIds: ['runtime:message-like-me:xcb:drafts-replies-through'],
    card: {
      headline: 'How TextButler uses xcb',
      description: 'One reply writer is your AI subscription.',
    },
  },
  {
    slug: 'how-textbutler-uses-algal',
    title: 'How TextButler uses ALGAL to compare reply plans',
    dek: 'Compare a proposed reply plan with the current one on past conversations, while keeping contact permissions and account settings under your control.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-10-01',
    tags: ['textbutler', 'algal', 'habitats', 'drafts', 'messaging', 'local-first'],
    relationIds: ['runtime:message-like-me:algal:runs-reply-habitats-on'],
    card: {
      headline: 'How TextButler uses ALGAL',
      description: 'Compare reply guidance on past conversations.',
    },
  },
  {
    slug: 'how-textbutler-uses-ghostget',
    title: 'How TextButler uses GhostGet to connect your chats',
    dek: 'GhostGet connects to messaging apps. TextButler uses the conversation to prepare a reply and checks the contact’s settings before sending it.',
    eyebrow: 'Integration',
    published: '2026-09-24',
    updated: '2026-10-01',
    tags: ['textbutler', 'ghostget', 'beeper', 'whatsapp', 'message-history', 'local-first'],
    relationIds: ['runtime:message-like-me:wrench:reads-and-sends-messages-through'],
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
