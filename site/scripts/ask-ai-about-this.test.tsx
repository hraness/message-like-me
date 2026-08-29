import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import AboutPage from '../app/about/page.tsx';
import DocsPage from '../app/docs/page.tsx';
import MethodologyPage from '../app/methodology/page.tsx';
import NotFound from '../app/not-found.tsx';
import Home from '../app/page.tsx';
import ResearchPage from '../app/research/page.tsx';
import SourcesPage from '../app/sources/page.tsx';
import {
  absoluteUrl,
  CANONICAL_PAGE_PATHS,
  type CanonicalPagePath,
  SITE_ORIGIN,
} from '../app/_lib/site.ts';

type PageRender = () => ReactNode | Promise<ReactNode>;

const providerHosts = [
  'chatgpt.com',
  'claude.ai',
  'perplexity.ai',
  'x.com',
] as const;

const canonicalPages: readonly Readonly<{
  path: CanonicalPagePath;
  render: PageRender;
}>[] = [
  { path: '/', render: Home },
  { path: '/about', render: AboutPage },
  { path: '/sources', render: SourcesPage },
  { path: '/docs', render: DocsPage },
  { path: '/methodology', render: MethodologyPage },
  { path: '/research', render: ResearchPage },
];

function askAiNav(html: string): string {
  const match = /<nav\b[^>]*aria-label="Ask AI about this"[^>]*>[\s\S]*?<\/nav>/u.exec(html);
  expect(match).not.toBeNull();
  return match?.[0] ?? '';
}

function assertAskAiLinks(html: string, path: CanonicalPagePath): void {
  const nav = askAiNav(html);
  const expectedSubject = path === '/' ? SITE_ORIGIN : `${SITE_ORIGIN}${path}`;
  const anchors = [...nav.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gu)];

  expect(absoluteUrl(path)).toBe(expectedSubject);
  expect(nav).toContain('>Ask AI about this<');
  expect(nav).toContain('class="hraness-ask-ai-about-this');
  expect(nav).toContain('message-like-me-ask-ai');
  expect(nav).not.toContain('data-analytics-');
  expect(anchors).toHaveLength(providerHosts.length);

  for (const [index, anchor] of anchors.entries()) {
    const expectedHost = providerHosts[index];
    const tag = anchor[0];
    const href = anchor[1];
    if (expectedHost === undefined || href === undefined) {
      throw new Error('Ask AI anchor does not match the provider contract');
    }
    const destination = new URL(href.replaceAll('&amp;', '&'));
    const prompt = destination.searchParams.get('q')
      ?? destination.searchParams.get('text');

    expect(destination.protocol).toBe('https:');
    expect(destination.hostname).toBe(expectedHost);
    expect(prompt).toBe(`Tell me about ${expectedSubject}`);
    expect(prompt).toContain('https://');
    expect(tag).toContain('target="_blank"');
    expect(tag).toContain('rel="noopener noreferrer nofollow"');
  }
}

test('server-renders exact Ask AI subjects on all six canonical pages', async () => {
  expect(canonicalPages.map(({ path }) => path)).toEqual([
    ...CANONICAL_PAGE_PATHS,
  ]);

  for (const page of canonicalPages) {
    const html = renderToStaticMarkup(await page.render());
    assertAskAiLinks(html, page.path);
  }
});

test('keeps the Ask AI block off the not-found page', () => {
  const html = renderToStaticMarkup(<NotFound />);

  expect(html).not.toContain('aria-label="Ask AI about this"');
  expect(html).not.toContain('>Ask AI about this<');
});

test('loads only the portable UI tokens and generated component styles', async () => {
  const css = await readFile(
    resolve(import.meta.dir, '../app/globals.css'),
    'utf8',
  );

  expect(css).toContain("@import '@hraness/ui/tokens.css';");
  expect(css).toContain("@import '@hraness/ui/stylex.css';");
  expect(css).not.toMatch(/@hraness\/ui\/(?:components|reset|styles|tailwind)\.css/u);
  expect(css).toContain('nav.message-like-me-ask-ai {');
  expect(css).toContain(
    'nav.message-like-me-ask-ai [data-slot="ask-ai-about-this-link"] {',
  );
  expect(css).toContain(
    'nav.message-like-me-ask-ai [data-slot="ask-ai-about-this-link"]:hover,',
  );
});
