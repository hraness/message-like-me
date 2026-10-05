import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { assertArticleAdmissions, articleProvenanceSentence } from '@hraness/design-kit';
import { NOINDEX_ROBOTS } from '@hraness/web-discovery';

import BlogIndexPage from '../app/blog/page.tsx';
import BlogPostPage, { generateMetadata, generateStaticParams } from '../app/blog/[slug]/page.tsx';
import { GET as getFeed } from '../app/blog/feed.xml/route.ts';
import { GET as getLlmsText } from '../app/llms.txt/route.ts';
import sitemap from '../app/sitemap.ts';
import { BLOG_ADMISSIONS } from '../app/_lib/blog-admissions.ts';
import {
  admissionFor,
  BLOG_POSTS,
  blogPostPath,
  indexableBlogPosts,
  isIndexablePost,
  provenanceFor,
} from '../app/_lib/blog.ts';
import { absoluteUrl, SITE_STATUS_LABEL } from '../app/_lib/site.ts';

const siteRoot = resolve(import.meta.dir, '..');

// Delivery vocabulary stays out of reader-facing posts (ARTICLE_COPY.md, AGENTS.md).
const POST_VOCABULARY_TO_AVOID = [
  'admission',
  'admitted',
  'qualification',
  'qualified',
  'custody',
  'composition',
  'source pilot',
  'source daemon',
  'compiled runtime',
  'receipt',
] as const;

// Cross-host links point only at posts in the reviewed blog manifest or at
// live product home pages.
const ALLOWED_EXTERNAL_LINKS = new Set([
  'https://algal.computer',
  'https://algal.computer/blog/built-on-algal/',
  'https://ghostget.com',
  'https://ghostget.com/blog/built-on-ghostget',
  'https://xcb.sh',
  'https://xcb.sh/blog/introducing-xcb',
  'https://peopleblade.com',
  'https://textbutler.app',
  'https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md',
  'https://github.com/hraness/textbutler/blob/main/docs/textbutler/messaging-apps.md',
  'https://github.com/hraness/textbutler/blob/main/docs/textbutler/native-subscription.md',
  'https://github.com/hraness/textbutler/blob/main/docs/textbutler/architecture.md',
]);

async function renderPost(slug: string): Promise<string> {
  return renderToStaticMarkup(await BlogPostPage({ params: Promise.resolve({ slug }) }));
}

function bodyOf(html: string): string {
  const start = html.indexOf('class="plain-publication__article-body"');
  const end = html.indexOf('class="plain-publication__article-footer"');
  return html.slice(start, end === -1 ? undefined : end);
}

function visibleText(html: string): string {
  let text = '';
  let inTag = false;
  let index = 0;
  while (index < html.length) {
    const rest = html.slice(index).toLowerCase();
    const boundary = rest.charAt(7);
    if (rest.startsWith('<script') && (boundary === '' || !/[a-z]/u.test(boundary))) {
      const close = rest.indexOf('</script>');
      if (close === -1) break;
      index += close + '</script>'.length;
      text += ' ';
      continue;
    }
    const character = html[index]!;
    if (character === '<') inTag = true;
    else if (character === '>') inTag = false;
    else if (!inTag) text += character;
    index += 1;
  }
  return text.replace(/\s+/gu, ' ').toLowerCase();
}

describe('blog admission records', () => {
  test('independent review hashes match the published bodies', async () => {
    type Receipt = {
      reviewer: string;
      reviewerType: string;
      reviews: Record<string, { sha256: string; verdict: string }>;
    };
    const provenanceDir = resolve(siteRoot, 'editorial-provenance');
    const receipts = new Map<string, Receipt>();
    const receiptFor = async (reviewedOn: string | undefined): Promise<Receipt> => {
      if (reviewedOn === undefined) throw new Error('A reviewed post has no review date.');
      const name = `review-${reviewedOn.replaceAll('-', '')}.json`;
      const cached = receipts.get(name);
      if (cached !== undefined) return cached;
      const receipt = JSON.parse(await readFile(resolve(provenanceDir, name), 'utf8')) as Receipt;
      receipts.set(name, receipt);
      return receipt;
    };
    for (const post of BLOG_POSTS) {
      const admission = admissionFor(post);
      const receipt = await receiptFor(admission.review?.reviewedOn);
      expect(receipt.reviewerType).toBe('ai');
      const path = `site/content/blog/${post.slug}.md`;
      const reviewed = receipt.reviews[path];
      expect(reviewed?.verdict, path).toBe('approve-written-body');
      const body = await readFile(resolve(siteRoot, '..', path));
      expect(createHash('sha256').update(body).digest('hex'), path).toBe(reviewed?.sha256);
      expect(admission.review?.reviewer, path).toBe(receipt.reviewer);
    }
  });

  test('validate with the shared rubric', () => {
    expect(() => assertArticleAdmissions(BLOG_ADMISSIONS)).not.toThrow();
  });

  test('cover every post exactly once and every post has a body file', async () => {
    const hrefs: string[] = BLOG_ADMISSIONS.map((admission): string => admission.href).toSorted();
    expect(hrefs).toEqual(BLOG_POSTS.map(blogPostPath).toSorted());
    const files = (await readdir(resolve(siteRoot, 'content/blog'))).toSorted();
    expect(files).toEqual(BLOG_POSTS.map((post) => `${post.slug}.md`).toSorted());
    expect(generateStaticParams().map(({ slug }) => slug)).toEqual(BLOG_POSTS.map((post) => post.slug));
  });

  test('record the disclosed AI review and any human-editor record', () => {
    for (const admission of BLOG_ADMISSIONS) {
      expect(admission.review?.reviewerType, admission.href).toBe('ai');
      if (admission.humanReview !== null) {
        expect(admission.humanReview.reviewer, admission.href).toBe('Ben Guo');
        expect(admission.humanReview.reviewerType, admission.href).toBe('human-editor');
      }
      expect(admission.drafting, admission.href).toBe('ai-from-source');
    }
  });

  test('lists reviewed articles with current runtime relations', () => {
    expect(indexableBlogPosts().map(blogPostPath)).toEqual([
      '/blog/marked-replies',
      '/blog/introducing-textbutler',
      '/blog/how-textbutler-uses-xcb',
      '/blog/how-textbutler-uses-algal',
      '/blog/how-textbutler-uses-ghostget',
    ]);
    for (const post of BLOG_POSTS) {
      expect(admissionFor(post).review?.reviewerType).toBe('ai');
      expect(post.relationIds).not.toContain('contract:wrench:message-like-me:exports-private-bundles');
    }
  });
});

describe('blog pages', () => {
  test('show the Hraness byline and the provenance note on every post', async () => {
    for (const post of BLOG_POSTS) {
      const html = await renderPost(post.slug);
      expect(html.match(/<h1\b/gu), post.slug).toHaveLength(1);
      expect(html, post.slug).toContain('By <a href="https://hraness.com" rel="author">Hraness</a>');
      const sentence = articleProvenanceSentence(provenanceFor(post));
      expect(sentence).toBe(`Drafted with AI from the source code and reviewed by ${admissionFor(post).review?.reviewer}.`);
      expect(html, post.slug).toContain(sentence);
      expect(html, post.slug).not.toMatch(/human/iu);
      expect(html, post.slug).toContain('"@type":"BlogPosting"');
      expect(html, post.slug).toContain(`"@id":"${absoluteUrl(blogPostPath(post))}#article"`);
      // The Hraness author/publisher party resolves to a real entity.
      expect(html, post.slug).toContain('"url":"https://hraness.com","sameAs":["https://github.com/hraness"]');
      expect(html, post.slug).toContain('class="plain-publication__sources"');
    }
  });

  test('set canonical, Open Graph, and noindex for quarantined posts', async () => {
    for (const post of BLOG_POSTS) {
      const metadata = await generateMetadata({ params: Promise.resolve({ slug: post.slug }) });
      expect(metadata.alternates?.canonical, post.slug).toBe(absoluteUrl(blogPostPath(post)));
      expect(metadata.openGraph?.url, post.slug).toBe(absoluteUrl(blogPostPath(post)));
      if (isIndexablePost(post)) {
        expect(metadata.robots, post.slug).toMatchObject({ index: true });
      } else {
        expect(metadata.robots, post.slug).toEqual(NOINDEX_ROBOTS);
      }
    }
  });

  test('link only to manifest posts and live product home pages', async () => {
    const internal = new Set(BLOG_POSTS.map(blogPostPath));
    for (const post of BLOG_POSTS) {
      const body = bodyOf(await renderPost(post.slug));
      for (const [, href] of body.matchAll(/href="([^"]+)"/gu)) {
        if (href === undefined || href.startsWith('#')) continue;
        if (href.startsWith('/')) expect(internal.has(href as `/blog/${string}`), `${post.slug} -> ${href}`).toBe(true);
        else expect(ALLOWED_EXTERNAL_LINKS.has(href), `${post.slug} -> ${href}`).toBe(true);
      }
    }
  });

  test('keep delivery vocabulary out of post bodies', async () => {
    for (const post of BLOG_POSTS) {
      const copy = visibleText(bodyOf(await renderPost(post.slug)));
      for (const word of POST_VOCABULARY_TO_AVOID) {
        expect(copy, `${post.slug}: ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`, 'u'));
      }
    }
  });

  test('keep installation details in the current guide and release pins out of evergreen articles', async () => {
    for (const post of BLOG_POSTS) {
      const source = await readFile(resolve(siteRoot, 'content/blog', `${post.slug}.md`), 'utf8');
      expect(source, post.slug).not.toMatch(/\b\d+\.\d+\.\d+\b/u);
      expect(source, post.slug).not.toContain(SITE_STATUS_LABEL);
    }
    const introducing = await renderPost('introducing-textbutler');
    expect(introducing).toContain('href="https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md"');
    expect(introducing).not.toContain('the-longer-version');
    expect(introducing).not.toContain('<time');
    const guide = await readFile(resolve(siteRoot, '../docs/textbutler/getting-started.md'), 'utf8');
    const rootPackage = JSON.parse(await readFile(resolve(siteRoot, '../package.json'), 'utf8')) as { packageManager: string };
    expect(guide).toContain(`Bun ${rootPackage.packageManager.replace(/^bun@/u, '')}`);
  });

  test('show related products only along registered relations', async () => {
    const ghostget = await renderPost('how-textbutler-uses-ghostget');
    expect(ghostget).toContain('href="https://ghostget.com"');
    expect(ghostget).not.toContain('href="https://peopleblade.com"');
    for (const post of BLOG_POSTS.filter((entry) => entry.slug.startsWith('how-'))) {
      expect(post.relationIds).toHaveLength(1);
      expect(post.relationIds[0]).toStartWith('runtime:message-like-me:');
    }
  });

  test('lists only indexable posts on the blog index', () => {
    const html = renderToStaticMarkup(<BlogIndexPage />);
    expect(html).toContain('"@type":"Blog"');
    for (const post of BLOG_POSTS) {
      const listed = html.includes(`href="${blogPostPath(post)}"`);
      expect(listed, post.slug).toBe(isIndexablePost(post));
    }
  });
});

describe('blog discovery', () => {
  test('puts indexable posts, with lastmod, in the sitemap, feed, and llms.txt only', async () => {
    const entries = sitemap();
    const feed = await getFeed().text();
    const llms = await getLlmsText().text();
    expect(feed).toStartWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"');
    expect(entries.some(({ url }) => url === absoluteUrl('/blog'))).toBe(true);
    for (const post of BLOG_POSTS) {
      const url = absoluteUrl(blogPostPath(post));
      const entry = entries.find((candidate) => candidate.url === url);
      const indexable = isIndexablePost(post);
      expect(entry !== undefined, post.slug).toBe(indexable);
      if (entry !== undefined) expect(entry.lastModified, post.slug).toEqual(new Date(`${post.updated ?? post.published}T00:00:00.000Z`));
      expect(feed.includes(`<id>${url}</id>`), post.slug).toBe(indexable);
      expect(llms.includes(url), post.slug).toBe(indexable);
    }
  });
});
