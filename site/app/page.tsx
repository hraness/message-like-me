import {
  MarketingCallToAction,
  MarketingFlow,
  MarketingPage,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingRelated,
  MarketingSection,
  ProductHero,
  ProviderMarkChip,
  SyntaxCode,
} from '@hraness/design-kit/react/server';
import { product, type PortfolioProductId } from '@hraness/design-kit/portfolio';
import Link from 'next/link';

import { CodeBlock } from './_components/code-block';
import { CopyButton } from './_components/landing/copy-button';
import { DiagramFigure } from './_components/landing/diagram-figure';
import { DiagramSwitch } from './_components/landing/diagram-switch';
import { LaunchVideo } from './_components/landing/launch-video';
import { PhoneSlot } from './_components/landing/phone-slot';
import { DIAGRAMS, LAUNCH_ASSETS, LAUNCH_FILM_SECONDS, launchFilmSources, publicAssetExists } from './_components/landing/public-assets';
import './_components/landing/landing.css';
import {
  askYourselfConversation,
  boundariesConversation,
  heroConversation,
  staysOutConversation,
} from './_components/phone/conversations';
import { SiteFooter, SiteHeader } from './_components/site-chrome';
import {
  HOW_IT_WORKS_STEPS,
  MESSAGING_APPS,
  REPLY_MODES,
  REPLY_WRITERS,
  SETUP_STEPS,
  type SupportChip,
} from './_lib/landing';
import {
  absoluteUrl,
  AGENT_CLI_URL,
  AGENT_SETUP_PROMPT,
  ARCHITECTURE_URL,
  GETTING_STARTED_URL,
  GHOSTGET_SETUP_URL,
  pageMetadata,
  REPLY_CREDITS_NOTE,
  REPLY_WRITERS_PRECEDENCE,
  REPLY_WRITERS_SENTENCE,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_HEADLINE,
  SITE_STATUS,
  SITE_STATUS_LABEL,
  SITE_TITLE,
  SUBSCRIPTION_GUIDE_URL,
  XCB_URL,
} from './_lib/site';
import { TERMINAL_FIRST_RUN } from './_lib/terminal';

const baseMetadata = pageMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: '/',
});

// og:video points at the launch film only once the file is really there.
export const metadata = publicAssetExists(LAUNCH_ASSETS.film)
  ? {
      ...baseMetadata,
      openGraph: {
        ...baseMetadata.openGraph,
        videos: [{ url: absoluteUrl(`/${LAUNCH_ASSETS.film}`), secureUrl: absoluteUrl(`/${LAUNCH_ASSETS.film}`), type: 'video/mp4', width: 1920, height: 1080 }],
      },
    }
  : baseMetadata;

// Related cards take each product's link, mark, and one-liner from the portfolio facts.
const related = (id: PortfolioProductId, name: string) => {
  const { canonicalUrl, mark, oneLiner } = product(id);
  return { href: canonicalUrl, mark, name, role: oneLiner };
};

const HERO_BOUNDARY = `${SITE_STATUS_LABEL} · macOS · iMessage, WhatsApp, and Beeper · runs from source · new installs start paused`;

type HomeQuestion = Readonly<{ question: string; answer: string; link?: Readonly<{ href: string; label: string }> }>;

const HOME_QUESTIONS: readonly HomeQuestion[] = [
  {
    question: 'Does it read all my messages?',
    answer: 'It acts only in the one-to-one chats you turn on, and only when asked. Your notes about each person are plain files on your Mac. With a local model, the reply is written on your Mac too.',
  },
  {
    question: 'Will people know it’s not me?',
    answer: 'Yes. Everything it sends is wrapped in 🤖{ }, including the 👀. You can remove the marker for one person, never in your own chat.',
  },
  {
    question: 'Which AI writes the replies?',
    answer: `${REPLY_WRITERS_SENTENCE} ${REPLY_WRITERS_PRECEDENCE} Through xcb, the model can’t run commands on your Mac.`,
  },
  {
    question: 'What does it cost?',
    answer: 'Textbutler is free and open source. A local model costs nothing to run. With a Gateway key, Vercel bills you, and Textbutler stops spending at $1 a day. With a subscription, it uses the plan you already pay for. Textbutler AI credits, for people without a key of their own, are coming soon and can’t be bought yet.',
  },
  {
    question: 'Do I need Ollama?',
    answer: 'No. Ollama is one of three options. If you already run it with qwen3:4b-instruct-2507-q4_K_M pulled and no Gateway key is saved, Textbutler picks it up when its background service starts, or you can choose it with textbutler providers local. Otherwise paste a Vercel AI Gateway key or connect your Claude Code, Codex, or Devin subscription through xcb.',
  },
  {
    question: 'Does it work on my iPhone?',
    answer: 'Your friends and your phone see the messages as usual. Textbutler itself runs only on a Mac that’s awake and signed in. There’s no iPhone, Windows, or Linux version.',
  },
  {
    question: 'Does it answer in group chats?',
    answer: 'No. It ignores group chats, reactions, and old messages, and answers one person at a time in the one-to-one chats you turn on. SMS and RCS aren’t supported.',
  },
  {
    question: 'Can I read a reply before it goes out?',
    answer: 'Yes. Ask for a draft instead of an automatic reply. The draft shows every word and who it goes to, and it sends exactly that only when you confirm it with its review code. Drafts expire after 15 minutes. You can also type your own reply from the guided terminal.',
  },
  {
    question: 'How is it different from Smart Reply, GhostReply, or OpenClaw?',
    answer: 'Smart Reply in Apple Messages and Writing Help in WhatsApp suggest replies that you send yourself. GhostReply is a $4.99 Mac app that answers iMessages in your texting style. OpenClaw is an open-source assistant you message, and it can run commands on your computer. Textbutler answers only the people you turn on, when they ask, marks its replies by default, keeps notes on each person in files you can edit, and its model can’t run commands on your Mac. If you only want suggestions, the built-in features are simpler.',
    link: { href: '/compare/ghostreply', label: 'Textbutler compared with GhostReply' },
  },
  {
    question: 'What about Telegram and Signal?',
    answer: 'Through Beeper, text only. Telegram’s terms limit AI use of message content, so ask the person first.',
  },
  {
    question: 'Is textbutler.app collecting anything?',
    answer: 'Only anonymous visit counts. textbutler.app counts page views and a few clicks, such as copying the setup prompt, with PostHog. It sets no cookies, doesn’t identify you, and doesn’t record sessions. It has no message upload, contact import, account, or drafting form, and it never sees your messages. Your Mac keeps each person’s notes. When you choose a hosted AI option, it handles the context it receives under its own data policies.',
  },
  {
    question: 'What happened to Message Like Me?',
    answer: 'Textbutler replaced it. Its history readers and methodology are still available as legacy tools on the legacy history page. Installing them doesn’t install Textbutler or turn on automatic replies.',
  },
];

const CREDITS_CHIP: SupportChip = 'Coming';

function Chip({ children }: Readonly<{ children: SupportChip }>) {
  const tone = children === 'Works today'
    ? 'ok'
    : children === 'Not supported' ? 'off' : 'caution';
  return <span className="tb-chip" data-tone={tone}>{children}</span>;
}

function TerminalProof() {
  return (
    <MarketingProofFrame caption="First run on a new install" className="tb-terminal" title="Terminal">
      <pre aria-label="The guided terminal's first screen" tabIndex={0}><SyntaxCode code="$ bun run textbutler tui" language="shell" styles="classes" />{'\n\n'}<SyntaxCode code={TERMINAL_FIRST_RUN.join('\n')} language="text" styles="classes" /></pre>
    </MarketingProofFrame>
  );
}

function HeroStage() {
  return (
    <figure className="tb-hero-stage">
      <div className="tb-hero-stage__device">
        <PhoneSlot conversation={heroConversation} maxWidth={380} play />
      </div>
      <ul aria-label="What the example shows" className="tb-callouts">
        <li>Maya says “butler”</li>
        <li>🤖{'{ 👀 }'} means it’s on it</li>
        <li>The answer comes from this chat</li>
        <li>Every butler message is marked</li>
      </ul>
      <figcaption className="tb-caption">Example conversation on Sam’s iPhone. Textbutler runs on Sam’s Mac; the people are made up.</figcaption>
    </figure>
  );
}

function FilmSlot() {
  const sources = launchFilmSources();
  if (sources === null) return null;
  return (
    <section aria-labelledby="film-title" className="tb-film" id="film">
      <h2 className="tb-film__title" id="film-title">Textbutler in {LAUNCH_FILM_SECONDS} seconds</h2>
      <LaunchVideo sources={sources} title="AI in your messages" />
      <p className="tb-caption">No sound needed. Every name in the film is made up.</p>
    </section>
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
            actions={[{ href: '#setup', label: 'Have your agent set it up' }, { href: '#how-it-works', label: 'See how it works', emphasis: 'secondary' }]}
            boundary={HERO_BOUNDARY}
            className="mlm-marketing-hero tb-hero"
            eyebrow="iMessage and WhatsApp today, more apps through Beeper, on Mac"
            frame={<HeroStage />}
            heading={SITE_HEADLINE}
            headingId="textbutler-title"
            name="Textbutler"
            summary="When someone you’ve turned on texts “butler”, a clearly marked AI assistant answers for you from your Mac. It writes with a local model or the AI subscription you already pay for. Claude Code, Codex, or Devin can set it up for you."
          />

          <section aria-labelledby="status-title" className="tb-status-band" id="status">
            <h2 className="tb-status-band__label" id="status-title">Where it stands</h2>
            <p className="tb-status">{SITE_STATUS}</p>
          </section>

          <MarketingSection heading="From “butler” to a marked reply." headingId="how-title" id="how-it-works" label="How it works" summary="Most of the time, it does nothing. When someone you’ve turned on asks for it, it says so right away, reads your notes and your chat, and answers in a bubble nobody could mistake for you.">
            <DiagramFigure alt="One message, start to finish: a friend’s message reaches Ghostget on your Mac, passes five checks, gets a 🤖{ 👀 } right away, then your notes and the chat are read, your chosen model writes, and a marked reply goes back." className="tb-diagram--wide-only" name={DIAGRAMS.oneMessage} />
            <MarketingFlow ariaLabel="What happens to one message" steps={HOW_IT_WORKS_STEPS} />
            <dl className="tb-modes" aria-label="When it answers">
              {REPLY_MODES.map((mode) => (
                <div key={mode.term}>
                  <dt>{mode.term}{'badge' in mode ? <span className="tb-chip" data-tone="ok">{mode.badge}</span> : null}</dt>
                  <dd>{mode.detail}</dd>
                </div>
              ))}
            </dl>
          </MarketingSection>

          <FilmSlot />

          <MarketingSection heading="What it works with" headingId="supports-title" id="supports" label="Supports" summary="Connect your messaging apps and choose which conversations it can answer.">
            <div className="tb-support">
              <div className="tb-support__block">
                <h3>Messaging apps</h3>
                <ul className="tb-support__list">
                  {MESSAGING_APPS.map((app) => (
                    <li key={app.name}>
                      <div className="tb-support__head"><strong>{app.name}</strong><Chip>{app.chip}</Chip></div>
                      {app.networks === undefined ? null : <p className="tb-support__networks">{app.networks}</p>}
                      <p>{app.gets}</p>
                      <p className="tb-support__limit">{app.limits}</p>
                    </li>
                  ))}
                </ul>
                <p className="tb-fine">Messages reach Textbutler through Ghostget, a separate Mac tool you install first. <a href={GHOSTGET_SETUP_URL}>Set up Ghostget</a></p>
              </div>
              <div className="tb-support__block">
                <h3>Your Mac</h3>
                <ul className="tb-support__list">
                  <li><div className="tb-support__head"><strong>Mac only</strong></div><p>It runs quietly in the background, with no window and no menu bar icon. There’s no iPhone, Windows, or Linux version.</p></li>
                  <li><div className="tb-support__head"><strong>Built on your Mac</strong></div><p>Setup builds a small helper app on your Mac so macOS can grant iMessage access. The helper has no window.</p></li>
                  <li><div className="tb-support__head"><strong>Open source</strong></div><p>MIT licensed, and it runs from source with Bun.</p></li>
                  <li><div className="tb-support__head"><strong>Nothing sent to this site</strong></div><p>This website never receives your messages.</p></li>
                </ul>
              </div>
            </div>
          </MarketingSection>

          <MarketingSection heading="Pick what writes replies" headingId="models-title" id="models" label="Reply writers" summary={REPLY_WRITERS_SENTENCE}>
            <ol className="tb-writers" aria-label="Reply writers, pick one">
              {REPLY_WRITERS.map((writer) => (
                <li className="tb-writer" data-writer={writer.id} key={writer.id}>
                  <div className="tb-writer__head">
                    <h3>{writer.name}</h3>
                    <Chip>{writer.chip}</Chip>
                  </div>
                  {writer.id === 'key' ? <p className="provider-marks"><ProviderMarkChip mark="qwen" size={20} /></p> : null}
                  {writer.id === 'subscription' ? <p className="provider-marks"><ProviderMarkChip mark="claudecode" size={20} /><ProviderMarkChip mark="codex" size={20} /><ProviderMarkChip mark="devin" size={20} /></p> : null}
                  <CodeBlock code={writer.command} />
                  <dl className="tb-writer__facts">
                    <div><dt>What leaves your Mac</dt><dd>{writer.leaves}</dd></div>
                    <div><dt>Good to know</dt><dd>{writer.note}</dd></div>
                  </dl>
                </li>
              ))}
            </ol>
            <p className="tb-writer-coming"><Chip>{CREDITS_CHIP}</Chip> <span>{REPLY_CREDITS_NOTE}</span></p>
            <p className="tb-fine">{REPLY_WRITERS_PRECEDENCE} Setup installs a local copy of Textbutler on your Mac (<code>bun run textbutler:install</code>). That copy writes the AI replies, and it refuses to build if its code doesn’t match the last reviewed version. <a href={SUBSCRIPTION_GUIDE_URL}>Connect a subscription through xcb</a></p>
            <DiagramSwitch label="Show where your words go with" options={[
              { label: 'Local', caption: 'Local model: the reply is written on your Mac. In testing.', panel: <DiagramFigure alt="Where your words go with a local model: Ghostget, Textbutler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply. Vercel AI Gateway is used only with your key, xcb only with your subscription, and web search only with your key." name={DIAGRAMS.whereWordsGo} /> },
              { label: 'Your key', caption: 'Your Gateway key: the conversation context goes to Vercel AI Gateway, and spending stops at $1 a day.', panel: <DiagramFigure alt="Where your words go with your Vercel AI Gateway key: Qwen 3.5 Flash writes the reply, and one arrow leaves your Mac for Vercel AI Gateway." name={DIAGRAMS.whereWordsGoKey} /> },
              { label: 'Your subscription', caption: 'Your subscription: the conversation context goes through xcb to your Claude Code, Codex, or Devin account.', panel: <DiagramFigure alt="Where your words go with your subscription: your Claude Code, Codex, or Devin account writes the reply, and one arrow leaves your Mac through xcb." name={DIAGRAMS.whereWordsGoSubscription} /> },
            ]} />
          </MarketingSection>

          <MarketingSection heading="Your agent sets it up. You stay in charge." headingId="setup-title" id="setup" label="Setup" summary="Paste this prompt into your coding agent. It follows the setup guide and stops when you need to grant access, sign in, or choose a contact.">
            <ol className="tb-setup-steps">
              {SETUP_STEPS.map((step) => (
                <li key={step.label}><h3>{step.label}</h3><p>{step.detail}</p></li>
              ))}
            </ol>
            <figure className="tb-prompt">
              <figcaption className="tb-prompt__bar">
                <span>Paste into Claude Code, Codex, or Devin</span>
                <CopyButton analyticsTarget="agent-setup-prompt" label="Copy prompt" text={AGENT_SETUP_PROMPT} />
              </figcaption>
              <pre aria-label="Setup prompt for your coding agent" tabIndex={0}><code>{AGENT_SETUP_PROMPT}</code></pre>
            </figure>
            <p className="tb-fine">You’ll need a Mac, Bun 1.3.14, and Ghostget. There’s no one-line installer and no Textbutler setup skill yet (coming), so your agent follows the <a href={GETTING_STARTED_URL}>written guide</a>. Permission switches, pairing, and pasting a key are always yours to do.</p>
            <DiagramFigure alt="Who does what. Your agent clones and installs Textbutler, connects your apps, and runs textbutler doctor. You turn on the Full Disk Access switch, allow Messages, pair WhatsApp or Beeper if you use them, pick what writes replies, and turn on one person." name={DIAGRAMS.whoDoesWhat} />
            <div className="tb-setup-extra">
              <div>
                <h3>Prefer to do it yourself?</h3>
                <p><code>$ bun run textbutler tui</code> walks you through the same steps, one screen at a time.</p>
                <details className="tb-details"><summary>See the first terminal screen</summary><TerminalProof /></details>
              </div>
              <div className="tb-tile">
                <h3>Your agent speaks its language</h3>
                <p>The JSON command line lets your agent list conversations, summarize a thread, draft a reply, and send it only with the review code that draft shows.</p>
                <CodeBlock code={'textbutler conversations list\ntextbutler replies suggest CONTACT\ntextbutler replies show DRAFT\ntextbutler replies send DRAFT DIGEST'} />
                <a href={AGENT_CLI_URL}>Read the agent CLI guide</a>
              </div>
            </div>
          </MarketingSection>

          <MarketingSection heading="You stay in charge" headingId="control-title" id="control" label="Control" summary="An assistant in your messages only works if it knows when to stay out of them.">
            <div className="tb-pillars">
              <article>
                <h3>It’s there when you aren’t.</h3>
                <p>It answers the people you choose, when they ask, in the chats they already use.</p>
                <p className="tb-proof">Marked automatic replies have worked end to end over iMessage in our testing. 👀 goes out first. It stays out of group chats.</p>
              </article>
              <article>
                <h3>It never pretends to be you.</h3>
                <p>Everything it sends is wrapped in <code>{'🤖{ }'}</code>, including the 👀.</p>
                <p className="tb-proof">The marker is on by default. You can remove it only per person, and never in your own chat. New installs start paused, every person starts off, and setup never sends a message. <code>textbutler pause</code> stops everything, and <code>textbutler contacts disable</code> turns one person off.</p>
              </article>
              <article>
                <h3>It runs on your Mac.</h3>
                <p>No server of ours sits in the middle. Your notes about each person are plain files you can read and edit. With a local model, the reply is written on your Mac too (in testing).</p>
                <p className="tb-proof">Gateway spending stops at $1 a day. Web search needs a saved Gateway key, and it refuses any search that reuses words from your private messages. Through <a href={XCB_URL}>xcb</a>, the model can’t run commands on your Mac.</p>
              </article>
            </div>
            <div className="tb-examples">
              <figure className="tb-example">
                <PhoneSlot conversation={staysOutConversation} crop={560} />
                <figcaption>
                  <span className="tb-chip" data-tone="caution">WhatsApp · not yet tested live</span>
                  <span>Jordan asks right after Sam wrote, so the butler stays out of it. It waits 5 minutes after you last wrote, and skips requests in that window rather than saving them.</span>
                </figcaption>
              </figure>
              <figure className="tb-example">
                <PhoneSlot conversation={boundariesConversation} crop={560} />
                <figcaption>
                  <span className="tb-chip" data-tone="caution">via Beeper · text only</span>
                  <span>You set what’s off-limits for each person. It keeps to it.</span>
                </figcaption>
              </figure>
              <figure className="tb-example tb-example--folder">
                <div className="workspace-example"><pre aria-label="Example contact folder" tabIndex={0}><code>{`contact/\n├── AGENTS.md   standing instructions\n├── ABOUT.md    what matters here\n├── MEMORY.md   dated, sourced notes\n├── STYLE.md    how it talks here\n├── history/\n├── notes/\n├── attachments/\n└── outbox/`}</code></pre></div>
                <figcaption>
                  <strong>Each person gets their own folder.</strong>
                  <span>Your notes on how you talk, what matters, and what’s off-limits, in plain files you can edit. Your settings and sign-ins live elsewhere, where the butler can’t edit them. Optional learning (off by default; it needs a Claude Code subscription through xcb) can remember up to 64 sourced notes and adjust tone per chat; <code>textbutler habitats show</code> lists them and <code>textbutler habitats memory-clear</code> removes them. <a href={`${ARCHITECTURE_URL}#contact-data`}>How contact folders work</a></span>
                </figcaption>
              </figure>
            </div>
          </MarketingSection>

          <MarketingSection heading="Ask it yourself" headingId="self-title" id="ask-yourself" label="Your own chat" layout="split" summary="Say “butler” in your own chat and it works for you, searching that chat’s history. The marker can’t be turned off here.">
            <figure className="tb-example tb-example--solo">
              <PhoneSlot conversation={askYourselfConversation} crop={640} maxWidth={340} />
              <figcaption className="tb-caption">Example conversation. The details are made up.</figcaption>
            </figure>
          </MarketingSection>

          <MarketingQuestionList className="mlm-marketing-questions" heading="Questions" headingId="questions-title" id="questions" label="FAQ" questions={HOME_QUESTIONS.map(({ answer, link, question }) => ({ answer: link ? <><p>{answer}</p><p><Link href={link.href}>{link.label}</Link></p></> : <p>{answer}</p>, question }))} />
          <MarketingRelated heading="From the same workshop" headingId="related-title" label="Related" summary="More Hraness tools that work on your Mac and keep the agent’s access limited." groups={[
            {
              heading: 'The personal apps',
              headingId: 'related-apps',
              items: [related('peopleblade', 'PeopleBlade'), related('soulscrape', 'Soulscrape'), related('kb', 'Wordcell')],
            },
            {
              heading: 'The agent platform',
              headingId: 'related-tools',
              summary: 'The connections, subscription, and model comparisons around the butler.',
              items: [related('wrench', 'Ghostget'), related('xcb', 'xcb'), related('aicharts', 'AI Charts')],
            },
          ]} />
          <MarketingCallToAction actions={[{ href: '#setup', label: 'Have your agent set it up' }, { href: GETTING_STARTED_URL, label: 'Read the setup guide', emphasis: 'secondary' }]} className="mlm-marketing-cta" footnote={HERO_BOUNDARY} heading="Start with one person" headingId="closing-title" id="closing" summary="Paste the prompt, approve what your Mac asks for, and turn on someone who knows you’re trying it. Everyone else stays off." />
          <p className="legacy-note">Looking for the Message Like Me history tools? <Link href="/sources">View legacy history sources.</Link></p>
        </MarketingPage>
      </main>
      <SiteFooter path="/" />
    </div>
  );
}
