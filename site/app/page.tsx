import Link from 'next/link';

import { SiteFooter, SiteHeader } from './_components/site-chrome';
import {
  GITHUB_URL,
  pageMetadata,
  RELEASE_URL,
  SITE_DESCRIPTION,
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
          <p className="eyebrow">Local-first agent tooling for macOS</p>
          <h1>
            Your messages already know <em>how you write.</em>
          </h1>
          <p className="lede">
            Turn private messaging history from Messages and your connected
            accounts into contact-aware style profiles an agent can use to draft
            unsent replies in your voice.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#install">
              Install v0.3.0 <span aria-hidden="true">↓</span>
            </a>
            <a className="button button-secondary" href={GITHUB_URL}>
              View the source <span aria-hidden="true">↗</span>
            </a>
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
              <span>$</span> wrench beeper export-message-like-me --auth beeper-main --output &quot;$HOME/message-like-me-beeper&quot;
            </p>
            <p className="terminal-result">✓ Wrench 0.13.0+ private bundle written</p>
            <p>
              <span>$</span> messagelikeme ingest bundle --input &quot;$HOME/message-like-me-beeper&quot;
            </p>
            <p className="terminal-result">✓ source-aware history merged</p>
          </div>
        </div>
      </section>

      <section className="promise-strip" aria-label="Product promises">
        <p><strong>Read-only ingest.</strong> Stable copies, never source mutation.</p>
        <p><strong>Bring your own agent.</strong> No model account or API key.</p>
        <p><strong>Drafts only.</strong> Nothing sends, reacts, or schedules.</p>
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
              Import Messages and optional Contacts directly, or merge a
              private source-aware bundle exported by Wrench 0.13.0+ from
              Beeper.
            </p>
            <code>messagelikeme ingest bundle --input &quot;$HOME/message-like-me-beeper&quot;</code>
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
            Message Like Me measures your outgoing prose and delivery shape for
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
          <li><span>01</span> The CLI keeps its store and analysis local.</li>
          <li><span>02</span> Ordinary inspection omits prose, handles, and names.</li>
          <li><span>03</span> Study packets are bounded. Provide or open them for an agent only intentionally.</li>
          <li><span>04</span> There is no Message Like Me account, server, or model API.</li>
          <li><span>05</span> Drafting ends as text. Nothing is sent.</li>
        </ul>
      </section>

      <section className="install-section" id="install">
        <div>
          <p className="eyebrow">Install v0.3.0</p>
          <h2>Bring your own agent.</h2>
          <p>Bun 1.3.14 or newer is required.</p>
          <a href={RELEASE_URL}>View the immutable release ↗</a>
        </div>
        <div className="command-stack" aria-label="Installation commands">
          <p><span>1</span><code>bun add --global github:hraness/message-like-me#v0.3.0</code></p>
          <p><span>2</span><code>messagelikeme skill install</code></p>
          <p><span>3</span><code>messagelikeme ingest imessage</code></p>
          <p><span>4</span><code>messagelikeme ingest bundle --input &quot;$HOME/message-like-me-beeper&quot;</code></p>
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
      <SiteFooter />
    </>
  );
}
