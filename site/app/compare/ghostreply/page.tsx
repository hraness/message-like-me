import Link from 'next/link';
import { MarketingComparison } from '@hraness/design-kit/react/server';

import { SiteFooter, SiteHeader } from '../../_components/site-chrome';
import {
  GETTING_STARTED_URL,
  GITHUB_URL,
  pageMetadata,
  REPLY_WRITERS_SENTENCE,
  serializeJsonLd,
  SUBSCRIPTION_GUIDE_URL,
} from '../../_lib/site';
import { socialImageAltFor } from '../../_lib/social';
import { compareBreadcrumbJsonLd, comparisonWebPageJsonLd, faqJsonLd } from '../../_lib/structured-data';
import { CheckedOn } from '../_components/comparison-page';
import { GHOSTREPLY_CARD, GHOSTREPLY_HUB_ENTRY } from '../_lib/comparisons';

const GHOSTREPLY_URL = GHOSTREPLY_HUB_ENTRY.officialUrl;
const GHOSTREPLY_PRIVACY_URL = 'https://ghostreply.lol/privacy.html';
const GHOSTREPLY_SAFETY_URL = 'https://ghostreply.lol/is-ai-imessage-auto-reply-safe.html';

const description =
  'Compare GhostReply and TextButler by reply controls, conversation memory, AI model choices, and where message context goes.';

export const metadata = pageMetadata({
  title: 'GhostReply alternative: TextButler compared',
  description,
  path: '/compare/ghostreply',
  image: { path: '/compare/ghostreply/opengraph-image', alt: socialImageAltFor(GHOSTREPLY_CARD) },
});

const questions = [
  {
    question: 'Does a GhostReply reply say it was automated?',
    answer:
      'GhostReply’s site describes replies that match your style, slang, length, and emojis, and does not describe a visible marker; its safety guide recommends telling a contact yourself when AI assistance would be material. TextButler marks generated replies with 🤖 by default, and you can change or clear the three disclosure symbols per contact.',
  },
  {
    question: 'Do I need my own AI account?',
    answer:
      `Not for GhostReply: hosted AI is included in the $4.99 license, and no AI API key is involved. Not necessarily for TextButler either. ${REPLY_WRITERS_SENTENCE} A local model needs no account at all. Connecting chats and sending replies you type yourself need no AI option.`,
  },
  {
    question: 'Can either app send without me watching?',
    answer:
      'Both can send automatically once you turn a contact on. GhostReply auto-sends while the Mac is awake and the app is running, and your own reply takes over or pauses that contact. New TextButler conversations start disabled; once on, they answer by default only messages that contain a keyword you choose, and the butler waits 5 minutes after you last wrote.',
  },
  {
    question: 'Where does my message history go?',
    answer:
      'Both read iMessage history on your Mac. GhostReply keeps its reply profile locally under ~/.ghostreply and sends the context needed for a reply through its Cloudflare backend to Cloudflare Workers AI. TextButler keeps editable notes for each direct or group conversation locally. Ollama writes replies on your Mac; hosted models receive the conversation context. Optional web search sends queries through a saved Gateway key even when the reply model is local.',
  },
] as const;

const jsonLd = [
  comparisonWebPageJsonLd({
    name: 'TextButler compared with GhostReply',
    description,
    other: { name: 'GhostReply', url: GHOSTREPLY_URL },
    path: '/compare/ghostreply',
  }),
  compareBreadcrumbJsonLd('TextButler and GhostReply', '/compare/ghostreply'),
  faqJsonLd(questions),
];

export default function CompareGhostReplyPage() {
  return (
    <>
      <SiteHeader />
      <main className="document-page" id="main-content" tabIndex={-1}>
        {jsonLd.map((data) => (
          <script
            dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
            key={data['@type']}
            type="application/ld+json"
          />
        ))}
        <header className="document-hero">
          <p className="eyebrow"><Link href="/compare">Compare</Link></p>
          <h1>TextButler compared with GhostReply</h1>
          <p>
            GhostReply writes iMessage replies in your style. TextButler gives you a choice
            of AI, editable notes for each conversation, and configurable reply controls.
          </p>
          <a href={GITHUB_URL}>View the open-source project</a>
        </header>
        <article className="readme-prose document-prose">
          <h2>How they compare</h2>
          <MarketingComparison
            caption="TextButler and GhostReply at a glance"
            highlight={0}
            options={[{ name: 'TextButler' }, { name: 'GhostReply' }]}
            rows={[
              { label: 'Software', values: ['Free · MIT', '$4.99 once · one Mac'] },
              { label: 'AI cost', values: ['Your model, key or subscription', 'Hosted AI included'] },
              { label: 'iMessage', values: [true, true] },
              { label: 'WhatsApp and Beeper', values: ['Through GhostGet', false] },
              { label: 'Reply style', values: ['Marked assistant by default', 'Matches your texting style'] },
              { label: 'Local AI', values: ['Ollama', false] },
              { label: 'Setup', values: ['Coding agent or setup guide', 'One command'] },
            ]}
            note={<>TextButler Gateway usage stops at $1 a day. GhostReply includes 10 free replies before purchase. <a href="#comparison-sources">Sources</a>.</>}
          />
          <CheckedOn />

          <h2>Which one fits</h2>
          <p>
            Choose GhostReply for a ready-to-install app with hosted AI included. Choose TextButler
            for editable memory, configurable reply controls, and your own model or AI subscription.
          </p>
          <p>
            GhostReply recommends telling contacts when AI assistance matters and keeping
            automatic sending off for consequential conversations. TextButler includes a
            disclosure marker by default; you can remove it per contact.
          </p>

          <details>
            <summary>How the replies and memory work</summary>
            <h2>What GhostReply does</h2>
            <p>
              GhostReply installs from one terminal command and runs as a visible Terminal session.
              You grant Full Disk Access so it can read the local Messages database, and Messages
              Automation so it can send. It learns how you text each person, matching your style,
              slang, length, and emojis in a reply profile stored under <code>~/.ghostreply</code>. You choose a
              scope of one person or all one-to-one chats; group chats are skipped.
            </p>
            <p>
              While the Mac is awake and the app is running, it sends replies automatically. The
              terminal prints each incoming text and the reply it sent. Your own reply stops
              one-person mode or pauses that contact for 30 minutes in all-contacts mode, and keyword
              heuristics hold or skip urgent and sensitive threads. For each reply, the app sends the
              context it needs through GhostReply’s Cloudflare backend to Cloudflare Workers AI; its
              privacy page says message text is not written to its database records. Ten replies are
              free, then a one-Mac license is $4.99 once with hosted AI included and no AI API key to
              create.
            </p>

            <h2>What TextButler does</h2>
            <p>
              TextButler is a headless macOS butler: a CLI, a guided terminal, and a background daemon,
              with no window or menu bar icon. You turn it on per conversation across iMessage, WhatsApp,
              and Beeper, and it keeps each conversation’s context in a folder of ordinary files you can
              open and edit. New installations start paused, and new conversations start disabled.
            </p>
            <p>
              By default its replies carry a disclosure marker:{' '}
              <code>{'🤖{ … }'}</code>, and it sends <code>{'🤖{ 👀 }'}</code> first so the other person
              knows it’s on it. You can remove the marker per conversation, never in your own chat. By
              default the butler answers only messages that contain the word “butler”; smart mode
              lets it decide when a reply is clearly wanted. A draft you review sends only in the
              version you approved. {REPLY_WRITERS_SENTENCE} The reply model can’t run commands on your Mac.
            </p>
          </details>

          <h2>Questions</h2>
          {questions.map(({ answer, question }) => (
            <section key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </section>
          ))}

          <h2 id="comparison-sources">Sources</h2>
          <ul>
            <li><a href={GHOSTREPLY_URL}>GhostReply product page</a></li>
            <li><a href={GHOSTREPLY_PRIVACY_URL}>GhostReply privacy details</a></li>
            <li><a href={GHOSTREPLY_SAFETY_URL}>GhostReply’s own safety guide</a></li>
            <li><a href={GETTING_STARTED_URL}>TextButler setup guide</a></li>
            <li><a href={SUBSCRIPTION_GUIDE_URL}>How TextButler connects a subscription through xcb</a></li>
          </ul>
          <p>
            Descriptions of GhostReply come from its public pages; TextButler has no affiliation
            with it and this page does not test its app.
          </p>
        </article>
        <nav className="document-next" aria-label="Learn more">
          <Link href="/compare">All comparisons</Link>
          <Link href="/docs">Read the project docs</Link>
          <Link href="/about">About TextButler</Link>
        </nav>
      </main>
      <SiteFooter path="/compare/ghostreply" />
    </>
  );
}
