import {
  MarketingCallToAction,
  MarketingFlow,
  MarketingPage,
  MarketingQuestionList,
  MarketingRelated,
  MarketingSection,
  ProductHero,
  ProviderMarkChip,
} from '@hraness/design-kit/react/server';
import { product, type PortfolioProductId } from '@hraness/design-kit/portfolio';
import Link from 'next/link';

import { SiteFooter, SiteHeader } from './_components/site-chrome';
import {
  ARCHITECTURE_URL,
  GITHUB_URL,
  GETTING_STARTED_URL,
  pageMetadata,
  RELEASE_URL,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_STATUS,
  SITE_STATUS_LABEL,
  SITE_TITLE,
  SOFTWARE_VERSION,
} from './_lib/site';

export const metadata = pageMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: '/',
});

// Related cards take each product's link, mark, and one-liner from the portfolio facts.
const related = (id: PortfolioProductId, name: string) => {
  const { canonicalUrl, mark, oneLiner } = product(id);
  return { href: canonicalUrl, mark, name, role: oneLiner };
};

const HERO_FOOTNOTE = `${SITE_STATUS_LABEL} · macOS · iMessage, WhatsApp, and Beeper`;
const HOME_QUESTIONS = [
  {
    question: 'Can I use Textbutler today?',
    answer: 'Yes, from source on a Mac. The guided terminal helps you connect your messaging apps through Ghostget, add a conversation, check your inbox, and send replies you write yourself. That needs no AI account, and new installations start paused. A local build with a connected AI account adds the butler: it reads the conversations you turn on, drafts replies, and can send them on its own. There is no app to download; you start the menu bar companion from the terminal.',
  },
  {
    question: 'Can it answer messages for me?',
    answer: 'Yes, with some setup. With a local build and a Claude Code or Codex subscription connected through xcb, the butler writes and sends replies, marked by default, to the contacts you turn on, once you resume it. It can also suggest replies for you to review. Without an AI account, you draft each reply yourself in the guided inbox, read the complete text, and choose when to send. Running from source never writes AI replies.',
  },
  {
    question: 'Can my agent use it directly?',
    answer: 'Yes. The JSON CLI is built for agents. It can list conversations, read and summarize history, write drafts, and send messages you have explicitly authorized. These are the same staged actions the butler uses, and they stay within what each contact you turn on allows.',
  },
  {
    question: 'Which agent can I use?',
    answer: 'Claude Code or Codex, through your own subscription and xcb, once your xcb account and model pass their checks. An optional fast-reply mode, which you turn on in the host.json settings file, has a Qwen model through Vercel AI Gateway or a model server on your Mac write the replies instead; you still need an xcb account that passes its checks to turn a contact on. Both need a local build. The Claude API route isn’t available in any build of this repository; it needs a separately reviewed runtime, and API use is billed separately from a Claude Code subscription. Textbutler never falls back to an API account when you choose a subscription.',
  },
  {
    question: 'Does this website receive my messages?',
    answer: 'No. textbutler.app is informational and has no message upload, contact import, account, or drafting form. The Mac stores contact context locally. When you choose a hosted AI provider, it handles the context it receives under its own data policies.',
  },
  {
    question: 'Which rich message features will work?',
    answer: 'Start with text replies. iMessage and WhatsApp connect directly through Ghostget. Beeper adds linked apps such as Signal, Telegram, and Instagram, for text only. Anything beyond text depends on the connection and its permissions. Some iMessage extras need a separately configured Messages bridge, which requires System Integrity Protection disabled; Textbutler never changes that setting. App Clips, mini apps, and Linq aren’t supported.',
  },
  {
    question: 'What happened to Message Like Me?',
    answer: `Textbutler replaced it. Message Like Me’s history readers, methodology, and published v${SOFTWARE_VERSION} package are still available as legacy tools. Installing that package doesn’t install Textbutler or turn on automatic replies.`,
  },
] as const;

// The first screen of the guided terminal on a fresh install, copied from
// terminalDashboard(null) in packages/textbutler/src/tui.ts. A site test keeps
// every line equal to that source.
export const TERMINAL_FIRST_RUN = [
  'TEXTBUTLER',
  'Your conversations, with you in control.',
  '',
  'Service not connected',
  'Start with Setup & readiness.',
  '',
  '  1  Setup & readiness',
  '  2  Connect messaging apps',
  '  3  Add a conversation',
  '  4  Inbox & replies',
  '  5  Manage a contact',
  '  6  Pause automatic replies',
  '  7  Resume automatic replies',
  '  8  Menu bar companion',
  '  9  Give Textbutler access',
  '  q  Quit terminal',
  '',
  'Quitting leaves the background service running.',
] as const;

function TerminalProof() {
  return (
    <figure className="tb-terminal">
      <figcaption className="tb-terminal__caption">
        <span>Terminal</span>
        <span>First run on a new install</span>
      </figcaption>
      <pre aria-label="The guided terminal's first screen" tabIndex={0}><code><span className="tb-terminal__prompt">$ bun run textbutler tui</span>{'\n\n'}{TERMINAL_FIRST_RUN.join('\n')}</code></pre>
    </figure>
  );
}

export default function Home() {
  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: HOME_QUESTIONS.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })) };
  return (
    <div className="textbutler-marketing" data-hraness-marketing-preset="editorial" data-hraness-pattern="none">
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faq) }} />
        <MarketingPage className="mlm-page textbutler-page">
          <ProductHero
            backdrop={false}
            align="start"
            actions={[{ href: GETTING_STARTED_URL, label: 'Set up on your Mac' }, { href: '#replies', label: 'How replies stay off', emphasis: 'secondary' }]}
            boundary={HERO_FOOTNOTE}
            className="mlm-marketing-hero"
            eyebrow="Messaging assistant for Mac"
            frame={<TerminalProof />}
            heading="Your AI butler replies in the chats you choose."
            headingId="textbutler-title"
            name="Textbutler"
            summary="Turn it on for one person on iMessage, WhatsApp, or Beeper, and it replies as a clearly marked assistant that knows your history with them."
          />

          <MarketingSection heading="A butler for each relationship" headingId="contacts-title" id="how-it-works" label="How it works" summary="You choose which contacts your agent can help, and each one gets its own notes. You can pause one conversation or all of them at any time.">
            <MarketingFlow ariaLabel="How Textbutler works with one contact" steps={[
              { label: 'Choose a contact', detail: 'Pick one direct conversation from a connected app. New contacts start with the butler off, and by default up to five contacts can have it on at once.' },
              { label: 'Give it context', detail: 'Optionally import recent history. Guidance, preferences, and dated memories live in an ordinary folder you can read and edit.' },
              { label: 'Let your agent work', detail: 'It reads new messages, sums up what needs an answer, and drafts replies within what that contact allows. You can review everything in the inbox.' },
              { label: 'Turn on automatic replies later', detail: 'Automatic replies stay off until you connect an AI account that passes its check, turn replies on for this contact, and resume the butler. They need a local build. Running from source never writes AI replies.' },
            ]} />
          </MarketingSection>

          <MarketingSection heading="It answers only when you let it" headingId="replies-title" id="replies" label="Replies" summary="With a local build and a connected subscription, the butler can answer the contacts you turn on by itself. Its replies are marked, paced, and kept within limits you set.">
            <figure className="tb-disclosure">
              <p className="bubble bubble-out">{'🤖{ Where are you headed, and for how long? }'}</p>
              <figcaption>An example reply. The 🤖{'{ }'} wrapper is the default marker; you can change or clear its three symbols for each contact. Clearing all three sends plain text.</figcaption>
            </figure>
            <dl className="architecture-rows">
              <div><dt>Paced, not instant</dt><dd>Replies wait through bursts of messages, hold back after you’ve just written, and check the conversation again right before sending. The current connections can’t see when you’re typing.</dd></div>
              <div><dt>Limits it can’t raise</dt><dd>You turn each contact on separately, a cap limits how many are on at once, and hourly reply limits and a confidence threshold apply. The butler can choose to stay silent; it can’t raise its own limits.</dd></div>
              <div><dt>A pause that is always yours</dt><dd>Pause one conversation or the whole butler at any time. New installations and new contacts start paused.</dd></div>
              <div><dt>You see what you send</dt><dd>When you send or approve a reply yourself, the terminal shows its complete text first.</dd></div>
            </dl>
          </MarketingSection>

          <MarketingSection heading="It learns each relationship" headingId="memory-title" id="memory" label="Memory" layout="split" summary="The butler keeps each contact’s context in ordinary files: guidance it reads, dated memories with sources, and the corrections you make. It is designed to learn from conversation without turning its guesses into facts.">
            <div className="workspace-example"><pre aria-label="Example contact folder" tabIndex={0}><code>{`contact/\n├── AGENTS.md     your standing instructions\n├── ABOUT.md      what matters in this relationship\n├── MEMORY.md     dated notes, with sources\n├── STYLE.md      how to help in this conversation\n├── history/\n├── notes/\n├── attachments/\n└── outbox/`}</code></pre><p>Your settings, sign-ins, and permissions live elsewhere, where the butler can’t edit them. <a href={`${ARCHITECTURE_URL}#contact-data`}>How contact folders work</a></p></div>
          </MarketingSection>

          <MarketingSection heading="What the butler can see and do" headingId="boundaries-title" id="boundaries" label="Access" summary="Contact folders stay on your Mac. The AI provider you connect sees the context it needs to write a reply. This website has no access to any of it.">
            <dl className="architecture-rows">
              <div><dt>One conversation at a time</dt><dd>The butler can read and edit one contact’s folder, fetch public web pages, and propose messages for that conversation. Textbutler checks each request before acting on it.</dd></div>
              <div><dt>No commands on your Mac</dt><dd>Through xcb the AI model gets no tools of its own. It can’t run commands, and your AI sign-in stays in xcb. Signing in alone doesn’t turn AI replies on.</dd></div>
              <div><dt>Every send is recorded</dt><dd>The background service logs each send with the messaging app’s confirmation. A send whose outcome is unclear stays blocked until it is resolved, and it is never retried silently.</dd></div>
              <div><dt>Only what the connection supports</dt><dd>Anything beyond text depends on the messaging app and its permissions. Features Textbutler can’t use, such as mini apps, show as unavailable.</dd></div>
            </dl>
          </MarketingSection>

          <MarketingSection heading="Small parts with clear jobs" headingId="architecture-title" id="architecture" label="Architecture" summary="A background service on your Mac does the work, and the menu bar companion gives you the controls. Developers can extend it with hooks without handing the AI model unrestricted access.">
            <dl className="architecture-rows">
              <div><dt>Textbutler</dt><dd>Contacts, response timing, visible disclosure, evolving memory, pause, action policy, and the send log.</dd></div>
              <div><dt><a href="https://ghostget.com">Ghostget</a></dt><dd>iMessage, WhatsApp, and Beeper connections, account permissions, conversation identity, and available message actions.</dd></div>
              <div><dt><a href="https://github.com/hraness/xcb">xcb</a></dt><dd>Runs the butler’s replies on your own Claude Code or Codex subscription and keeps that sign-in out of Textbutler. The model proposes actions for Textbutler to check. Textbutler’s MIT-licensed source also serves as an example app for developers building on xcb.</dd></div>
              <div><dt>Your hooks</dt><dd>Developer-written extensions for context and response decisions. Trusted executable hooks stay separate from the agent’s editable memory.</dd></div>
            </dl>
            <p className="mlm-section-link"><a href={ARCHITECTURE_URL}>Read the architecture and its limits</a></p>
          </MarketingSection>

          <MarketingSection heading="Start with a reply you write" headingId="development-title" id="development" label="Get started" summary={SITE_STATUS}>
            <ol className="tb-steps">
              <li>
                <h3>Open the guided terminal</h3>
                <p>From your Textbutler checkout, with Bun 1.3.14. It walks you through connecting Ghostget, adding one conversation, and sending a reply you write yourself. New installations start paused. The optional menu bar companion downloads a prebuilt runner, so there is nothing extra to build.</p>
                <pre tabIndex={0}><code>{'bun install --frozen-lockfile --ignore-scripts\nbun run textbutler tui'}</code></pre>
                <a href={GETTING_STARTED_URL}>Follow the setup guide</a>
              </li>
              <li>
                <h3>Connect AI through xcb</h3>
                <p className="provider-marks"><ProviderMarkChip mark="claudecode" size={20} /><ProviderMarkChip mark="codex" size={20} /></p>
                <p>Build a local copy. It refuses to build if the source files it checks differ from the last reviewed version. Then connect xcb, choose a Claude Code or Codex account, and run <code>providers check</code>. Running from source never writes AI replies. A finished setup doesn’t show that replies work, so test delivery and rich actions on your own account before you rely on them.</p>
                <pre tabIndex={0}><code>{'bun run textbutler:install'}</code></pre>
                <a href={`${GITHUB_URL}/blob/main/docs/textbutler/native-subscription.md`}>Read the subscription guide</a>
              </li>
            </ol>
            <p className="legacy-note">Looking for the original history tools? The legacy history package is still published with the <a href={RELEASE_URL}>Textbutler v{SOFTWARE_VERSION}</a> release. It does not install Textbutler or enable automatic replies. <Link href="/sources">View legacy history sources.</Link></p>
          </MarketingSection>

          <MarketingQuestionList className="mlm-marketing-questions" heading="Questions" headingId="questions-title" id="questions" label="FAQ" questions={HOME_QUESTIONS.map(({ answer, question }) => ({ answer: <p>{answer}</p>, question }))} />
          <MarketingRelated heading="From the same workshop" headingId="related-title" label="Related" summary="More Hraness tools that work on your Mac and keep the agent’s access limited." groups={[
            {
              heading: "The personal apps",
              headingId: "related-apps",
              items: [related('peopleblade', 'PeopleBlade'), related('soulscrape', 'Soulscrape'), related('kb', 'Wordcell')],
            },
            {
              heading: "The agent platform",
              headingId: "related-tools",
              summary: "The connections, subscription, and model comparisons around the butler.",
              items: [related('wrench', 'Ghostget'), related('xcb', 'xcb'), related('aicharts', 'AI Charts')],
            },
          ]} />
          <MarketingCallToAction actions={[{ href: GETTING_STARTED_URL, label: 'Start guided setup' }, { href: '/docs', label: 'Read the docs', emphasis: 'secondary' }]} className="mlm-marketing-cta" footnote={HERO_FOOTNOTE} heading="Try one conversation" headingId="closing-title" id="closing" summary="Connect an app, choose a conversation, and watch your agent work. Turn on automatic replies only after your account passes its check and you’ve tested with the person you chose." />
        </MarketingPage>
      </main>
      <SiteFooter path="/" />
    </div>
  );
}
