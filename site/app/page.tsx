import Link from 'next/link';

import { SiteFooter, SiteHeader } from './_components/site-chrome';
import { SourceCard } from './_components/source-card';
import { SUPPORTED_SOURCES } from './_lib/sources';
import {
  GITHUB_URL,
  pageMetadata,
  RELEASE_URL,
  SITE_DESCRIPTION,
  SOFTWARE_VERSION,
} from './_lib/site';

export const metadata = pageMetadata({
  title: 'Message Like Me — Study how you message',
  description: SITE_DESCRIPTION,
  path: '/',
});

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Local-first · drafts only · macOS</p>
          <h1>
            Study the evidence. <em>Draft in your voice.</em>
          </h1>
          <p className="lede">
            A local-first CLI and Agent Skill for studying private messaging
            history and drafting messages that sound like you. It reads Apple
            Messages, caller-owned X archives, bounded Beeper exports, and
            native WhatsApp evidence exported through Wrench.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#install">
              Install v{SOFTWARE_VERSION} <span aria-hidden="true">↓</span>
            </a>
            <Link className="button button-secondary" href="/sources">
              See supported sources <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ul className="signal-list" aria-label="Style signals analyzed">
            <li>prose</li>
            <li>tempo</li>
            <li>bubble rhythm</li>
            <li>reply habits</li>
          </ul>
        </div>

        <div className="hero-visual" aria-label="A local Message Like Me workflow">
          <div className="privacy-stamp">
            <span className="privacy-dot" />
            no product server
          </div>
          <div className="message-stage">
            <p className="stage-label">synthetic example</p>
            <div className="bubble bubble-in">
              yes to friday. also can you send me that link?
            </div>
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
      </section>

      <section className="promise-strip" aria-label="Product promises">
        <p><strong>Read-only ingest.</strong> Stable copies, never source mutation.</p>
        <p><strong>Bring your own agent.</strong> The CLI has no model integration.</p>
        <p><strong>Drafts only.</strong> Nothing sends, reacts, or schedules.</p>
      </section>

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

      <section className="process-section" id="how-it-works">
        <div className="section-heading">
          <p className="eyebrow">How it works</p>
          <h2>Study the shape, not just the words.</h2>
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
            <code>messagelikeme ingest bundle --input &quot;$HOME/message-like-me-whatsapp&quot;</code>
          </article>
          <article>
            <p className="section-number">02 / understand</p>
            <h3>Measure the conversation.</h3>
            <p>
              Inspect prose, response tempo, bubble sequences, multiple
              incoming points, and explicit reply use.
            </p>
            <code>messagelikeme inspect tempo &lt;id&gt;</code>
          </article>
          <article>
            <p className="section-number">03 / draft</p>
            <h3>Give evidence to your agent.</h3>
            <p>
              Install the bundled Agent Skill and produce contact-aware,
              unsent drafts through the agent you already use.
            </p>
            <code>messagelikeme skill install</code>
          </article>
        </div>
      </section>

      <section className="analysis-section">
        <div className="analysis-intro">
          <p className="eyebrow">A relationship-aware evidence profile</p>
          <h2>Voice has a rhythm.</h2>
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

      <section className="boundary-section">
        <div>
          <p className="eyebrow">What it is</p>
          <h2>Evidence for a draft.</h2>
          <p>
            Message Like Me measures your outgoing prose and bubble-and-response shape for
            one person across imported services, then gives your agent a
            bounded, inspectable profile.
          </p>
        </div>
        <div>
          <p className="eyebrow">What it is not</p>
          <h2>Not a digital clone.</h2>
          <p>
            It does not train a model, represent your identity, predict your
            beliefs, or send a message. Meaning and your current intent always
            outrank historical style.
          </p>
          <Link href="/research">Read the research review →</Link>
        </div>
      </section>

      <section className="privacy-section">
        <div>
          <p className="eyebrow">The private boundary</p>
          <h2>Your history is evidence, not inventory.</h2>
        </div>
        <ul>
          <li><span>01</span> Deterministic storage and measurement stay in the private local data root.</li>
          <li><span>02</span> Ordinary inspection omits prose, handles, and names.</li>
          <li><span>03</span> Opening a bounded study packet exposes it to the agent environment you chose.</li>
          <li><span>04</span> There is no Message Like Me account, server, or model API.</li>
          <li><span>05</span> Drafting ends as text. Nothing is sent.</li>
        </ul>
      </section>

      <section className="install-section" id="install">
        <div>
          <p className="eyebrow">Install v{SOFTWARE_VERSION}</p>
          <h2>Bring your own agent.</h2>
          <p>Bun 1.3.14 or newer is required.</p>
          <a href={RELEASE_URL}>View the immutable release ↗</a>
        </div>
        <div className="command-stack" aria-label="Installation commands">
          <p><span>1</span><code>bun add --global @hraness/message-like-me@{SOFTWARE_VERSION}</code></p>
          <p><span>2</span><code>messagelikeme skill install</code></p>
          <p><span>3</span><code>messagelikeme ingest imessage</code></p>
          <p><span>4</span><code>messagelikeme ingest bundle --input &quot;$HOME/message-like-me-whatsapp&quot;</code></p>
        </div>
      </section>

      <section className="readme-section" id="readme">
        <div className="readme-heading">
          <p className="eyebrow">Checked documentation</p>
          <h2>Inspect the product boundary.</h2>
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
      </main>
      <SiteFooter path="/" />
    </>
  );
}
