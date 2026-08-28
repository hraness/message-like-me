import Link from 'next/link';

import { SiteFooter, SiteHeader } from '../_components/site-chrome';
import {
  absoluteUrl,
  GITHUB_URL,
  pageMetadata,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_NAME,
} from '../_lib/site';

export const metadata = pageMetadata({
  title: 'About',
  description: `What ${SITE_NAME} is, how its local-first process boundary works, and why every result remains an unsent draft for user review.`,
  path: '/about',
});

const aboutJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  name: `About ${SITE_NAME}`,
  url: absoluteUrl('/about'),
  description: SITE_DESCRIPTION,
  mainEntity: { '@id': `${absoluteUrl('/')}#application` },
  isPartOf: { '@id': `${absoluteUrl('/')}#website` },
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="document-page" id="main-content" tabIndex={-1}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(aboutJsonLd) }}
        />
        <header className="document-hero">
          <p className="eyebrow">About</p>
          <h1>A local evidence layer, not a digital clone.</h1>
          <p>{SITE_DESCRIPTION}</p>
          <a href={GITHUB_URL}>View the open-source project ↗</a>
        </header>
        <section className="about-grid" aria-label="Product boundaries">
          <article>
            <p className="section-number">01 / local</p>
            <h2>The website never receives your messages.</h2>
            <p>The CLI reads stable local copies and keeps its database, metrics, profiles, and drafting context on your machine.</p>
          </article>
          <article>
            <p className="section-number">02 / bounded</p>
            <h2>Evidence stays inspectable.</h2>
            <p>Deterministic measurements and bounded study packets make the basis of a style profile visible instead of hiding it in model weights.</p>
          </article>
          <article>
            <p className="section-number">03 / unsent</p>
            <h2>The user remains the author.</h2>
            <p>Message Like Me produces candidate text for review. It has no command for sending, reacting, scheduling, or operating a messaging account.</p>
          </article>
        </section>
        <section className="about-sources" aria-labelledby="about-sources-title">
          <div>
            <p className="eyebrow">Supported inputs</p>
            <h2 id="about-sources-title">Source-aware by design.</h2>
          </div>
          <div>
            <p>
              Message Like Me reads Apple Messages locally, caller-owned X archive
              DMs, bounded Beeper exports, and native WhatsApp evidence made through
              Wrench. Optional macOS Contacts adds exact local labels. Each source
              retains its own provenance and observability limits.
            </p>
            <Link href="/sources">Compare the source boundaries →</Link>
          </div>
        </section>
        <nav className="document-next" aria-label="Learn more">
          <Link href="/sources">Compare supported sources →</Link>
          <Link href="/methodology">Read the methodology →</Link>
          <Link href="/research">Review the research →</Link>
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}
