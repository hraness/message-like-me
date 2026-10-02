import Link from 'next/link';
import { collectionPageJsonLd } from '@hraness/web-discovery';

import { SiteFooter, SiteHeader } from '../_components/site-chrome';
import { absoluteUrl, GITHUB_URL, pageMetadata, PAGE_LAST_MODIFIED, serializeJsonLd } from '../_lib/site';
import { socialImageAltFor } from '../_lib/social';
import { COMPARE_BREADCRUMB, faqJsonLd, SEARCH_SITE } from '../_lib/structured-data';
import { CheckedOn } from './_components/comparison-page';
import {
  HUB_CARD,
  HUB_DESCRIPTION,
  HUB_ENTRIES,
  HUB_FRAMING,
  HUB_QUESTIONS,
  HUB_TITLE,
  TEXTBUTLER_HUB,
  type HubSummary,
} from './_lib/comparisons';

export const metadata = pageMetadata({
  title: HUB_TITLE,
  description: HUB_DESCRIPTION,
  path: '/compare',
  image: { path: '/compare/opengraph-image', alt: socialImageAltFor(HUB_CARD) },
});

const HUB_COLUMNS: readonly Readonly<{ label: string; key: keyof HubSummary }>[] = [
  { label: 'What you talk to', key: 'youTalkTo' },
  { label: 'Who it answers', key: 'answers' },
  { label: 'Runs on', key: 'runsOn' },
  { label: 'Price', key: 'price' },
  { label: 'Marks replies as AI', key: 'disclosure' },
];

export default function ComparePage() {
  const jsonLd = [
    collectionPageJsonLd(SEARCH_SITE, {
      path: '/compare',
      name: 'TextButler compared with other AI assistants you can text',
      description: HUB_DESCRIPTION,
      dateModified: PAGE_LAST_MODIFIED['/compare'],
      breadcrumb: COMPARE_BREADCRUMB,
      items: HUB_ENTRIES.map(({ name, path }) => ({
        name: `TextButler and ${name}`,
        url: absoluteUrl(path) as `https://${string}`,
      })),
    }),
    faqJsonLd(HUB_QUESTIONS),
  ];
  return (
    <>
      <SiteHeader />
      <main className="document-page" id="main-content" tabIndex={-1}>
        {jsonLd.map((data) => (
          <script
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
            key={data['@type']}
            type="application/ld+json"
          />
        ))}
        <header className="document-hero">
          <p className="eyebrow">Compare</p>
          <h1>TextButler compared with other AI assistants you can text</h1>
          <p>{HUB_FRAMING}</p>
          <a href={GITHUB_URL}>View the open-source project</a>
        </header>
        <article className="readme-prose document-prose">
          <h2>At a glance</h2>
          <div aria-label="TextButler and other assistants you can text" className="compare-hub-table" role="region" tabIndex={0}>
            <table aria-label="TextButler and other assistants you can text">
              <thead>
                <tr>
                  <td />
                  {HUB_COLUMNS.map(({ key, label }) => <th key={key} scope="col">{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {[{ name: 'TextButler', path: undefined, hub: TEXTBUTLER_HUB }, ...HUB_ENTRIES].map(({ hub, name, path }) => (
                  <tr data-highlight={path === undefined ? '' : undefined} key={name}>
                    <th scope="row">{path === undefined ? name : <Link href={path}>{name}</Link>}</th>
                    {HUB_COLUMNS.map(({ key }) => <td key={key}>{hub[key]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="compare-checked">Each comparison page lists the sources behind its row.</p>
          <CheckedOn />

          <h2>Comparisons</h2>
          <ul>
            {HUB_ENTRIES.map(({ hubLine, name, path }) => (
              <li key={path}>
                <Link href={path}>TextButler and {name}</Link>: {hubLine}
              </li>
            ))}
          </ul>

          <h2>Questions</h2>
          {HUB_QUESTIONS.map(({ answer, question }) => (
            <section key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </section>
          ))}
          <p>
            Descriptions of other products come from their public pages. TextButler has no
            affiliation with them, and these pages do not test them.
          </p>
        </article>
        <nav className="document-next" aria-label="Learn more">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/docs">Read the project docs</Link>
          <Link href="/about">About TextButler</Link>
        </nav>
      </main>
      <SiteFooter path="/compare" />
    </>
  );
}
