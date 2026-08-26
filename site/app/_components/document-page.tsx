import { absoluteUrl, serializeJsonLd, SITE_NAME } from '../_lib/site';
import { SiteFooter, SiteHeader } from './site-chrome';

export function DocumentPage({
  eyebrow,
  title,
  summary,
  path,
  html,
  sourceUrl,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  path: string;
  html: string;
  sourceUrl: string;
}) {
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title,
    description: summary,
    url: absoluteUrl(path),
    inLanguage: 'en-US',
    dateModified: '2026-08-26',
    author: {
      '@type': 'Organization',
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
    isPartOf: {
      '@type': 'WebSite',
      '@id': `${absoluteUrl('/')}#website`,
    },
  };

  return (
    <>
      <SiteHeader />
      <main className="document-page" id="main-content" tabIndex={-1}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }}
        />
        <header className="document-hero">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{summary}</p>
          <a href={sourceUrl}>View the checked source ↗</a>
        </header>
        <article
          className="readme-prose document-prose"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
      <SiteFooter />
    </>
  );
}
