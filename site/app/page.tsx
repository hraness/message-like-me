import {
  MarketingCallToAction,
  MarketingFlow,
  MarketingInstallPanel,
  MarketingMaker,
  MarketingPage,
  MarketingPillars,
  MarketingPrimitives,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingSection,
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
  title: 'Message Like Me — Draft messages that sound like you',
  description: SITE_DESCRIPTION,
  path: '/',
});

const HERO_FOOTNOTE =
  `Local-first, drafts only, and free under the MIT license. macOS with Bun 1.3.14 or newer. Version ${SOFTWARE_VERSION}.`;

const HOME_QUESTIONS = [
  {
    question: 'Does the website receive my messages?',
    answer:
      'No. messagelikeme.com is an informational project page. It has no upload, account, message-history, profile, or drafting surface. Everything the CLI reads and writes stays in a private local store on your machine.',
  },
  {
    question: 'Do I need an account or an API key?',
    answer:
      'No. There is no Message Like Me account, sign-in, server, telemetry, or sync. The CLI never calls a model or an AI provider. Drafting happens in the agent you already use, under that agent’s own account and terms.',
  },
  {
    question: 'Can it send or schedule a message?',
    answer:
      'No. Message Like Me has no send, react, schedule, provider-authentication, or messaging-application command. Drafting ends as text on your screen, and you decide what to do with it.',
  },
  {
    question: 'Which sources are supported?',
    answer:
      'Apple Messages, caller-owned X data archives, bounded Beeper and native WhatsApp bundles exported through compatible Wrench releases, and optional macOS Contacts labels. Every path is read-only; Messages, Contacts, archives, and bundles are never changed.',
  },
  {
    question: 'What does it cost?',
    answer:
      'Nothing. Message Like Me is open source under the MIT license. Install the exact public npm package; the same reviewed bytes are mirrored by an immutable GitHub release. The only cost is whatever the agent you draft with already charges you.',
  },
  {
    question: 'Which platforms does it run on?',
    answer:
      `macOS with Bun 1.3.14 or newer. Apple Messages and Contacts are read from the current macOS user’s local databases. Version ${SOFTWARE_VERSION} is the current release.`,
  },
  {
    question: 'Does Message Like Me include an AI model?',
    answer:
      'No. The CLI performs deterministic local ingestion and measurement. Semantic analysis and unsent drafting happen through the agent environment you already chose, using the installed Agent Skill.',
  },
  {
    question: 'Is the result a digital clone?',
    answer:
      'No. The result is revisable evidence for a draft. It does not establish identity, beliefs, intent, consent, or what you would write now. What you mean today always outranks how you wrote before.',
  },
  {
    question: 'Can I use it from TypeScript?',
    answer:
      'Yes. The @hraness/message-like-me package exports the versioned corpus, metrics, study-packet, and profile types plus canonical JSON and SHA-256 helpers, with no filesystem or network work on import.',
  },
  {
    question: 'Who made it?',
    answer:
      'Ben Guo, a musician and builder, formerly a founder and engineering leader at companies including Venmo and Stripe, now building from Puerto Rico. The source is public on GitHub under the MIT license.',
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

function HeroFrame() {
  return (
    <MarketingProofFrame
      caption="A synthetic conversation and transcript. No real messages, contacts, or private paths appear on this site."
      credit={`Synthetic example · v${SOFTWARE_VERSION}`}
      title="Message Like Me · synthetic example"
    >
      <div className="mlm-frame" role="group" aria-label="A synthetic local drafting workflow">
        <div className="message-stage">
          <p className="stage-label">Synthetic example</p>
          <div className="bubble bubble-in">yes to friday. also can you send me that link?</div>
          <div className="bubble bubble-out">perfect, friday it is</div>
          <div className="bubble bubble-out bubble-short">yep one sec</div>
        </div>
        <div className="terminal-card">
          <p>
            <span>$</span>{' '}wrench whatsapp export-message-like-me --auth whatsapp-main --output &quot;$HOME/message-like-me-whatsapp&quot;
          </p>
          <p className="terminal-result">✓ compatible Wrench bundle written</p>
          <p>
            <span>$</span>{' '}messagelikeme ingest bundle --input &quot;$HOME/message-like-me-whatsapp&quot;
          </p>
          <p className="terminal-result">✓ verified source observation ingested</p>
        </div>
      </div>
    </MarketingProofFrame>
  );
}

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqStructuredData) }}
        />

        <MarketingPage className="mlm-page">
          <ProductHero
            actions={[
              { href: '#install', label: `Install v${SOFTWARE_VERSION}` },
              { href: '#how-it-works', label: 'See how it works' },
            ]}
            boundary={HERO_FOOTNOTE}
            className="mlm-marketing-hero"
            example="Ask your agent to draft a reply about Friday plans that reads the way you actually text that friend."
            eyebrow="A local-first CLI and Agent Skill"
            frame={<HeroFrame />}
            heading="Draft messages that sound like you"
            headingId="message-like-me-title"
            name="Message Like Me"
            summary="Message Like Me studies how you actually text one person, then hands your agent an evidence profile for an unsent draft. It reads local history and never sends."
          />

          <MarketingPillars
            ariaLabel="Message Like Me in three points"
            pillars={[
              {
                label: 'Ingest',
                summary: 'Read Apple Messages, an X archive, or a Beeper or WhatsApp bundle from Wrench without changing any of them.',
              },
              {
                label: 'Understand',
                summary: 'Measure how you write to one person: word choice, timing, bubble shape, and how you answer several things at once.',
              },
              {
                label: 'Draft',
                summary: 'Hand your agent the evidence and get an unsent draft back. You decide what, if anything, gets sent.',
              },
            ]}
          />

          <MarketingSection
            heading="Your history comes in from the apps you already use."
            headingId="sources-title"
            id="sources"
            label="Supported sources"
            summary="Four messaging-history inputs and one optional label source. Beeper and native WhatsApp arrive as explicit Wrench bundle paths, never as hidden account connections or sending integrations."
          >
            <div className="source-grid">
              {SUPPORTED_SOURCES.map((source) => (
                <SourceCard key={source.id} source={source} />
              ))}
            </div>
            <p className="mlm-section-link">
              <Link href="/sources">Compare every source and its limits</Link>
            </p>
          </MarketingSection>

          <MarketingSection
            heading="The CLI measures. Your agent writes."
            headingId="how-it-works-title"
            id="how-it-works"
            label="How it works"
            layout="split"
            summary="Every step is one command with a JSON form. The CLI never calls a model; the skill you install teaches the agent you already use how to read the evidence and where to stop."
          >
            <MarketingFlow
              ariaLabel="From history to an unsent draft"
              steps={[
                {
                  code: 'messagelikeme ingest imessage --json',
                  detail: 'Read a stable copy of Apple Messages, or bring an X archive or a Wrench bundle. Nothing in the source changes.',
                  label: 'Ingest',
                },
                {
                  code: 'messagelikeme inspect tempo <contact-id> --json',
                  detail: 'See counts, timing, bursts, and reply habits for one person under pseudonymous IDs, with no message text.',
                  label: 'Understand',
                },
                {
                  code: 'messagelikeme study prepare <contact-id> --output /absolute/private/study.json --json',
                  detail: 'Write one evidence packet with real excerpts to a path you name, readable only by you.',
                  label: 'Prepare',
                },
                {
                  code: 'Use $message-like-me in your agent',
                  detail: 'Your agent reads the packet, keeps what is uncertain uncertain, and stops at a draft you can edit or discard.',
                  label: 'Draft',
                },
              ]}
            />
          </MarketingSection>

          <MarketingPrimitives
            heading="Voice has a rhythm."
            headingId="evidence-title"
            id="evidence"
            items={[
              { label: 'Prose', summary: 'Case, punctuation, vocabulary, warmth, humor, and uncertainty.' },
              { label: 'Tempo', summary: 'Response latency, turns, bursts, and where a conversation pauses.' },
              { label: 'Shape', summary: 'One long message versus several deliberate bubbles.' },
              { label: 'Context', summary: 'What changes across play, planning, support, conflict, and reflection.' },
              { label: 'Coverage', summary: 'How several incoming questions or emotional beats get resolved.' },
              { label: 'Replies', summary: 'When explicit reply links clarify a dense or delayed thread.' },
            ]}
            label="The evidence profile"
            summary="Word choice matters. So do the pauses, the bursts, the afterthought, and the decision to answer three things in one message or three."
          />

          <MarketingSection
            className="mlm-contrast-section"
            heading="Evidence for a draft."
            headingId="what-it-is-title"
            id="what-it-is"
            label="What it is"
            layout="split"
            summary="Message Like Me measures your outgoing prose and reply shape for one person across the sources you import, then gives your agent a profile it can cite line by line."
          >
            <div className="mlm-contrast">
              <p className="mlm-contrast__label">What it is not</p>
              <h3 className="mlm-contrast__heading">Not a model of you.</h3>
              <p>
                It does not train a model, represent your identity, predict your
                beliefs, or send a message. What you mean now always outranks how
                you wrote before.
              </p>
              <p className="mlm-section-link">
                <Link href="/research">Read the research review</Link>
              </p>
            </div>
          </MarketingSection>

          <MarketingTrustBoundary
            className="mlm-marketing-trust"
            heading="Your history is evidence, not inventory."
            headingId="privacy-title"
            id="privacy"
            items={[
              {
                label: 'It stays on your machine',
                detail: 'Imported history, measurements, and profiles live in a private local data root with owner-only permissions.',
              },
              {
                label: 'Everyday output has no prose',
                detail: 'Ordinary commands report counts and timing under pseudonymous IDs. They omit message bodies, handles, and contact names.',
              },
              {
                label: 'You choose what an agent sees',
                detail: 'A study packet holds real excerpts. It reaches an agent only when you write it to a path you name and open it in an environment you trust.',
              },
              {
                label: 'No account, server, or model',
                detail: 'There is no Message Like Me account, server, AI-provider call, telemetry, or sync. This website is an informational page.',
              },
              {
                label: 'Nothing sends',
                detail: 'Drafting ends as text on your screen. There is no command that sends, reacts, schedules, or operates a messaging app.',
              },
            ]}
            label="Your data"
            summary="Local-first describes where the work happens, not a promise of secrecy. Here is what stays where, in plain words."
          />

          <MarketingInstallPanel
            className="mlm-marketing-install"
            eyebrow={`Install v${SOFTWARE_VERSION}`}
            heading="Start with an empty store."
            headingId="install-title"
            id="install"
          >
            <ol className="command-stack" aria-label="Installation and first-check commands">
              <li><code>bun add --global @hraness/message-like-me@{SOFTWARE_VERSION}</code></li>
              <li><code>messagelikeme skill install</code></li>
              <li><code>messagelikeme init</code></li>
              <li><code>messagelikeme doctor --json</code></li>
            </ol>
            <p className="mlm-install-note">
              The first check imports no history. It reports where Message Like Me
              will work and whether its private store is healthy, before you choose
              a source. Requires Bun 1.3.14 or newer.
              {' '}<a href={RELEASE_URL}>Inspect the release on GitHub</a>
            </p>
          </MarketingInstallPanel>

          <MarketingQuestionList
            className="mlm-marketing-questions"
            heading="Before you install."
            headingId="questions-title"
            id="questions"
            label="Questions"
            questions={HOME_QUESTIONS.map(({ answer, question }) => ({
              answer: <p>{answer}</p>,
              question,
            }))}
          />

          <MarketingMaker
            heading="Built by Ben Guo"
            headingId="maker-title"
            id="maker"
            label="Built by"
            links={[
              { href: 'https://hraness.com', label: 'hraness.com' },
              { href: 'https://x.com/hraness', label: '@hraness' },
              { href: GITHUB_URL, label: 'GitHub' },
            ]}
          >
            <p>
              Message Like Me is built by Ben Guo, a musician and builder, formerly a
              founder and engineering leader at companies including Venmo and Stripe,
              now building from Puerto Rico. The source, the method, and the research
              review are public.
            </p>
          </MarketingMaker>

          <MarketingCallToAction
            actions={[
              { href: '#install', label: `Install v${SOFTWARE_VERSION}` },
              { href: '/docs', label: 'Read the docs' },
            ]}
            className="mlm-marketing-cta"
            footnote={HERO_FOOTNOTE}
            heading="Draft with an agent. Sound like you."
            headingId="closing-title"
            id="closing"
            summary="Install the CLI, import one source, and hand your agent the evidence. Every draft stays on your screen until you decide."
          />
        </MarketingPage>
      </main>
      <SiteFooter path="/" />
    </>
  );
}
