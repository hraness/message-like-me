import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import Home from '../app/page.tsx';
import { SITE_DESCRIPTION, SOFTWARE_VERSION } from '../app/_lib/site.ts';

const siteRoot = resolve(import.meta.dir, '..');

test('renders the evidence-led shared product-marketing grammar', () => {
  const html = renderToStaticMarkup(<Home />);

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain(SITE_DESCRIPTION);
  for (const role of ['hero', 'flow', 'facts', 'install', 'interfaces', 'trust', 'questions', 'cta']) {
    expect(html).toContain(`data-hraness-marketing="${role}"`);
  }
  expect(html).toContain(`Install v${SOFTWARE_VERSION}`);
  expect(html).toContain('messagelikeme init');
  expect(html).toContain('messagelikeme doctor --json');
  expect(html).toContain('messagelikeme inspect tempo &lt;contact-id&gt; --json');
  expect(html).toContain('Use $message-like-me in your agent');
  expect(html).toContain('@hraness/message-like-me');
  expect(html).toContain('No. messagelikeme.com is an informational project page.');
  expect(html).toContain('"@type":"FAQPage"');
  expect(html).not.toMatch(/<(?:form|input|textarea)\b/u);
});

test('binds Design Kit v0.3.0 to the Message Like Me visual identity', async () => {
  const [layout, css, manifestSource] = await Promise.all([
    readFile(resolve(siteRoot, 'app/layout.tsx'), 'utf8'),
    readFile(resolve(siteRoot, 'app/globals.css'), 'utf8'),
    readFile(resolve(siteRoot, 'package.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestSource) as {
    dependencies?: Record<string, string>;
  };

  expect(manifest.dependencies?.['@hraness/design-kit'])
    .toBe('github:hraness/design-kit#v0.3.0');
  expect(layout).toContain("import '@hraness/design-kit/product-marketing.css';");
  expect(css).toContain('.mlm-marketing-hero {');
  expect(css).toContain('.mlm-marketing-trust {');
  expect(css).toContain('--hraness-marketing-accent: var(--acid);');
});
