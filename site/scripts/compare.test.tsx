import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { socialImageFit, socialImageSiteDetails } from '@hraness/web-discovery/social-image/card';

import * as ghostreplyImage from '../app/compare/ghostreply/opengraph-image.tsx';
import * as hermesImage from '../app/compare/hermes-agent/opengraph-image.tsx';
import * as metaAiImage from '../app/compare/meta-ai-whatsapp/opengraph-image.tsx';
import * as openclawImage from '../app/compare/openclaw/opengraph-image.tsx';
import * as hubImage from '../app/compare/opengraph-image.tsx';
import * as pokeImage from '../app/compare/poke/opengraph-image.tsx';
import CompareGhostReplyPage, { metadata as ghostreplyMetadata } from '../app/compare/ghostreply/page.tsx';
import CompareHermesPage from '../app/compare/hermes-agent/page.tsx';
import CompareMetaAiPage from '../app/compare/meta-ai-whatsapp/page.tsx';
import CompareOpenClawPage, { metadata as openclawMetadata } from '../app/compare/openclaw/page.tsx';
import CompareHubPage, { metadata as hubMetadata } from '../app/compare/page.tsx';
import ComparePokePage from '../app/compare/poke/page.tsx';
import {
  COMPARISONS,
  COMPARISONS_CHECKED_ON,
  GHOSTREPLY_CARD,
  HUB_CARD,
  HUB_ENTRIES,
  HUB_QUESTIONS,
} from '../app/compare/_lib/comparisons.ts';
import { GET as getLlmsText } from '../app/llms.txt/route.ts';
import sitemap from '../app/sitemap.ts';
import { SITE_NAME } from '../app/_lib/site.ts';
import { socialSite } from '../app/_lib/social.ts';

const pages = {
  '/compare': CompareHubPage,
  '/compare/openclaw': CompareOpenClawPage,
  '/compare/hermes-agent': CompareHermesPage,
  '/compare/poke': ComparePokePage,
  '/compare/meta-ai-whatsapp': CompareMetaAiPage,
  '/compare/ghostreply': CompareGhostReplyPage,
} as const;

type JsonLd = Record<string, unknown>;

function jsonLdBlocks(html: string): JsonLd[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gu)]
    .map((match) => JSON.parse(match[1] ?? 'null') as JsonLd);
}

function byType(html: string, type: string): JsonLd | undefined {
  return jsonLdBlocks(html).find((block) => block['@type'] === type);
}

function decode(html: string): string {
  // Decode &amp; last so an escaped entity is never unescaped twice.
  return html.replaceAll('&#x27;', '\'').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

test('the hub lists every comparison page and the hub table covers each one', () => {
  expect(HUB_ENTRIES.map(({ path }) => path)).toEqual([
    '/compare/openclaw',
    '/compare/hermes-agent',
    '/compare/poke',
    '/compare/meta-ai-whatsapp',
    '/compare/ghostreply',
  ]);
  const hub = renderToStaticMarkup(<CompareHubPage />);
  for (const { name, path } of HUB_ENTRIES) {
    expect(hub).toContain(`href="${path}"`);
    expect(hub).toContain(`<th scope="row"><a href="${path}">${name}</a></th>`);
  }
  const collection = byType(hub, 'CollectionPage') as { mainEntity: { numberOfItems: number } } | undefined;
  expect(collection?.mainEntity.numberOfItems).toBe(HUB_ENTRIES.length);
});

test('every compare page shows its checked date, a breadcrumb, and a visible FAQ that matches its JSON-LD', () => {
  for (const [path, Page] of Object.entries(pages)) {
    const html = renderToStaticMarkup(<Page />);
    expect(html, path).toContain(`<time dateTime="${COMPARISONS_CHECKED_ON}">${COMPARISONS_CHECKED_ON}</time>`);
    const faq = byType(html, 'FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
    expect(faq?.mainEntity.length, path).toBeGreaterThan(0);
    for (const { acceptedAnswer, name } of faq?.mainEntity ?? []) {
      expect(decode(html), path).toContain(`<h3>${name}</h3>`);
      expect(decode(html), path).toContain(`<p>${acceptedAnswer.text}</p>`);
    }
    const breadcrumb = path === '/compare'
      ? (byType(html, 'CollectionPage') as { breadcrumb: { itemListElement: { item: string }[] } }).breadcrumb
      : byType(html, 'BreadcrumbList') as { itemListElement: { item: string }[] };
    expect(breadcrumb.itemListElement.at(-1)?.item, path).toBe(`https://textbutler.app${path}`);
    expect(html, path).not.toContain('Message Like Me');
  }
});

test('comparison pages are about the one TextButler application and name the other product by its site', () => {
  for (const comparison of COMPARISONS) {
    const Page = pages[comparison.path as keyof typeof pages];
    const html = renderToStaticMarkup(<Page />);
    const page = byType(html, 'WebPage') as { about: { '@id': string }; mentions: { url: string }[] } | undefined;
    expect(page?.about['@id']).toBe('https://textbutler.app#application');
    expect(page?.mentions[0]?.url).toBe(comparison.officialUrl);
    expect(comparison.sources[0]?.href.startsWith(comparison.officialUrl)).toBe(true);
    expect(html).toContain(`Choose ${comparison.name === 'Meta AI in WhatsApp' ? 'Meta AI' : comparison.name}`);
    expect(html).toContain('Choose TextButler');
  }
});

test('compare pages use their own share cards, canonical URLs, and short titles', () => {
  expect(hubMetadata.alternates?.canonical).toBe('https://textbutler.app/compare');
  expect(JSON.stringify(hubMetadata.openGraph)).toContain('https://textbutler.app/compare/opengraph-image');
  expect(JSON.stringify(openclawMetadata.openGraph)).toContain('https://textbutler.app/compare/openclaw/opengraph-image');
  expect(JSON.stringify(ghostreplyMetadata.twitter)).toContain('https://textbutler.app/compare/ghostreply/opengraph-image');
  for (const comparison of COMPARISONS) {
    expect(`${comparison.title} | ${SITE_NAME}`.length, comparison.slug).toBeLessThanOrEqual(60);
    expect(comparison.description.length, comparison.slug).toBeLessThanOrEqual(200);
  }
  const routes = [hubImage, ghostreplyImage, openclawImage, hermesImage, pokeImage, metaAiImage];
  const cards = [HUB_CARD, GHOSTREPLY_CARD, ...COMPARISONS.map(({ card }) => card)];
  for (const [index, route] of routes.entries()) {
    expect(route.alt).toContain(cards[index]?.headline ?? '');
  }
  for (const card of [HUB_CARD, GHOSTREPLY_CARD, ...COMPARISONS.map(({ card }) => card)]) {
    const fit = socialImageFit(socialImageSiteDetails(socialSite, card));
    expect({ headline: card.headline, findings: fit.findings }).toEqual({ headline: card.headline, findings: [] });
  }
});

test('llms.txt and the sitemap carry every comparison', async () => {
  const llms = await getLlmsText().text();
  expect(llms.indexOf('## Key facts')).toBeGreaterThan(0);
  expect(llms.indexOf('## How TextButler compares')).toBeGreaterThan(llms.indexOf('## Key facts'));
  expect(llms).toContain('https://textbutler.app/compare');
  const urls = sitemap().map(({ url }) => url);
  for (const { path } of HUB_ENTRIES) {
    expect(llms).toContain(`(https://textbutler.app${path})`);
    expect(urls).toContain(`https://textbutler.app${path}`);
  }
  expect(urls).toContain('https://textbutler.app/compare');
  expect(HUB_QUESTIONS.length).toBeGreaterThan(0);
});
