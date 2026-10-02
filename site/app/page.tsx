import { marketing, marketingHeading } from "../portfolio-copy";
import {
  MarketingActionLink,
  MarketingCallToAction,
  MarketingCardRow,
  MarketingFlow,
  MarketingPage,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingRelated,
  MarketingSection,
  ProductHero,
  ProviderMark,
  ProviderMarkChip,
  SyntaxCode,
} from '@hraness/design-kit/react/server';
import { portfolioRelatedGroups } from '@hraness/design-kit/portfolio';
import { agentSetupTargets } from '@hraness/design-kit';
import Link from 'next/link';
import { Fragment } from 'react';

import { AgentSetup } from './_components/landing/agent-setup';
import { PhoneSlot } from './_components/landing/phone-slot';
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
} from './_lib/landing';
import {
  AGENT_CLI_URL,
  AGENT_SETUP_PROMPT,
  ARCHITECTURE_URL,
  GETTING_STARTED_URL,
  GHOSTGET_SETUP_URL,
  pageMetadata,
  REPLY_WRITERS_PRECEDENCE,
  REPLY_WRITERS_SENTENCE,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_HEADLINE,
  SITE_STATUS,
  SITE_TITLE,
  SUBSCRIPTION_GUIDE_URL,
} from './_lib/site';
import { TERMINAL_FIRST_RUN } from './_lib/terminal';
import { AgentMockup } from './mockups';

const agentTargets = agentSetupTargets(AGENT_SETUP_PROMPT).filter((target) => target.host === 'local');

export const metadata = pageMetadata({
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  path: '/',
});

const HERO_BOUNDARY = 'For macOS. New installs start paused until you choose which chats it can answer.';

type HomeLink = Readonly<{ href: string; label: string }>;
type HomeQuestion = Readonly<{ question: string; answer: string; links?: readonly HomeLink[] }>;

const HOME_QUESTIONS: readonly HomeQuestion[] = [
  {
    question: 'Does it read all my messages?',
    answer: 'It answers only in conversations you turn on. In Keyword mode it waits for “butler”; in Smart mode it can recognize a request for help without the keyword. Each conversation’s notes stay on your Mac, and a local model writes replies there too. Optional web search sends queries through your saved Gateway key.',
  },
  {
    question: 'Will people know it’s not me?',
    answer: 'Yes, by default. Replies and acknowledgments carry the 🤖{ } marker. You can change or remove it for one person at a time, but your own chat always keeps a visible marker.',
  },
  {
    question: 'Which AI writes the replies?',
    answer: `${REPLY_WRITERS_SENTENCE} ${REPLY_WRITERS_PRECEDENCE} Through xcb, the model can’t run commands on your Mac.`,
  },
  {
    question: 'What does it cost?',
    answer: 'TextButler is free and MIT licensed. Local replies have no model API bill. With a Gateway key, Vercel bills you, and TextButler stops spending at $1 a day. With a subscription, it uses the plan you already pay for.',
  },
  {
    question: 'Do I need Ollama?',
    answer: 'No. Choose Ollama for local replies, use a Vercel AI Gateway key, or connect your Claude Code, Codex, or Devin subscription through xcb.',
  },
  {
    question: 'Does it work on my iPhone?',
    answer: 'Replies show up on your iPhone and your friends’ phones as usual, but TextButler itself runs only on a Mac that’s awake and signed in. There’s no iPhone, Windows, or Linux version.',
  },
  {
    question: 'Does it answer in group chats?',
    answer: 'Yes. Choose a group, review its members, and turn on replies. Each group gets its own editable notes, starting with new messages after setup. If the account or members change, select the group again before replies resume.',
  },
  {
    question: 'Can I read a reply before it goes out?',
    answer: 'Yes. Ask for a draft instead of an automatic reply. The draft shows every word and who it goes to, and nothing is sent until you confirm it with its review code. Drafts expire after 15 minutes. You can also type your own reply in the guided terminal.',
  },
  {
    question: 'How is it different from Smart Reply, GhostReply, or OpenClaw?',
    answer: 'Smart Reply in Apple Messages and Writing Help in WhatsApp suggest replies that you send yourself. GhostReply is a paid Mac app that answers iMessages in your texting style. OpenClaw is an open-source assistant you message, and it can run commands on your computer. TextButler answers only in the conversations you turn on, keeps notes you can edit for each one, and its reply model can’t run commands on your Mac. It marks replies as AI by default, and you control the reply mode and marker per conversation.',
    links: [
      { href: '/compare/openclaw', label: 'TextButler compared with OpenClaw' },
      { href: '/compare/ghostreply', label: 'TextButler compared with GhostReply' },
      { href: '/compare', label: 'All comparisons' },
    ],
  },
  {
    question: 'What about Telegram and Signal?',
    answer: 'Connect them through Beeper Desktop for text replies. Keep Beeper open, and check each service’s terms before using AI with its messages.',
  },
  {
    question: 'Is textbutler.app collecting anything?',
    answer: 'Only anonymous visit counts. textbutler.app counts page views, page load speed, and a few clicks, such as copying the setup prompt, with PostHog. It sets no cookies, doesn’t identify you, and doesn’t record sessions. The site has no upload, account, or form, and it never sees your messages. If you choose a hosted AI option, that provider handles the context it receives under its own data policies.',
  },
];

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
        <PhoneSlot conversation={heroConversation} crop={760} maxWidth={400} play />
      </div>
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
        <MarketingPage className="tb-page textbutler-page">
          <ProductHero
            backdrop={false}
            align="start"
            layout="split"
            actions={[{ href: '#setup', label: marketing.hero.primaryAction, emphasis: 'secondary' }]}
            className="tb-marketing-hero tb-hero"
            frame={<HeroStage />}
            heading={SITE_HEADLINE}
            headingId="textbutler-title"
            name=""
            summary={marketing.hero.summary}
          />

          <section aria-labelledby="status-title" className="tb-status-band" id="status">
            <h2 className="tb-status-band__label" id="status-title">On your Mac</h2>
            <p className="tb-status">{SITE_STATUS}</p>
          </section>

          <MarketingSection heading={marketingHeading("models-title")} headingId="models-title" id="models" label="Reply writers" summary={REPLY_WRITERS_SENTENCE}>
            <ol className="tb-writers" aria-label="Reply writers, pick one">
              {REPLY_WRITERS.map((writer) => (
                <li className="tb-writer" data-writer={writer.id} key={writer.id}>
                  <div className="tb-writer__head">
                    {writer.id === 'subscription' ? null : <ProviderMark mark={writer.id === 'local' ? 'ollama' : 'vercel'} size={48} tone="solid" />}
                    <h3>{writer.name}</h3>
                  </div>
                  {writer.id === 'key' ? <p className="provider-marks"><ProviderMarkChip mark="qwen" size={32} /></p> : null}
                  {writer.id === 'subscription' ? <p className="provider-marks"><ProviderMarkChip mark="claudecode" size={36} /><ProviderMarkChip mark="codex" size={36} /><ProviderMarkChip mark="devin" size={36} /></p> : null}
                  <p>{writer.note}</p>
                  <p className="tb-fine">{writer.leaves}</p>
                </li>
              ))}
            </ol>
            <p className="tb-fine"><a href={SUBSCRIPTION_GUIDE_URL}>Connect your AI subscription</a> or follow the <a href={GETTING_STARTED_URL}>model setup guide</a>.</p>
          </MarketingSection>

          <MarketingSection heading={marketingHeading("setup-title")} headingId="setup-title" id="setup" label="Setup" summary="Paste this prompt into your coding agent. It follows the setup guide and stops when you need to grant access, sign in, or choose a contact.">
            <ol className="tb-setup-steps">
              {SETUP_STEPS.map((step) => (
                <li key={step.label}><h3>{step.label}</h3><p>{step.detail}</p></li>
              ))}
            </ol>
            <AgentSetup targets={agentTargets} />
            <figure className="tb-agent-demo">
              <AgentMockup />
            </figure>
            <p className="tb-fine">You’ll need a Mac and a coding agent to follow the <a href={GETTING_STARTED_URL}>setup guide</a>.</p>
            <div className="tb-setup-extra">
              <div id="install">
                <h3>{marketingHeading("prefer-to-do-it-yourself")}</h3>
                <p>Connect your chats in the guided terminal, one screen at a time.</p>
                <MarketingActionLink href={GETTING_STARTED_URL} label="Open setup guide" />
                <details className="tb-details"><summary>See the first terminal screen</summary><TerminalProof /></details>
              </div>
              <div className="tb-tile">
                <h3>{marketingHeading("your-agent-speaks-its-language")}</h3>
                <p>Ask your agent to find a conversation, summarize it, or prepare a reply for your review.</p>
                <a href={AGENT_CLI_URL}>Read the agent guide</a>
              </div>
            </div>
          </MarketingSection>

          <MarketingSection heading={marketingHeading("supports-title")} headingId="supports-title" id="supports" label="Supports" summary="Connect your messaging apps and choose which conversations it can answer.">
            <div className="tb-support">
              <div className="tb-support__block">
                <h3>{marketingHeading("messaging-apps")}</h3>
                <MarketingCardRow
                  ariaLabel="Messaging apps"
                  columns={1}
                  cards={MESSAGING_APPS.map((app) => ({
                    icon: <ProviderMark mark={app.name} size={56} tone="solid" />,
                    title: app.name,
                    meta: <span className="tb-support__copy">
                      {app.networks === undefined ? null : <span className="tb-support__networks">{app.networks}</span>}
                      <span>{app.gets}</span>
                      <small className="tb-support__limit">{app.limits}</small>
                    </span>,
                  }))}
                />
                <p className="tb-fine">GhostGet connects your messaging apps. Your agent can set it up with TextButler. <a href={GHOSTGET_SETUP_URL}>Messaging setup guide</a></p>
              </div>
              <div className="tb-support__block">
                <h3>{marketingHeading("your-mac")}</h3>
                <ul className="tb-support__list">
                  <li><div className="tb-support__head"><strong>Mac only</strong></div><p>It runs in the background, with no window and no menu bar icon. There’s no iPhone, Windows, or Linux version.</p></li>
                  <li><div className="tb-support__head"><strong>Open source</strong></div><p>Free and MIT licensed.</p></li>
                  <li><div className="tb-support__head"><strong>Nothing sent to this site</strong></div><p>This website never receives your messages.</p></li>
                </ul>
              </div>
            </div>
          </MarketingSection>

          <MarketingSection heading={marketingHeading("how-title")} headingId="how-title" id="how-it-works" label="How it works" summary="In an enabled conversation, TextButler checks whether to answer, reads the conversation’s notes and recent messages, and asks your chosen model to write a reply.">
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

          <MarketingSection heading={marketingHeading("control-title")} headingId="control-title" id="control" label="Control" summary="An assistant in your messages only works if it knows when to stay out of them.">
            <div className="tb-feature-sections">
              <MarketingSection
                className="tb-feature"
                heading={marketingHeading("it-s-there-when-you-aren-t")}
                headingId="control-availability-title"
                headingLevel={3}
                layout="split"
                summary="It answers in conversations you enable, using your chosen reply mode."
                headingContent={<p className="tb-proof">By default, Keyword mode waits for “butler”. Smart mode can recognize a request for help without the keyword. After you write in a chat, it pauses for the human cooldown you set (5 minutes by default).</p>}
              >
                <PhoneSlot conversation={staysOutConversation} crop={560} />
              </MarketingSection>
              <MarketingSection
                className="tb-feature"
                heading={marketingHeading("it-never-pretends-to-be-you")}
                headingId="control-marker-title"
                headingLevel={3}
                layout="split-reverse"
                summary="You choose how it speaks and what’s off-limits for each conversation."
                headingContent={<><p>The default marker wraps replies and acknowledgments in <code>{'🤖{ }'}</code>.</p><p className="tb-proof">You can change or remove it per conversation, but your own chat always keeps a visible marker. New installs start paused and every conversation starts off. You can pause all replies or turn off one conversation at any time.</p></>}
              >
                <PhoneSlot conversation={boundariesConversation} crop={560} />
              </MarketingSection>
              <MarketingSection
                className="tb-feature"
                heading={marketingHeading("it-runs-on-your-mac")}
                headingId="control-memory-title"
                headingLevel={3}
                layout="split"
                summary="Your notes for each conversation are plain files you can read and edit. A local model writes replies on your Mac too."
                headingContent={<><p className="tb-proof">Settings and sign-ins live separately. Optional learning starts off; you can review or clear what it remembers. <a href={`${ARCHITECTURE_URL}#contact-data`}>How contact folders work</a></p><p className="tb-fine">Gateway spending stops at $1 a day. Hosted AI receives the conversation context it needs. Optional web search sends queries through your saved Gateway key.</p></>}
              >
                <div className="workspace-example"><pre aria-label="Example contact folder" tabIndex={0}><code>{`contact/\n├── AGENTS.md   standing instructions\n├── ABOUT.md    what matters here\n├── MEMORY.md   dated, sourced notes\n├── STYLE.md    how it talks here\n├── history/\n├── notes/\n├── attachments/\n└── outbox/`}</code></pre></div>
              </MarketingSection>
            </div>
          </MarketingSection>

          <MarketingSection heading={marketingHeading("self-title")} headingId="self-title" id="ask-yourself" label="Your own chat" layout="split" summary="Say “butler” in your own chat and it works for you, searching that chat’s history. The marker can’t be turned off here.">
            <figure className="tb-example tb-example--solo">
              <PhoneSlot conversation={askYourselfConversation} crop={640} maxWidth={340} />
            </figure>
          </MarketingSection>

          <MarketingQuestionList className="tb-marketing-questions" heading={marketingHeading("questions-title")} headingId="questions-title" id="questions" label="FAQ" questions={HOME_QUESTIONS.map(({ answer, links, question }) => ({ answer: links ? <><p>{answer}</p><p>{links.map((link, index) => <Fragment key={link.href}>{index > 0 ? ' · ' : null}<Link href={link.href}>{link.label}</Link></Fragment>)}</p></> : <p>{answer}</p>, question }))} />
          <MarketingRelated
            groups={portfolioRelatedGroups(["peopleblade", "soulscrape", "kb", "wrench", "xcb", "aicharts"])}
            heading="Other tools from our studio"
            headingId="related-title"
          />
          <MarketingCallToAction actions={[{ href: '#setup', label: marketing.hero.primaryAction }, { href: GETTING_STARTED_URL, label: 'Read the setup guide', emphasis: 'secondary' }]} className="tb-marketing-cta" footnote={HERO_BOUNDARY} heading={marketingHeading("closing-title")} headingId="closing-title" id="closing" summary="Ask your agent to set up TextButler, then choose a conversation and review the first reply." />
        </MarketingPage>
      </main>
      <SiteFooter path="/" />
    </div>
  );
}
