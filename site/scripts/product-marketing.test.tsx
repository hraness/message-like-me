import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import Home from '../app/page.tsx';
import { SOFTWARE_VERSION } from '../app/_lib/site.ts';

const siteRoot = resolve(import.meta.dir, '..');

const HERO_VOCABULARY_TO_AVOID = [
  'bounded',
  'exact',
  'authority',
  'custody',
  'immutable',
  'inspectable',
  'canonical',
  'projection',
  'receipt',
] as const;

test('renders the outcome-led shared product-marketing grammar', () => {
  const html = renderToStaticMarkup(<Home />);

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain('>Draft messages that sound like you</h1>');
  for (const role of [
    'header',
    'hero',
    'proof-frame',
    'pillars',
    'section',
    'flow',
    'primitives',
    'trust',
    'install',
    'questions',
    'maker',
    'cta',
  ]) {
    expect(html).toContain(`data-hraness-marketing="${role}"`);
  }
  expect(html).toContain(`Install v${SOFTWARE_VERSION}`);
  expect(html).toContain('messagelikeme init');
  expect(html).toContain('messagelikeme doctor --json');
  expect(html).toContain('messagelikeme inspect tempo &lt;contact-id&gt; --json');
  expect(html).toContain('Use $message-like-me in your agent');
  expect(html).toContain('@hraness/message-like-me');
  expect(html).toContain('No. messagelikeme.com is an informational project page.');
  expect(html).toContain('stays on your machine in private local paths you choose');
  expect(html).toContain('with owner-only filesystem permissions');
  expect(html).not.toContain('readable only by you');
  expect(html).toContain('"@type":"FAQPage"');
  expect(html).toContain('Synthetic example');
  expect(html).toContain('Built by Ben Guo');
  expect(html).toContain('href="https://x.com/hraness"');
  expect(html).not.toMatch(/<(?:form|input|textarea)\b/u);
});

test('keeps the hero outcome-led and free of contract vocabulary', () => {
  const html = renderToStaticMarkup(<Home />);
  const hero = /<header[^>]*data-hraness-marketing="hero"[\s\S]*?<div class="hraness-marketing-hero__frame">/u.exec(html);
  expect(hero).not.toBeNull();
  const heroCopy = (hero?.[0] ?? '').replace(/<[^>]+>/gu, ' ').toLowerCase();
  const heading = /<h1[^>]*>([^<]+)<\/h1>/u.exec(html)?.[1] ?? '';

  expect(heading.split(/\s+/u).length).toBeLessThanOrEqual(8);
  expect(heading).not.toMatch(/\.$/u);
  expect(heroCopy).toContain(' you');
  expect(heroCopy).not.toContain('ask your agent to draft a reply about friday');
  expect(hero?.[0]).not.toContain('hraness-marketing-hero__example');
  const boundary = /<p class="hraness-marketing-hero__boundary">([^<]+)<\/p>/u.exec(hero?.[0] ?? '')?.[1] ?? '';
  expect(boundary).toBe('Local-first, drafts only, and free under the MIT license. macOS with Bun 1.3.14 or newer.');
  expect(boundary).not.toContain(SOFTWARE_VERSION);
  expect(hero?.[0]).toContain(`Install v${SOFTWARE_VERSION}`);
  for (const word of HERO_VOCABULARY_TO_AVOID) {
    expect(heroCopy).not.toMatch(new RegExp(`\\b${word}\\b`, 'u'));
  }
});

test('explains the synthetic draft before asking a reader to understand import commands', () => {
  const html = renderToStaticMarkup(<Home />);
  const frame = /<div class="mlm-frame"[\s\S]*?<\/figure>/u.exec(html)?.[0] ?? '';
  expect(frame).toContain('Unsent draft');
  expect(frame).toContain('More than word choice');
  expect(frame).toContain('Two short messages instead of one paragraph');
  expect(frame).toContain('Nothing is sent');
  expect(frame).not.toContain('export-message-like-me');
  expect(frame).not.toContain('ingest bundle');
  expect(html).toContain('not a measured result');
  expect(html).toContain('hosted agent, that agent handles its excerpts under its own privacy terms');
  expect(html.match(/<details class="source-details">/gu)).toHaveLength(5);
  expect(html).toContain('Import command and limits');
  expect(html).not.toMatch(/<details class="source-details"[^>]*\bopen/gu);
});

test('binds Design Kit v0.6.3 to one light-default accent palette', async () => {
  const [layout, css, manifestSource] = await Promise.all([
    readFile(resolve(siteRoot, 'app/layout.tsx'), 'utf8'),
    readFile(resolve(siteRoot, 'app/globals.css'), 'utf8'),
    readFile(resolve(siteRoot, 'package.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestSource) as {
    dependencies?: Record<string, string>;
  };

  expect(manifest.dependencies?.['@hraness/design-kit'])
    .toBe('github:hraness/design-kit#v0.6.3');
  expect(manifest.dependencies?.['@hraness/ui'])
    .toBe('github:hraness/ui#v0.5.13');
  expect(css).toContain("@import '@hraness/design-kit/product-marketing.css';");
  expect(layout).toContain("colorScheme: 'light dark'");
  expect(css).toContain('color-scheme: light dark;');
  expect(css).toContain('@media (prefers-color-scheme: dark)');
  expect(css).toContain('--hraness-site-accent: var(--accent);');
  expect(css).toContain('--hraness-site-accent-ink: var(--accent-ink);');
  expect(css).toContain(':where(.hraness-marketing-page, .hraness-marketing-header) {');
  expect(css).toContain('.mlm-marketing-hero {');
  expect(css).toContain('.mlm-marketing-trust .hraness-marketing-trust-grid {');
  expect(css).not.toContain('--acid');
  expect(css).not.toMatch(/transition:/u);
});
