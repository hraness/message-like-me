import Link from 'next/link';

import { SiteFooter, SiteHeader } from '../_components/site-chrome';
import { SourceCard } from '../_components/source-card';
import {
  BEEPER_COMPATIBILITY,
  MESSAGING_HISTORY_SOURCES,
  SUPPORTED_SOURCES,
} from '../_lib/sources';
import {
  GITHUB_URL,
  pageMetadata,
  SOFTWARE_VERSION,
} from '../_lib/site';

export const metadata = pageMetadata({
  title: 'Supported sources',
  description:
    'The exact Apple Messages, X archive, Beeper via Wrench, and macOS Contacts inputs supported by Message Like Me.',
  path: '/sources',
});

const beeperProducerSummary =
  `Verified producer Wrench v${BEEPER_COMPATIBILITY.producerVersion} calls ` +
  `its pinned official Beeper CLI v${BEEPER_COMPATIBILITY.providerCliVersion} ` +
  'and publishes a bounded, digest-bound local directory.';

export default function SourcesPage() {
  return (
    <>
      <SiteHeader />
      <main className="document-page sources-page" id="main-content" tabIndex={-1}>
        <header className="document-hero sources-hero">
          <p className="eyebrow">Supported sources</p>
          <h1>Know exactly what enters the evidence.</h1>
          <p>
            Message Like Me supports {MESSAGING_HISTORY_SOURCES.length} messaging-history
            inputs and one optional Contacts enrichment source. The messaging inputs
            normalize into one private local corpus; Contacts adds exact labels in the
            same private local store. Every path is read-only and bounded by its source contract.
          </p>
        </header>

        <section className="source-directory" aria-labelledby="source-directory-title">
          <div className="section-heading">
            <p className="eyebrow">Current support in v{SOFTWARE_VERSION}</p>
            <h2 id="source-directory-title">The source is part of the evidence.</h2>
            <p>
              These labels describe observed inputs—not account connections, complete
              histories, or permission to operate a messaging service.
            </p>
          </div>
          <div className="source-grid source-grid-full">
            {SUPPORTED_SOURCES.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </section>

        <section className="beeper-workflow" aria-labelledby="beeper-workflow-title">
          <div className="beeper-workflow-intro">
            <p className="eyebrow">Beeper via Wrench</p>
            <h2 id="beeper-workflow-title">One exporter. One verifier. No hidden handoff.</h2>
            <p>
              Wrench handles the bounded provider observation. Message Like Me handles
              strict local verification, normalization, measurement, and drafts-only
              evidence. The two tools do not share credentials or a live session.
            </p>
          </div>
          <ol className="workflow-steps">
            <li>
              <span aria-hidden="true">01</span>
              <div>
                <h3>Wrench writes the private bundle.</h3>
                <p>{beeperProducerSummary}</p>
                <code className="workflow-command">wrench beeper export-message-like-me --auth &lt;id&gt; --output /absolute/private/path/beeper-bundle</code>
              </div>
            </li>
            <li>
              <span aria-hidden="true">02</span>
              <div>
                <h3>Message Like Me verifies before ingest.</h3>
                <p>
                  It accepts bundle schema {BEEPER_COMPATIBILITY.bundleSchemaVersion}, source{' '}
                  <code>{BEEPER_COMPATIBILITY.sourceId}</code>, and transform{' '}
                  <code>{BEEPER_COMPATIBILITY.sourceTransformVersion}</code>. Package age
                  never overrides those manifest coordinates.
                </p>
                <code className="workflow-command">messagelikeme ingest bundle --input &lt;private-directory&gt;</code>
              </div>
            </li>
          </ol>
          <aside className="beeper-boundary" aria-label="Beeper operation boundary">
            <strong>What this does not mean:</strong> Wrench exposes additional bounded
            Beeper operations, including mutations behind its own controls. Message Like
            Me invokes none of them. It has no Beeper authentication, live API, account
            operation, send, react, or schedule command.
          </aside>
          <div className="source-links">
            <a href="https://wrench.rip/providers/beeper/">Inspect Wrench’s Beeper surface ↗</a>
            <a href={`${GITHUB_URL}/blob/v${SOFTWARE_VERSION}/docs/local-message-bundle-v1.md`}>Read the versioned bundle contract ↗</a>
            <Link href="/docs">Open Message Like Me docs →</Link>
          </div>
        </section>

        <section className="source-privacy" aria-labelledby="source-privacy-title">
          <p className="eyebrow">Local is a process boundary</p>
          <h2 id="source-privacy-title">You choose when an agent sees a packet.</h2>
          <p>
            Deterministic storage and measurement stay in Message Like Me’s private local
            data root. A study packet leaves that root only at an explicit path. Opening
            one makes its bounded excerpts visible to the agent environment you chose;
            the CLI cannot make a hosted agent local.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
