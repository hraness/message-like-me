import Link from 'next/link';

import { SiteFooter, SiteHeader } from '../../_components/site-chrome';
import {
  GETTING_STARTED_URL,
  GITHUB_URL,
  pageMetadata,
  serializeJsonLd,
  SITE_STATUS,
} from '../../_lib/site';

const GHOSTREPLY_URL = 'https://ghostreply.lol';
const GHOSTREPLY_PRIVACY_URL = 'https://ghostreply.lol/privacy.html';
const GHOSTREPLY_SAFETY_URL = 'https://ghostreply.lol/is-ai-imessage-auto-reply-safe.html';

const description =
  'GhostReply answers iMessages in your texting style on a $4.99 license. Textbutler replies as a marked assistant on your own AI subscription.';

export const metadata = pageMetadata({
  title: 'GhostReply alternative: Textbutler compared',
  description,
  path: '/compare/ghostreply',
});

const questions = [
  {
    question: 'Does a GhostReply reply say it was automated?',
    answer:
      'GhostReply’s site describes replies that match your style, slang, length, and emojis, and does not describe a visible marker; its safety guide recommends telling a contact yourself when AI assistance would be material. Textbutler marks generated replies with 🤖 by default, and you can change or clear the three disclosure symbols per contact.',
  },
  {
    question: 'Do I need my own AI account?',
    answer:
      'Not for GhostReply: hosted AI is included in the $4.99 license, and no AI API key is involved. Textbutler writes AI replies through your own Claude Code, Codex, or Devin subscription connected with xcb, though connecting chats and sending replies you type yourself need no AI account.',
  },
  {
    question: 'Can either app send without me watching?',
    answer:
      'Both can send automatically once you turn a contact on. GhostReply auto-sends while the Mac is awake and the app is running, and your own reply takes over or pauses that contact. New Textbutler contacts start disabled; once on, they answer by default only messages that contain a keyword you choose, and the butler holds back for a few minutes after you write.',
  },
  {
    question: 'Where does my message history go?',
    answer:
      'Both read iMessage history on your Mac. GhostReply keeps its reply profile locally under ~/.ghostreply and sends the context needed for a reply through its Cloudflare backend to Cloudflare Workers AI. Textbutler keeps a folder of notes per contact locally, and the provider account you connect through xcb sees the context a reply needs. Neither is fully offline once AI replies are on.',
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
          <h1>Textbutler compared with GhostReply</h1>
          <p>
            GhostReply and Textbutler both watch the iMessage conversations you choose on a Mac
            and can answer them without you typing. GhostReply writes replies that read as yours;
            Textbutler marks its replies as an assistant’s and runs them on your own AI
            subscription.
          </p>
          <a href={GITHUB_URL}>View the open-source project</a>
        </header>
        <article className="readme-prose document-prose">
          <p>
            <a href={GHOSTREPLY_URL}>GhostReply</a> is a $4.99 Mac app whose pitch is that the
            reply reads like you wrote it. Textbutler is a free, MIT-licensed butler whose replies
            announce that an assistant sent them.
          </p>
          <p>{SITE_STATUS}</p>

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

          <h2>What Textbutler does</h2>
          <p>
            Textbutler is a macOS butler: a CLI, a guided terminal, a background daemon, and an
            optional menu bar companion. You turn it on per conversation across iMessage, WhatsApp,
            and Beeper, and it keeps each contact’s context in a folder of ordinary files you can
            open and edit. New installations start paused, and new contacts start disabled.
          </p>
          <p>
            By default its replies carry a disclosure marker:{' '}
            <code>{'🤖{ hello this is my response }'}</code>. The three symbols are configurable
            per contact. By default the butler answers only messages that contain a keyword
            you choose; smart mode lets it decide which messages need an answer. A draft you review sends only in the
            version you approved. AI replies run on your own Claude Code,
            Codex, or Devin subscription through <a href="https://github.com/hraness/xcb">xcb</a> from the
            local install; an optional fast-reply mode can use a Qwen model through Vercel AI
            Gateway or a model server on your Mac.
          </p>

          <h2>How they compare</h2>
          <table>
            <caption>
              Read from GhostReply’s site, safety guide, and privacy page, and from Textbutler’s
              documentation, on September 26, 2026
            </caption>
            <thead>
              <tr>
                <th scope="col">Aspect</th>
                <th scope="col">GhostReply</th>
                <th scope="col">Textbutler</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Who the reply sounds like</th>
                <td>You: it matches your texting style, slang, length, and emojis</td>
                <td>A marked assistant: replies start with 🤖 by default, and the marker is configurable or removable per contact</td>
              </tr>
              <tr>
                <th scope="row">What it answers</th>
                <td>Incoming iMessages: one chosen person or all one-to-one chats, with group chats skipped</td>
                <td>The iMessage, WhatsApp, and Beeper conversations you turn on, plus replies you type yourself</td>
              </tr>
              <tr>
                <th scope="row">Where the AI runs</th>
                <td>GhostReply’s Cloudflare backend calls Cloudflare Workers AI; there is no API key to create or choose</td>
                <td>Your own Claude Code, Codex, or Devin subscription through xcb on your Mac; the optional fast-reply path uses a Qwen model through Vercel AI Gateway or a local model server</td>
              </tr>
              <tr>
                <th scope="row">What it reads</th>
                <td>The local Messages database under Full Disk Access, plus Contacts for names; a learned reply profile in ~/.ghostreply</td>
                <td>The conversations you enroll, with an optional recent-history import, and the per-contact notes folder it maintains</td>
              </tr>
              <tr>
                <th scope="row">What you pay</th>
                <td>10 replies free, then $4.99 once for a one-Mac personal license with hosted AI included</td>
                <td>Nothing for the software, which is MIT licensed; AI replies use the Claude Code, Codex, or Devin subscription you already pay for</td>
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
            you accept reply context going through its hosted backend. Textbutler fits if you want
            each reply marked as an assistant’s, want the model to run on a subscription you
            already pay for, want to inspect and edit what it remembers about each person, or want
            WhatsApp and Beeper in scope alongside iMessage.
          </p>
          <p>
            One caution applies to both: the person on the other end may assume you wrote the
            reply. GhostReply’s own safety guide recommends telling a contact when AI assistance
            would be material to their expectations, and it suggests keeping automatic sending off
            for consequential conversations. Textbutler’s marker makes the disclosure part of the
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
            <li><a href={GETTING_STARTED_URL}>Textbutler setup guide</a></li>
            <li><a href={`${GITHUB_URL}/blob/main/docs/textbutler/native-subscription.md`}>How Textbutler connects a subscription through xcb</a></li>
          </ul>
          <p>
            Descriptions of GhostReply come from its public pages; Textbutler has no affiliation
            with it and this page does not test its app.
          </p>
        </article>
        <nav className="document-next" aria-label="Learn more">
          <Link href="/docs">Read the project docs</Link>
          <Link href="/about">About Textbutler</Link>
        </nav>
      </main>
      <SiteFooter path="/compare/ghostreply" />
    </>
  );
}
