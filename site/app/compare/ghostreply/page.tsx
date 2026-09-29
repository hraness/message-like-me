import Link from 'next/link';

import { SiteFooter, SiteHeader } from '../../_components/site-chrome';
import {
  GETTING_STARTED_URL,
  GITHUB_URL,
  pageMetadata,
  REPLY_WRITERS_SENTENCE,
  serializeJsonLd,
  SITE_STATUS_LABEL,
  SUBSCRIPTION_GUIDE_URL,
  XCB_URL,
} from '../../_lib/site';

const GHOSTREPLY_URL = 'https://ghostreply.lol';
const GHOSTREPLY_PRIVACY_URL = 'https://ghostreply.lol/privacy.html';
const GHOSTREPLY_SAFETY_URL = 'https://ghostreply.lol/is-ai-imessage-auto-reply-safe.html';

const description =
  'GhostReply answers iMessages in your texting style on a $4.99 license. TextButler answers as a marked assistant when someone says “butler”, with a local model, your own key, or your subscription.';

export const metadata = pageMetadata({
  title: 'GhostReply alternative: TextButler compared',
  description,
  path: '/compare/ghostreply',
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
      'Both can send automatically once you turn a contact on. GhostReply auto-sends while the Mac is awake and the app is running, and your own reply takes over or pauses that contact. New TextButler contacts start disabled; once on, they answer by default only messages that contain a keyword you choose, and the butler waits 5 minutes after you last wrote.',
  },
  {
    question: 'Where does my message history go?',
    answer:
      'Both read iMessage history on your Mac. GhostReply keeps its reply profile locally under ~/.ghostreply and sends the context needed for a reply through its Cloudflare backend to Cloudflare Workers AI. TextButler keeps a folder of notes per person locally. With a local model through Ollama (in testing), the reply is written on your Mac too; with your Gateway key or your subscription, the conversation context goes to that service.',
  },
] as const;

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: questions.map(({ answer, question }) => ({
    '@type': 'Question',
    name: question,
    acceptedAnswer: { '@type': 'Answer', text: answer },
  })),
};

export default function CompareGhostReplyPage() {
  return (
    <>
      <SiteHeader />
      <main className="document-page" id="main-content" tabIndex={-1}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
        />
        <header className="document-hero">
          <p className="eyebrow">Compare</p>
          <h1>TextButler compared with GhostReply</h1>
          <p>
            GhostReply and TextButler both answer the iMessage conversations you choose on a Mac.
            Pick GhostReply for a finished $4.99 app whose replies read as yours. Pick TextButler
            if you want replies marked as an assistant’s, answers only when someone says “butler”,
            WhatsApp and Beeper as well as iMessage, and a choice of what writes the replies, and
            you are comfortable building it from source (your coding agent can do that for you).
          </p>
          <a href={GITHUB_URL}>View the open-source project</a>
        </header>
        <article className="readme-prose document-prose">
          <p>
            <a href={GHOSTREPLY_URL}>GhostReply</a> is a $4.99 Mac app whose pitch is that the
            reply reads like you wrote it. TextButler is a free, MIT-licensed butler whose replies
            announce that an assistant sent them.
          </p>
          <p>TextButler status: {SITE_STATUS_LABEL}. <Link href="/#status">See where it stands</Link>.</p>

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
            and Beeper, and it keeps each contact’s context in a folder of ordinary files you can
            open and edit. New installations start paused, and new contacts start disabled.
          </p>
          <p>
            By default its replies carry a disclosure marker:{' '}
            <code>{'🤖{ … }'}</code>, and it sends <code>{'🤖{ 👀 }'}</code> first so the other person
            knows it’s on it. You can remove the marker per person, never in your own chat. By
            default the butler answers only messages that contain the word “butler”; smart mode
            lets it decide when a reply is clearly wanted. A draft you review sends only in the
            version you approved. {REPLY_WRITERS_SENTENCE} Through <a href={XCB_URL}>xcb</a>, the
            model can’t run commands on your Mac.
          </p>

          <h2>How they compare</h2>
          <table>
            <caption>
              Read from GhostReply’s site, safety guide, and privacy page, and from TextButler’s
              documentation, on September 26, 2026
            </caption>
            <thead>
              <tr>
                <th scope="col">Aspect</th>
                <th scope="col">GhostReply</th>
                <th scope="col">TextButler</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Who the reply sounds like</th>
                <td>You: it matches your texting style, slang, length, and emojis</td>
                <td>A marked assistant: replies are wrapped in 🤖{'{ }'} by default, and you can remove the marker per person</td>
              </tr>
              <tr>
                <th scope="row">What it answers</th>
                <td>Incoming iMessages: one chosen person or all one-to-one chats, with group chats skipped</td>
                <td>Messages that say “butler” in the one-to-one iMessage, WhatsApp, and Beeper chats you turn on, plus replies you type yourself</td>
              </tr>
              <tr>
                <th scope="row">Where the AI runs</th>
                <td>GhostReply’s Cloudflare backend calls Cloudflare Workers AI; there is no API key to create or choose</td>
                <td>Your choice: a local model on your Mac through Ollama (in testing), Qwen 3.5 Flash through your own Vercel AI Gateway key, or your Claude Code, Codex, or Devin subscription through xcb</td>
              </tr>
              <tr>
                <th scope="row">What it reads</th>
                <td>The local Messages database under Full Disk Access, plus Contacts for names; a learned reply profile in ~/.ghostreply</td>
                <td>The chats you turn on, with an optional recent-history import, and a folder of notes for each person</td>
              </tr>
              <tr>
                <th scope="row">What you pay</th>
                <td>10 replies free, then $4.99 once for a one-Mac personal license with hosted AI included</td>
                <td>Nothing for the software, which is MIT licensed. A local model costs nothing extra; Gateway usage stops at $1 a day; or use a Claude Code, Codex, or Devin subscription you already pay for</td>
              </tr>
              <tr>
                <th scope="row">What ships today</th>
                <td>A one-command install for macOS, sold and maintained by Harrison Rampell</td>
                <td>A source-only build with no signed app; automatic replies have worked end to end over iMessage in our testing, and WhatsApp and Beeper replies need testing on your own account</td>
              </tr>
            </tbody>
          </table>

          <h2>Which one fits</h2>
          <p>
            GhostReply fits if you want a finished, paid Mac app whose replies pass as yours and
            you accept reply context going through its hosted backend. TextButler fits if you want
            each reply marked as an assistant’s, want the reply written on your own Mac or on a
            subscription you already pay for, want to inspect and edit what it remembers about each person, or want
            WhatsApp and Beeper in scope alongside iMessage.
          </p>
          <p>
            One caution applies to both: the person on the other end may assume you wrote the
            reply. GhostReply’s own safety guide recommends telling a contact when AI assistance
            would be material to their expectations, and it suggests keeping automatic sending off
            for consequential conversations. TextButler’s marker makes the disclosure part of the
            message itself.
          </p>

          <h2>Questions</h2>
          {questions.map(({ answer, question }) => (
            <section key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </section>
          ))}

          <h2>Sources</h2>
          <ul>
            <li><a href={GHOSTREPLY_URL}>GhostReply product page</a></li>
            <li><a href={GHOSTREPLY_PRIVACY_URL}>GhostReply privacy details</a> (updated August 22, 2026)</li>
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
          <Link href="/docs">Read the project docs</Link>
          <Link href="/about">About TextButler</Link>
        </nav>
      </main>
      <SiteFooter path="/compare/ghostreply" />
    </>
  );
}
