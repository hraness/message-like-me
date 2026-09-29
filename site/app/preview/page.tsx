import type { Metadata } from 'next';

import { REPLY_WRITERS_SENTENCE, SITE_HEADLINE, SITE_STATUS } from '../_lib/site';

export const metadata: Metadata = { title: { absolute: 'TextButler | Preview' }, robots: { follow: false, index: false } };

export default function PreviewPage() {
  return <main id="main-content"><section className="hero" aria-labelledby="textbutler-preview-heading">
    <div className="hero-copy"><h1 id="textbutler-preview-heading">{SITE_HEADLINE}</h1><p className="lede">When someone you’ve turned on texts “butler” in iMessage, WhatsApp, or Beeper, a clearly marked AI assistant answers for you from your Mac. It runs in the background with no window or menu bar icon, and your coding agent can set it up.</p><p className="lede">{SITE_STATUS}</p><p className="lede">{REPLY_WRITERS_SENTENCE}</p></div>
    <div className="hero-visual" aria-label="Synthetic example of a marked butler reply"><div className="message-stage"><p className="stage-label">Synthetic example · no message sent</p><div className="bubble bubble-in">Butler, what time did Sam say? And is he bringing the harness?</div><p className="stage-label stage-label--draft">The butler, from Sam’s Mac</p><div className="bubble bubble-out">{'🤖{ 👀 }'}</div><div className="bubble bubble-out bubble-short">{'🤖{ On Monday Sam said Friday at 6:30 at the gym, and that he’d bring the spare harness for you. Nothing here has changed since. }'}</div><p className="butler-disclosure-note">The 🤖{'{ }'} wrapper marks the butler’s words.</p></div></div>
  </section></main>;
}
