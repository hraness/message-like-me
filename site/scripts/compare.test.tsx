import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { socialImageFit, socialImageSiteDetails } from '@hraness/web-discovery/social-image/card';
import {
  articleAdmissionPasses,
  articleAdmissionScore,
  articleDaysBetween,
  assertArticleAdmissions,
} from '@hraness/design-kit';

import * as ghostreplyImage from '../app/compare/ghostreply/opengraph-image.tsx';
import * as hermesImage from '../app/compare/hermes-agent/opengraph-image.tsx';
import * as metaAiImage from '../app/compare/meta-ai-whatsapp/opengraph-image.tsx';
import * as openclawImage from '../app/compare/openclaw/opengraph-image.tsx';
import * as hubImage from '../app/compare/opengraph-image.tsx';
import CompareGhostReplyPage, { metadata as ghostreplyMetadata } from '../app/compare/ghostreply/page.tsx';
import CompareHermesPage from '../app/compare/hermes-agent/page.tsx';
import CompareMetaAiPage from '../app/compare/meta-ai-whatsapp/page.tsx';
import CompareOpenClawPage, { metadata as openclawMetadata } from '../app/compare/openclaw/page.tsx';
import CompareHubPage, { metadata as hubMetadata } from '../app/compare/page.tsx';
import {
  COMPARISON_ADMISSIONS,
  comparisonAdmission,
} from '../app/compare/_lib/comparison-admissions.ts';
import {
  COMPARISONS,
  COMPARISONS_CHECKED_ON,
  GHOSTREPLY_CARD,
  HUB_CARD,
  HUB_DESCRIPTION,
  HUB_ENTRIES,
  HUB_PAGE_ENTRIES,
  HUB_QUESTIONS,
  POKE_HUB_ENTRY,
} from '../app/compare/_lib/comparisons.ts';
import { GET as getLlmsText } from '../app/llms.txt/route.ts';
import sitemap from '../app/sitemap.ts';
import nextConfig from '../next.config.ts';
import { SITE_NAME } from '../app/_lib/site.ts';
import { socialSite } from '../app/_lib/social.ts';

const pages = {
  '/compare': CompareHubPage,
  '/compare/openclaw': CompareOpenClawPage,
  '/compare/hermes-agent': CompareHermesPage,
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
  expect(HUB_ENTRIES.map(({ name }) => name)).toEqual(['OpenClaw', 'Hermes Agent', 'Poke', 'Meta AI in WhatsApp', 'GhostReply']);
  expect(HUB_PAGE_ENTRIES.map(({ path }) => path)).toEqual([
    '/compare/openclaw',
    '/compare/hermes-agent',
    '/compare/meta-ai-whatsapp',
    '/compare/ghostreply',
  ]);
  const hub = renderToStaticMarkup(<CompareHubPage />);
  for (const { name, path } of HUB_PAGE_ENTRIES) {
    expect(hub).toContain(`href="${path}"`);
    expect(hub).toContain(`<th scope="row"><a href="${path}">${name}</a></th>`);
  }
  const collection = byType(hub, 'CollectionPage') as { mainEntity: { numberOfItems: number } } | undefined;
  expect(collection?.mainEntity.numberOfItems).toBe(HUB_PAGE_ENTRIES.length);
});

test('Poke is folded into its hub row, question, and sources', async () => {
  const hub = renderToStaticMarkup(<CompareHubPage />);
  expect(hub).toContain('<th scope="row">Poke</th>');
  expect(hub).not.toContain('href="/compare/poke"');
  for (const { href } of POKE_HUB_ENTRY.sources) expect(hub).toContain(`href="${href}"`);
  expect(HUB_QUESTIONS.map(({ question }) => question)).toContain('Does Poke reply to my friends for me?');
  const redirects = await nextConfig.redirects?.() ?? [];
  expect(redirects.find(({ source }) => source === '/compare/poke')).toMatchObject({ destination: '/compare', permanent: true });
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
  }
  for (const description of [HUB_DESCRIPTION, ...COMPARISONS.map((comparison) => comparison.description)]) {
    expect(description.length, description).toBeGreaterThanOrEqual(110);
    expect(description.length, description).toBeLessThanOrEqual(160);
  }
  const routes = [hubImage, ghostreplyImage, openclawImage, hermesImage, metaAiImage];
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
  for (const { path } of HUB_PAGE_ENTRIES) {
    expect(llms).toContain(`(https://textbutler.app${path})`);
    expect(urls).toContain(`https://textbutler.app${path}`);
  }
  expect(llms).toContain('- [TextButler compared with Poke](https://textbutler.app/compare): ');
  expect(llms).not.toContain('https://textbutler.app/compare/poke');
  expect(urls).not.toContain('https://textbutler.app/compare/poke');
  expect(urls).toContain('https://textbutler.app/compare');
  expect(HUB_QUESTIONS.length).toBeGreaterThan(0);
});

test('every comparison URL has a valid admission record', () => {
  expect(() => assertArticleAdmissions(COMPARISON_ADMISSIONS)).not.toThrow();
  expect(COMPARISON_ADMISSIONS.map(({ href }) => href).toSorted()).toEqual([...Object.keys(pages), '/compare/poke'].toSorted());
  for (const admission of COMPARISON_ADMISSIONS) {
    expect(admission.review?.reviewerType, admission.href).toBe('ai');
    expect(admission.review?.reviewedOn, admission.href).toBe(COMPARISONS_CHECKED_ON);
    expect(admission.humanReview, admission.href).toBeNull();
    const days = articleDaysBetween(COMPARISONS_CHECKED_ON as `${number}-${number}-${number}`, admission.reassessOn);
    expect(days, admission.href).toBeGreaterThanOrEqual(28);
    expect(days, admission.href).toBeLessThanOrEqual(56);
    for (const source of admission.sources) expect(source.checkedOn, source.url).toBe(COMPARISONS_CHECKED_ON);
  }
});

// STYLE.md keeps AI-drafting notes to essays and blog posts; comparison pages
// keep their review in the record and carry no drafting note.
test('only pages that pass admission are indexable, and none carries a drafting note', () => {
  for (const [path, Page] of Object.entries(pages)) {
    const admission = comparisonAdmission(path);
    expect(admission.lifecycle, path).toBe('indexable');
    expect(articleAdmissionPasses(admission.scores), path).toBe(true);
    const html = decode(renderToStaticMarkup(<Page />));
    expect(html, path).not.toContain('Drafted with AI');
    expect(html, path).not.toContain(admission.review?.reviewer ?? 'no reviewer');
  }
  const poke = comparisonAdmission('/compare/poke');
  expect(poke.lifecycle).toBe('archived');
  expect(articleAdmissionScore(poke.scores)).toBe(8);
  expect(articleAdmissionPasses(poke.scores)).toBe(false);
});
