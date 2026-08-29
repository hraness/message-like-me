import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: { absolute: 'Message Like Me — Preview' },
  robots: { follow: false, index: false },
};

export default function PreviewPage() {
  return (
    <main id="main-content">
      <section className="hero" aria-labelledby="message-like-me-preview-heading">
        <div className="hero-copy">
          <p className="eyebrow">Local-first · drafts only · macOS</p>
          <h1 id="message-like-me-preview-heading">
            Study the evidence. <em>Draft in your voice.</em>
          </h1>
          <p className="lede">
            Message Like Me studies private messaging history locally and gives
            your own agent bounded evidence for drafts that sound like you.
          </p>
          <ul className="signal-list" aria-label="Style signals analyzed">
            <li>prose</li>
            <li>tempo</li>
            <li>bubble rhythm</li>
            <li>reply habits</li>
          </ul>
        </div>

        <div className="hero-visual" aria-label="A synthetic local drafting workflow">
          <div className="privacy-stamp">
            <span className="privacy-dot" />
            no product server
          </div>
          <div className="message-stage">
            <p className="stage-label">synthetic example</p>
            <div className="bubble bubble-in">yes to friday. can you send me that link?</div>
            <div className="bubble bubble-out">perfect, friday it is</div>
            <div className="bubble bubble-out bubble-short">yep one sec</div>
          </div>
          <div className="terminal-card">
            <p><span>$</span> messagelikeme study prepare &lt;contact-id&gt;</p>
            <p className="terminal-result">✓ bounded local evidence prepared</p>
          </div>
        </div>
      </section>
    </main>
  );
}
