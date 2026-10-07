import { describe, expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import nextConfig, { retiredPageRedirects } from '../next.config.ts';
import RootLayout from '../app/layout.tsx';
import { GET as getLlmsText } from '../app/llms.txt/route.ts';
import AboutPage from '../app/about/page.tsx';
import DocsPage from '../app/docs/page.tsx';
import HomePage from '../app/page.tsx';
import NotFound from '../app/not-found.tsx';
import Preview from '../app/preview/page.tsx';
import sitemap from '../app/sitemap.ts';
import { CANONICAL_PAGE_PATHS } from '../app/_lib/site.ts';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');
const RETIRED_PATHS = ['/sources', '/methodology', '/research'] as const;
const RETIRED_NAME = /message like me|messagelikeme|message-like-me/iu;

async function source(path: string): Promise<string> {
  return Bun.file(resolve(repositoryRoot, path)).text();
}

describe('site routes', () => {
  test('dates each static route by its last material change', () => {
    // Blog entries carry their own dates; scripts/blog.test.tsx covers them.
    const routeDates = sitemap().filter(({ url }) => !new URL(url).pathname.startsWith('/blog')).map(({ lastModified, url }) => {
      if (!(lastModified instanceof Date)) throw new Error(`Expected a Date lastModified value for ${url}`);
      return [new URL(url).pathname, lastModified.toISOString()];
    });

    expect(routeDates).toEqual([
      ['/', '2026-10-02T00:00:00.000Z'],
      ['/docs', '2026-10-04T00:00:00.000Z'],
      ['/about', '2026-10-02T00:00:00.000Z'],
      ['/compare', '2026-10-04T00:00:00.000Z'],
      ['/compare/openclaw', '2026-10-04T00:00:00.000Z'],
      ['/compare/hermes-agent', '2026-10-04T00:00:00.000Z'],
      ['/compare/meta-ai-whatsapp', '2026-10-04T00:00:00.000Z'],
      ['/compare/ghostreply', '2026-10-04T00:00:00.000Z'],
    ]);
  });

  test('returns a real 404 for the retired prototype pages', async () => {
    const redirects = await nextConfig.redirects?.() ?? [];
    for (const path of RETIRED_PATHS) {
      expect(redirects.find((entry) => entry.source === path), path).toBeUndefined();
    }
    const routes = await readdir(resolve(siteRoot, 'app'));
    for (const path of RETIRED_PATHS) expect(routes, path).not.toContain(path.slice(1));
  });

  test('redirects a folded page only to a page that answers the same question', async () => {
    const redirects = await nextConfig.redirects?.() ?? [];
    expect(retiredPageRedirects.map(({ source }) => source)).toEqual(['/compare/poke']);
    for (const { destination, source } of retiredPageRedirects) {
      const redirect = redirects.find((entry) => entry.source === source);
      expect(redirect?.permanent, source).toBe(true);
      expect(redirect?.destination, source).toBe(destination);
      expect(CANONICAL_PAGE_PATHS as readonly string[], source).toContain(destination);
      expect(CANONICAL_PAGE_PATHS as readonly string[], source).not.toContain(source);
    }
    const compareRoutes = await readdir(resolve(siteRoot, 'app/compare'));
    expect(compareRoutes).not.toContain('poke');
  });

  test('never links or names the retired prototype on public pages', async () => {
    const modelText = await getLlmsText().text();
    const sitemapUrls = sitemap().map(({ url }) => new URL(url).pathname);
    const rendered = [
      renderToStaticMarkup(HomePage()),
      renderToStaticMarkup(await AboutPage()),
      renderToStaticMarkup(DocsPage()),
      renderToStaticMarkup(NotFound()),
      renderToStaticMarkup(Preview()),
      renderToStaticMarkup(RootLayout({ children: null })),
    ];
    const blogDir = resolve(siteRoot, 'content/blog');
    const blogBodies = await Promise.all((await readdir(blogDir)).map((name) => Bun.file(resolve(blogDir, name)).text()));
    const docsDir = resolve(repositoryRoot, 'docs/textbutler');
    const guides = await Promise.all((await readdir(docsDir)).map((name) => Bun.file(resolve(docsDir, name)).text()));
    const repositoryCopy = await Promise.all(['README.md', 'CONTRIBUTING.md', 'SECURITY.md'].map(source));

    for (const copy of [modelText, ...rendered, ...blogBodies, ...guides, ...repositoryCopy]) {
      expect(copy).not.toMatch(RETIRED_NAME);
    }
    for (const copy of [modelText, ...rendered]) {
      for (const path of RETIRED_PATHS) expect(copy).not.toContain(`textbutler.app${path}`);
      for (const path of RETIRED_PATHS) expect(copy).not.toContain(`href="${path}"`);
    }
    for (const path of RETIRED_PATHS) expect(sitemapUrls).not.toContain(path);
  });

  test('describes the application without a release version', () => {
    const renderedRootLayout = renderToStaticMarkup(RootLayout({ children: null }));
    const jsonLdSource = /<script type="application\/ld\+json">([^<]+)<\/script>/u.exec(renderedRootLayout)?.[1];
    expect(jsonLdSource).toBeDefined();
    const jsonLd = JSON.parse(jsonLdSource ?? '{}') as {
      '@graph'?: Array<{ '@type'?: string; featureList?: unknown; softwareVersion?: unknown }>;
    };
    const softwareApplication = jsonLd['@graph']?.find((entry) => entry['@type'] === 'SoftwareApplication');
    expect(softwareApplication?.softwareVersion).toBeUndefined();
    expect(Array.isArray(softwareApplication?.featureList)).toBe(true);
    expect(renderedRootLayout).not.toContain('downloadUrl');
    expect(renderedRootLayout).toContain('"creativeWorkStatus":"In development"');
  });

  test('rejects overclaiming copy', async () => {
    const publicCopy = (await Promise.all([
      'site/app/page.tsx',
      'site/app/about/page.tsx',
      'site/app/llms.txt/route.ts',
      'site/app/layout.tsx',
      'README.md',
    ].map(source))).join('\n').toLowerCase();
    for (const rejected of [
      'all connected accounts',
      'connect your beeper account',
      'official beeper integration',
      'digital twin',
      'autonomous messaging',
      'local-only',
      'never leaves your device',
    ]) {
      expect(publicCopy).not.toContain(rejected);
    }
  });
});

describe('security posture', () => {
  test('publishes a current RFC 9116 security.txt with a private reporting route', async () => {
    const text = await Bun.file(resolve(siteRoot, 'public/.well-known/security.txt')).text();
    expect(text).toContain('Contact: https://github.com/hraness/textbutler/security/advisories/new');
    expect(text).toContain('Canonical: https://textbutler.app/.well-known/security.txt');
    const expires = /^Expires: (.+)$/mu.exec(text)?.[1];
    expect(expires).toBeDefined();
    expect(Date.parse(expires ?? '')).toBeGreaterThan(Date.now());
  });

  test('sends hardening headers on every route and denies framing outside the preview', async () => {
    const rules = await nextConfig.headers?.();
    const keys = (rules ?? []).flatMap(({ headers }) => headers.map(({ key }) => key));
    for (const key of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']) {
      expect(keys).toContain(key);
    }
  });
});
