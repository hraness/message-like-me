import {
  MarketingCallToAction,
  MarketingFlow,
  MarketingInstallPanel,
  MarketingInterfaceGrid,
  MarketingQuestionList,
  MarketingTrustBoundary,
  ProductHero,
} from '@hraness/design-kit/react/server';
import Link from 'next/link';

import { SiteFooter, SiteHeader } from './_components/site-chrome';
import { SourceCard } from './_components/source-card';
import { SUPPORTED_SOURCES } from './_lib/sources';
import {
  GITHUB_URL,
  pageMetadata,
  RELEASE_URL,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SOFTWARE_VERSION,
} from './_lib/site';

export const metadata = pageMetadata({
  title: 'Message Like Me — Study how you message',
  description: SITE_DESCRIPTION,
  path: '/',
});

const HOME_QUESTIONS = [
  {
    question: 'Does the website receive my messages?',
    answer:
      'No. messagelikeme.com is an informational project page. It has no upload, account, message-history, profile, or drafting surface.',
  },
  {
    question: 'Does Message Like Me include an AI model?',
    answer:
      'No. The CLI performs deterministic local ingestion and measurement. Semantic analysis and unsent drafting happen through the agent environment you already chose.',
  },
  {
    question: 'Can it send or schedule a message?',
    answer:
      'No. Message Like Me has no send, react, schedule, provider-authentication, or messaging-application command. Drafting ends as text.',
  },
  {
    question: 'Which sources are supported?',
    answer:
      'Apple Messages, caller-owned X data archives, bounded Beeper and native WhatsApp bundles exported through compatible Wrench releases, and optional macOS Contacts labels.',
  },
  {
    question: 'Is the result a digital clone?',
    answer:
      'No. The result is bounded, revisable evidence for a draft. It does not establish identity, beliefs, intent, consent, or what you would write now.',
  },
  {
    question: 'Can I verify the local boundary before importing history?',
    answer:
      'Yes. Run messagelikeme init and messagelikeme doctor --json. The result reports local paths and store integrity without reading a message body, contact, account, or provider credential.',
  },
] as const;

const faqStructuredData = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: HOME_QUESTIONS.map(({ answer, question }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: answer,
    },
  })),
};

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqStructuredData) }}
        />

        <ProductHero
          actions={[
            { href: '#install', label: `Install v${SOFTWARE_VERSION}` },
            { href: '#how-it-works', label: 'See the working model' },
          ]}
          boundary="macOS sources · local CLI · bring your own agent · drafts only"
          className="mlm-marketing-hero"
          eyebrow="Local messaging evidence"
          facts={[
            { detail: 'Messages, X, Beeper, and WhatsApp.', label: 'History inputs', value: '4 bounded sources' },
            { detail: 'Contacts enrich labels; they are not message history.', label: 'Local context', value: '1 optional source' },
            { detail: 'Human, agent, and typed integration surfaces.', label: 'Interfaces', value: 'CLI + Skill + library' },
            { detail: 'No send, react, schedule, account, or product server.', label: 'Final boundary', value: 'Unsent text' },
          ]}
          heading="Study how you message. Draft without giving up control."
          headingId="message-like-me-title"
          name="Message Like Me"
          proof={{
            content: (
              <MarketingFlow
                ariaLabel="Message Like Me working model"
                steps={[
                  {
                    code: 'messagelikeme ingest imessage --json',
                    detail: 'Read an ownership-checked stable copy without changing Messages.',
                    label: 'Ingest',
                  },
                  {
                    code: 'messagelikeme inspect tempo <contact-id> --json',
                    detail: 'Inspect pseudonymous counts and timing without exposing prose.',
                    label: 'Measure',
                  },
                  {
                    code: 'messagelikeme study prepare <contact-id> --output /absolute/private/study.json --json',
                    detail: 'Write one bounded, mode-0600 evidence packet to a path you name.',
                    label: 'Prepare',
                  },
                  {
                    code: 'Use $message-like-me in your agent',
                    detail: 'Interpret the packet and stop at an inspectable, unsent draft.',
                    label: 'Draft',
                  },
                ]}
              />
            ),
            heading: 'One source-to-draft path, with every boundary visible.',
            kicker: 'Working model',
          }}
          summary={SITE_DESCRIPTION}
        />

        <MarketingInstallPanel
          className="mlm-marketing-install"
          eyebrow={`Install v${SOFTWARE_VERSION}`}
          heading="Prove the local boundary first."
          headingId="message-like-me-install-title"
          id="install"
        >
          <div className="command-stack" aria-label="Installation and first-proof commands">
            <p><span>1</span><code>bun add --global github:hraness/message-like-me#v{SOFTWARE_VERSION}</code></p>
            <p><span>2</span><code>messagelikeme skill install</code></p>
            <p><span>3</span><code>messagelikeme init</code></p>
            <p><span>4</span><code>messagelikeme doctor --json</code></p>
          </div>
          <p className="mlm-install-note">
            The first check imports no history. It reports initialized local paths and store integrity.
            {' '}<a href={RELEASE_URL}>Inspect the immutable release ↗</a>
          </p>
        </MarketingInstallPanel>

        <section className="sources-section" aria-labelledby="sources-title">
          <div className="sources-heading">
            <div>
              <p className="eyebrow">Supported sources</p>
              <h2 id="sources-title">History in. Evidence out.</h2>
            </div>
            <div>
              <p>
                Four bounded messaging-history inputs and one optional local label
                source. Beeper and native WhatsApp support use explicit Wrench bundle
                paths, never hidden account connections or sending integrations.
              </p>
              <Link href="/sources">Compare every source and boundary →</Link>
            </div>
          </div>
          <div className="source-grid">
            {SUPPORTED_SOURCES.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </section>

        <section className="process-section" id="how-it-works" aria-labelledby="process-title">
          <div className="section-heading">
            <p className="eyebrow">How it works</p>
            <h2 id="process-title">The CLI owns evidence. Your agent owns interpretation.</h2>
          </div>
          <div className="process-grid">
            <article>
              <p className="section-number">01 / ingest</p>
              <h3>Read stable local copies.</h3>
              <p>
                Import Apple Messages or a caller-owned X archive, optionally add
                macOS Contacts labels, or ingest a private Beeper or native WhatsApp
                bundle exported by a compatible Wrench release.
              </p>
              <code>messagelikeme ingest bundle --input /absolute/private/bundle --json</code>
            </article>
            <article>
              <p className="section-number">02 / measure</p>
              <h3>Make behavior observable.</h3>
              <p>
                Inspect prose features, response tempo, bubble sequences, multiple
                incoming points, reactions, and explicit reply use.
              </p>
              <code>messagelikeme inspect tempo &lt;contact-id&gt; --json</code>
            </article>
            <article>
              <p className="section-number">03 / interpret</p>
              <h3>Give bounded evidence to your agent.</h3>
              <p>
                Open only an explicit study packet in an agent environment you chose,
                retain uncertainty, and produce an inspectable draft.
              </p>
              <code>messagelikeme study prepare &lt;contact-id&gt; --output /absolute/private/study.json --json</code>
            </article>
          </div>
        </section>

        <section className="analysis-section" aria-labelledby="analysis-title">
          <div className="analysis-intro">
            <p className="eyebrow">Relationship-aware evidence</p>
            <h2 id="analysis-title">Voice has a rhythm.</h2>
            <p>
              Word choice matters. So do the pauses, the bursts, the afterthought,
              and the decision to answer three things in one message or three.
            </p>
          </div>
          <dl className="signal-grid">
            <div><dt>Prose</dt><dd>Case, punctuation, vocabulary, warmth, humor, and uncertainty.</dd></div>
            <div><dt>Tempo</dt><dd>Response latency, turns, bursts, and session boundaries.</dd></div>
            <div><dt>Shape</dt><dd>One long message versus several deliberate bubbles.</dd></div>
            <div><dt>Context</dt><dd>What changes across play, planning, support, conflict, and reflection.</dd></div>
            <div><dt>Coverage</dt><dd>How several incoming questions or emotional beats get resolved.</dd></div>
            <div><dt>Replies</dt><dd>When explicit reply links clarify a dense or delayed thread.</dd></div>
          </dl>
        </section>

        <MarketingInterfaceGrid
          className="mlm-marketing-interfaces"
          heading="One evidence model, three deliberate surfaces."
          headingId="message-like-me-interfaces-title"
          id="interfaces"
          interfaces={[
            {
              example: <pre><code>messagelikeme inspect tempo &lt;contact-id&gt; --json</code></pre>,
              label: 'CLI',
              summary: 'Own read-only ingestion, deterministic measurement, private artifacts, validation, and redacted machine-readable output.',
            },
            {
              example: <pre><code>Use $message-like-me in your agent</code></pre>,
              label: 'Agent Skill',
              summary: 'Interpret an explicit bounded packet, preserve uncertainty, and draft without adding a model or provider to the CLI.',
            },
            {
              example: <pre><code>{'import { canonicalJson, sha256 } from "@hraness/message-like-me"'}</code></pre>,
              label: 'TypeScript library',
              summary: 'Use versioned public types, strict bundle parsers, canonical JSON, digest helpers, and pure packet builders without filesystem or network work on import.',
            },
          ]}
          label="Interfaces"
          summary="The artifact is the seam. Deterministic code produces it; an authorized agent may interpret it; typed consumers can verify it."
        />

        <section className="boundary-section" aria-label="Product interpretation boundary">
          <div>
            <p className="eyebrow">What it is</p>
            <h2>Evidence for a draft.</h2>
            <p>
              Message Like Me measures your outgoing prose and response shape for
              one person across imported services, then gives your agent a
              bounded, inspectable profile.
            </p>
          </div>
          <div>
            <p className="eyebrow">What it is not</p>
            <h2>Not a model of you.</h2>
            <p>
              It does not train a model, represent your identity, predict your
              beliefs, or decide what you mean now. Current facts and intent always
              outrank historical style.
            </p>
            <Link href="/research">Read the research review →</Link>
          </div>
        </section>

        <MarketingTrustBoundary
          className="mlm-marketing-trust"
          heading="Private history crosses only boundaries you can name."
          headingId="message-like-me-trust-title"
          id="privacy"
          items={[
            { label: 'Source access', detail: 'The CLI reads ownership-checked stable copies. It does not modify Messages, Contacts, archives, bundles, or sidecars.' },
            { label: 'Ordinary output', detail: 'Aggregate commands use pseudonymous IDs and omit message bodies, handles, contact names, and group titles.' },
            { label: 'Explicit packets', detail: 'Only study, Ensoul, evaluation, and handoff preparation may write bounded bodies outside the private store, to owner-selected mode-0600 paths.' },
            { label: 'Agent boundary', detail: 'A packet reaches an agent only when you deliberately open it in an environment you authorize.' },
            { label: 'Product network', detail: 'The CLI has no Message Like Me account, server, AI-provider call, authentication, telemetry, synchronization, or sending integration.' },
            { label: 'Final action', detail: 'Drafting ends as visible text. Nothing sends, reacts, schedules, or operates a messaging application.' },
          ]}
          label="Trust boundary"
          summary="Local-first is a process boundary, not a magical secrecy claim. The site, CLI, explicit artifacts, and your chosen agent each have a distinct role."
        />

        <section className="readme-section" id="readme" aria-labelledby="readme-title">
          <div className="readme-heading">
            <p className="eyebrow">Checked documentation</p>
            <h2 id="readme-title">Inspect the product boundary.</h2>
            <a href={`${GITHUB_URL}#readme`}>Browse the repository ↗</a>
          </div>
          <div className="docs-grid">
            <article>
              <p className="section-number">01 / use</p>
              <h3>Complete documentation</h3>
              <p>Install, ingest, inspect, study, evaluate, and draft with the checked README rendered on-site.</p>
              <Link href="/docs">Read the docs →</Link>
            </article>
            <article>
              <p className="section-number">02 / method</p>
              <h3>How evidence is measured</h3>
              <p>See the local data boundary, deterministic metrics, bounded study method, and explicit limits.</p>
              <Link href="/methodology">Read the methodology →</Link>
            </article>
            <article>
              <p className="section-number">03 / evidence</p>
              <h3>Research and prior art</h3>
              <p>Review the primary research, neighboring open-source projects, and claims this tool does not make.</p>
              <Link href="/research">Read the research →</Link>
            </article>
          </div>
        </section>

        <MarketingQuestionList
          className="mlm-marketing-questions"
          heading="The boundary, in plain language."
          headingId="message-like-me-questions-title"
          id="questions"
          label="Questions"
          questions={HOME_QUESTIONS.map(({ answer, question }) => ({
            answer: <p>{answer}</p>,
            question,
          }))}
          summary="The important questions are about data movement, interpretation, and authority—not an abstract privacy label."
        />

        <MarketingCallToAction
          actions={[
            { href: '#install', label: `Install v${SOFTWARE_VERSION}` },
            { href: '/docs', label: 'Read the checked docs' },
          ]}
          className="mlm-marketing-cta"
          eyebrow="Start without private data"
          heading="Prove the boundary. Then choose the evidence."
          headingId="message-like-me-cta-title"
          summary="Initialize an empty local store and inspect its exact state before Message Like Me reads a message source."
        />
      </main>
      <SiteFooter path="/" />
    </>
  );
}
