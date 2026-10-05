import Link from 'next/link';
import { articleProvenanceSentence } from '@hraness/design-kit';
import { MarketingComparison } from '@hraness/design-kit/react/server';

import { SiteFooter, SiteHeader } from '../../_components/site-chrome';
import { GITHUB_URL, serializeJsonLd } from '../../_lib/site';
import {
  compareBreadcrumbJsonLd,
  comparisonWebPageJsonLd,
  faqJsonLd,
} from '../../_lib/structured-data';
import { comparisonProvenance } from '../_lib/comparison-admissions';
import {
  COMPARISONS_CHECKED_ON,
  TEXTBUTLER_SOURCES,
  type Comparison,
  type Source,
} from '../_lib/comparisons';

export function CheckedOn() {
  return (
    <p className="compare-checked">
      Checked on <time dateTime={COMPARISONS_CHECKED_ON}>{COMPARISONS_CHECKED_ON}</time> against each
      product’s own public pages.
    </p>
  );
}

export function ComparisonReview({ path }: Readonly<{ path: string }>) {
  return <p className="compare-checked">{articleProvenanceSentence(comparisonProvenance(path))}</p>;
}

export function SourceList({ sources }: Readonly<{ sources: readonly Source[] }>) {
  return (
    <ul>
      {sources.map(({ href, label }) => <li key={href}><a href={href}>{label}</a></li>)}
    </ul>
  );
}

export function ComparisonPage({ comparison }: Readonly<{ comparison: Comparison }>) {
  const { name, path } = comparison;
  const jsonLd = [
    comparisonWebPageJsonLd({
      name: comparison.heading,
      description: comparison.description,
      other: { name, url: comparison.officialUrl },
      path,
    }),
    compareBreadcrumbJsonLd(`TextButler and ${name}`, path),
    faqJsonLd(comparison.questions),
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
          <p className="eyebrow"><Link href="/compare">Compare</Link></p>
          <h1>{comparison.heading}</h1>
          <p>{comparison.lede}</p>
          <a href={GITHUB_URL}>View the open-source project</a>
        </header>
        <article className="readme-prose document-prose">
          <h2>How they compare</h2>
          <MarketingComparison
            caption={`TextButler and ${name} at a glance`}
            highlight={0}
            options={[{ name: 'TextButler' }, { name }]}
            rows={comparison.rows}
            note={<>{comparison.note} <a href="#comparison-sources">Sources</a>.</>}
          />
          <CheckedOn />
          <ComparisonReview path={path} />

          <h2>Which one fits</h2>
          <p>{comparison.chooseOther}</p>
          <p>{comparison.chooseTextButler}</p>

          {comparison.sections.map(({ heading, paragraphs }) => (
            <section key={heading}>
              <h2>{heading}</h2>
              {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}

          <h2>Questions</h2>
          {comparison.questions.map(({ answer, question }) => (
            <section key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </section>
          ))}

          <h2 id="comparison-sources">Sources</h2>
          <SourceList sources={[...comparison.sources, ...TEXTBUTLER_SOURCES]} />
          <p>
            Descriptions of {name} come from its public pages; TextButler has no affiliation with it,
            and this page does not test it.
          </p>
        </article>
        <nav className="document-next" aria-label="Learn more">
          <Link href="/compare">All comparisons</Link>
          <Link href="/docs">Read the project docs</Link>
          <Link href="/about">About TextButler</Link>
        </nav>
      </main>
      <SiteFooter path={path} />
    </>
  );
}
