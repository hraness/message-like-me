import { breadcrumbJsonLd, type BreadcrumbStep, type SearchSite } from '@hraness/web-discovery';

import {
  absoluteUrl,
  type CanonicalPagePath,
  PAGE_LAST_MODIFIED,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_TITLE,
} from './site';

// Stable node identifiers shared by the site-wide graph in app/layout.tsx and
// page-level JSON-LD, so a page can point at the one TextButler application.
export const WEBSITE_ID = `${absoluteUrl('/')}#website`;
export const APPLICATION_ID = `${absoluteUrl('/')}#application`;
export const ORGANIZATION_ID = 'https://hraness.com/#organization';

export const SEARCH_SITE: SearchSite = {
  name: SITE_NAME,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  origin: SITE_ORIGIN as `https://${string}`,
  language: 'en-US',
  locale: 'en_US',
};

export type Question = Readonly<{ question: string; answer: string }>;

// FAQPage JSON-LD mirrors questions that are visible on the same page.
export function faqJsonLd(questions: readonly Question[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ answer, question }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  } as const;
}

export const COMPARE_BREADCRUMB: readonly BreadcrumbStep[] = [
  { name: SITE_NAME, path: '/' },
  { name: 'Compare', path: '/compare' },
];

export function compareBreadcrumbJsonLd(name: string, path: CanonicalPagePath) {
  return breadcrumbJsonLd(SEARCH_SITE.origin, [...COMPARE_BREADCRUMB, { name, path }]);
}

// One comparison page: a WebPage about TextButler that mentions the other
// product by its official URL only. Facts about the other product stay in
// the visible, sourced page text.
export function comparisonWebPageJsonLd({
  description,
  name,
  other,
  path,
}: Readonly<{
  description: string;
  name: string;
  other: Readonly<{ name: string; url: string }>;
  path: CanonicalPagePath;
}>) {
  const url = absoluteUrl(path);
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: 'en-US',
    dateModified: PAGE_LAST_MODIFIED[path as keyof typeof PAGE_LAST_MODIFIED],
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': APPLICATION_ID },
    mentions: [{ '@type': 'SoftwareApplication', name: other.name, url: other.url }],
  } as const;
}
