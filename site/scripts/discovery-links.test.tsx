import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import RootLayout, { metadata } from '../app/layout.tsx';
import About from '../app/about/page.tsx';
import CompareGhostReplyPage from '../app/compare/ghostreply/page.tsx';
import Home from '../app/page.tsx';
import { SITE_TITLE } from '../app/_lib/site.ts';
import { GET as getLlmsText } from '../app/llms.txt/route.ts';

const siteRoot = resolve(import.meta.dir, '..');
const COMPARE_LINK = 'href="/compare/ghostreply"';

function jsonLdBlocks(html: string): unknown[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)].map((match) => JSON.parse(match[1] ?? 'null') as unknown);
}

function faqEntries(html: string): { name: string; text: string }[] {
  const faq = jsonLdBlocks(html).find((block) => (block as { '@type'?: unknown })['@type'] === 'FAQPage') as
    | { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
    | undefined;
  return (faq?.mainEntity ?? []).map(({ acceptedAnswer, name }) => ({ name, text: acceptedAnswer.text }));
}

test('names iMessage, WhatsApp, and Mac in the home title within 60 characters', () => {
  for (const fact of ['TextButler', 'iMessage', 'WhatsApp', 'Mac']) expect(SITE_TITLE).toContain(fact);
  expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
});

test('links the GhostReply comparison from the home FAQ, the footer, and the about page', () => {
  const home = renderToStaticMarkup(<Home />);
  const about = renderToStaticMarkup(<About />);
  const compare = renderToStaticMarkup(<CompareGhostReplyPage />);
  expect(home).toContain(`<a ${COMPARE_LINK}>TextButler compared with GhostReply</a>`);
  for (const [name, html] of Object.entries({ home, about, compare })) {
    expect(html, name).toContain(`${COMPARE_LINK}>Compare with GhostReply</a>`);
  }
});

test('keeps the home comparison answer identical in the visible FAQ and its JSON-LD', () => {
  const home = renderToStaticMarkup(<Home />);
  const entry = faqEntries(home).find(({ name }) => name === 'How is it different from Smart Reply, GhostReply, or OpenClaw?');
  expect(entry).toBeDefined();
  expect(home).toContain(`<p>${entry?.text ?? ''}</p>`);
  expect(entry?.text).not.toContain('compare/ghostreply');
  expect(entry?.text).toContain('If you only want suggestions, the built-in features are simpler.');
});

test('explains why replies are marked on the about page', () => {
  const about = renderToStaticMarkup(<About />);
  expect(about).toContain('>Why replies are marked</h2>');
  expect(about).toContain('so the model can’t leave it out');
});

test('describes the default AI route on the comparison page', () => {
  const compare = renderToStaticMarkup(<CompareGhostReplyPage />);
  expect(compare).toContain('Qwen 3.5 Flash through your own Vercel AI Gateway');
  expect(compare).not.toContain('fast-reply mode');
  expect(compare).toContain('Pick GhostReply for a finished $4.99 app whose replies read as yours.');
  expect(compare).toContain('comfortable building it from source');
});

test('describes the local model route the same way in llms.txt', async () => {
  const llms = await getLlmsText().text();
  expect(llms).toContain('is detected automatically');
  expect(llms).not.toContain('A habitat block in the host.json settings file');
});

test('scopes the no-commands claim to the Mac in the home comparison answer', () => {
  const entry = faqEntries(renderToStaticMarkup(<Home />)).find(({ name }) => name.startsWith('How is it different'));
  expect(entry?.text).toContain('its model can’t run commands on your Mac.');
});

test('publishes a free offer and the hub organization in site JSON-LD', () => {
  const html = renderToStaticMarkup(<RootLayout><main /></RootLayout>);
  const graph = (jsonLdBlocks(html)[0] as { '@graph': Record<string, unknown>[] })['@graph'];
  const organization = graph.find((node) => node['@type'] === 'Organization');
  expect(organization).toEqual({
    '@type': 'Organization',
    '@id': 'https://hraness.com/#organization',
    name: 'Hraness',
    alternateName: 'HRNSS',
    url: 'https://hraness.com/',
    logo: 'https://hraness.com/icon.png',
    sameAs: ['https://www.linkedin.com/company/hraness', 'https://github.com/hraness'],
  });
  const application = graph.find((node) => node['@type'] === 'SoftwareApplication');
  expect(application?.offers).toEqual({ '@type': 'Offer', price: '0', priceCurrency: 'USD' });
});

test('lists a 192-pixel icon whose bytes match the brand asset record', async () => {
  const icons = metadata.icons as { icon: { url: string; sizes: string }[] };
  expect(icons.icon.map(({ sizes, url }) => [url, sizes])).toEqual([['/icon.png', '32x32'], ['/icon-192.png', '192x192']]);
  const [png, record] = await Promise.all([
    readFile(resolve(siteRoot, 'public/icon-192.png')),
    readFile(resolve(siteRoot, 'BRAND_ASSETS.md'), 'utf8'),
  ]);
  expect(png.readUInt32BE(16)).toBe(192);
  expect(png.readUInt32BE(20)).toBe(192);
  expect(record).toContain(createHash('sha256').update(png).digest('hex'));
});
