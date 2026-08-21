import { readmeHtml } from './readme.generated';

const githubUrl = 'https://github.com/hraness/message-like-me';
const releaseUrl = `${githubUrl}/releases/tag/v0.1.0`;

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Message Like Me home">
          message <span>like me</span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#install">Install</a>
          <a href={githubUrl}>GitHub ↗</a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Local-first agent tooling for macOS</p>
          <h1>
            Your messages already know <em>how you write.</em>
          </h1>
          <p className="lede">
            Turn your private iMessage history into contact-aware style profiles
            an agent can use to draft unsent replies in your voice.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#install">
              Install v0.1.0 <span aria-hidden="true">↓</span>
            </a>
            <a className="button button-secondary" href={githubUrl}>
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
            stays on your mac
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
              <span>$</span> messagelikeme ingest imessage
            </p>
            <p className="terminal-result">✓ corpus stored locally</p>
            <p>
              <span>$</span> messagelikeme inspect tempo &lt;contact-id&gt;
            </p>
            <p className="terminal-result">✓ response shape ready</p>
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
              Import Messages and optional Contacts data without opening the
              source databases for mutation.
            </p>
            <code>messagelikeme ingest imessage</code>
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
          <p className="eyebrow">A behavioral profile</p>
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

      <section className="privacy-section">
        <div>
          <p className="eyebrow">The private boundary</p>
          <h2>Your history is evidence, not inventory.</h2>
        </div>
        <ul>
          <li><span>01</span> Message bodies stay in your private local store.</li>
          <li><span>02</span> Ordinary inspection omits prose, handles, and names.</li>
          <li><span>03</span> Study packets are bounded and written only where you choose.</li>
          <li><span>04</span> There is no Message Like Me account, server, or model API.</li>
          <li><span>05</span> Drafting ends as text. Nothing is sent.</li>
        </ul>
      </section>

      <section className="install-section" id="install">
        <div>
          <p className="eyebrow">Install v0.1.0</p>
          <h2>Bring your own agent.</h2>
          <p>Bun 1.3.14 or newer is required.</p>
          <a href={releaseUrl}>View the immutable release ↗</a>
        </div>
        <div className="command-stack" aria-label="Installation commands">
          <p><span>1</span><code>bun add --global github:hraness/message-like-me#v0.1.0</code></p>
          <p><span>2</span><code>messagelikeme skill install</code></p>
          <p><span>3</span><code>messagelikeme ingest imessage</code></p>
        </div>
      </section>

      <section className="readme-section" id="readme">
        <div className="readme-heading">
          <p className="eyebrow">Complete documentation</p>
          <h2>The README, rendered from source.</h2>
          <a href={`${githubUrl}#readme`}>Read it on GitHub ↗</a>
        </div>
        <article
          className="readme-prose"
          dangerouslySetInnerHTML={{ __html: readmeHtml }}
        />
      </section>

      <footer>
        <a className="wordmark" href="#top">message <span>like me</span></a>
        <p>Open source · MIT · local first</p>
        <a href={githubUrl}>GitHub ↗</a>
      </footer>
    </main>
  );
}
