import { ProviderMarkChip } from '@hraness/design-kit/react/server';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '../_components/site-chrome';
import { absoluteUrl, ARCHITECTURE_URL, GETTING_STARTED_URL, GITHUB_URL, pageMetadata, REPLY_WRITERS_SENTENCE, serializeJsonLd, SITE_DESCRIPTION, SITE_NAME, SITE_WHAT_IT_IS, XCB_URL } from '../_lib/site';

export const metadata = pageMetadata({ title: 'About', description: 'Why TextButler starts paused, answers only in the conversations you turn on, and marks its replies as AI by default.', path: '/about' });
const aboutJsonLd = { '@context': 'https://schema.org', '@type': 'AboutPage', name: `About ${SITE_NAME}`, url: absoluteUrl('/about'), description: SITE_DESCRIPTION, mainEntity: { '@id': `${absoluteUrl('/')}#application` }, isPartOf: { '@id': `${absoluteUrl('/')}#website` } };

export default function AboutPage() {
  return <><SiteHeader /><main className="document-page" id="main-content" tabIndex={-1} data-hraness-landscape="page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(aboutJsonLd) }} />
    <header className="document-hero"><h1>Why TextButler works the way it does</h1><p>{SITE_WHAT_IT_IS} It runs in the background on your Mac with no window, and your coding agent can set it up.</p><a href={GITHUB_URL}>View the source on GitHub</a></header>
    <section className="about-grid" aria-label="Product principles">
      <article><h2>It answers only where you allow</h2><p>You turn replies on one conversation at a time. Keyword mode waits for “butler”; Smart mode can recognize a request for help without it. Both modes pause after you write in the chat and limit how often the assistant answers.</p></article>
      <article><h2>It starts off</h2><p>New installs start paused, every conversation starts off, and setup sends no messages. <code>textbutler pause</code> stops all replies at once, and <code>textbutler contacts disable</code> turns off one conversation.</p></article>
      <article><h2>Its notes are files you can edit</h2><p>Each conversation gets a folder of plain files on your Mac: how you talk, what matters, and what’s off-limits. Optional learning, off by default, can also remember up to 64 sourced notes; <code>textbutler habitats show</code> lists them and <code>textbutler habitats memory-clear</code> removes them. Your settings and sign-ins live elsewhere, where the butler can’t change them.</p></article>
    </section>
    <section className="about-sources" aria-labelledby="about-marker-title"><div><h2 id="about-marker-title">Why replies are marked</h2></div><div><p>The person you’re texting should know when an assistant wrote the reply. By default, TextButler wraps replies and acknowledgments in the {'🤖{ }'} marker before sending. You can change or remove it for one conversation; do that only with people who already know you use TextButler. Your own chat always keeps a visible marker.</p><p>TextButler also records which messages it sent, so it never mistakes its own replies for yours.</p></div></section>
    <section className="about-sources" aria-labelledby="about-writers-title"><div><h2 id="about-writers-title">Pick what writes replies</h2></div><div><p className="provider-marks"><ProviderMarkChip mark="qwen" size={20} /><ProviderMarkChip mark="claudecode" size={20} /><ProviderMarkChip mark="codex" size={20} /><ProviderMarkChip mark="devin" size={20} /></p><p>{REPLY_WRITERS_SENTENCE} A local model writes replies on your Mac; optional web search still sends queries through your saved Gateway key.</p><p>Through <a href={XCB_URL}>xcb</a>, the model can’t run commands on your Mac, and xcb keeps your sign-in. TextButler decides who gets a reply and does the sending.</p><p><a href={GETTING_STARTED_URL}>Open the setup guide</a> · <a href={ARCHITECTURE_URL}>Read the architecture</a></p></div></section>
    <nav className="document-next" aria-label="Learn more"><Link href="/#how-it-works">How it works</Link><Link href="/docs">Read the docs</Link><Link href="/blog/introducing-textbutler">Introducing TextButler</Link><Link href="/compare/ghostreply">Compare with GhostReply</Link></nav>
  </main><SiteFooter path="/about" /></>;
}
