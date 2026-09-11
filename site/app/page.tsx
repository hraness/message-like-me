import {
  MarketingCallToAction,
  MarketingFlow,
  MarketingPage,
  MarketingProofFrame,
  MarketingQuestionList,
  MarketingSection,
  MarketingTrustBoundary,
  ProductHero,
} from '@hraness/design-kit/react/server';
import Link from 'next/link';

import { SiteFooter, SiteHeader } from './_components/site-chrome';
import {
  ARCHITECTURE_URL,
  GITHUB_URL,
  pageMetadata,
  RELEASE_URL,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SOFTWARE_VERSION,
} from './_lib/site';

export const metadata = pageMetadata({
  title: 'Textbutler — Your personal message butler for Mac',
  description: SITE_DESCRIPTION,
  path: '/',
});

const HERO_FOOTNOTE = 'In development · macOS · bring your own coding agent';
const HOME_QUESTIONS = [
  {
    question: 'Can I use Textbutler today?',
    answer: 'The source includes the Mac control panel, local daemon controls, contact workspaces, and response-policy foundations. Live automatic replies are disabled while the Ghostget transport and agent execution are qualified. A signed Mac download is not available yet.',
  },
  {
    question: 'Will it interrupt my conversations?',
    answer: 'Smart response is designed to wait through message bursts and yield while you are actively talking. A cheap classifier can choose whether a response is helpful, but global pause, contact settings, owner activity, and rate limits take precedence. Keyword-only mode is also available.',
  },
  {
    question: 'Will people know the butler is responding?',
    answer: 'Yes. The butler speaks as an assistant, with every text reply wrapped in a visible disclosure. The default is 🤖{ hello this is my response }. You can change the character, opening symbol, and closing symbol separately for each contact.',
  },
  {
    question: 'What can the agent access?',
    answer: 'The intended agent boundary is one contact folder, public web requests, and the messaging actions offered for that conversation. Shell commands, other contact folders, account credentials, and permission changes are outside that boundary. Live operation stays disabled until the selected provider can enforce it.',
  },
  {
    question: 'Does this website receive my messages?',
    answer: 'No. textbutler.app is informational and has no message upload, contact import, account, or drafting form. The Mac stores contact context locally. When you choose a hosted coding agent, that provider handles the context it receives under its own data policies.',
  },
  {
    question: 'Which rich message features will work?',
    answer: 'Files and reactions have explicit places in the transport design. Stickers and iMessage apps remain unavailable until a transport proves support. The app shows negotiated capabilities, so unsupported features are visible. No Linq integration or iMessage mini-app support is claimed as available.',
  },
  {
    question: 'What happened to Message Like Me?',
    answer: `Textbutler is the new product direction. Message Like Me’s history readers, evidence methodology, and published v${SOFTWARE_VERSION} artifacts remain available as legacy tools. Installing that package does not install the Textbutler Mac app or enable automatic replies.`,
  },
] as const;

function ButlerFrame() {
  return (
    <MarketingProofFrame
      caption="Synthetic illustration of the intended experience. No real messages, live agent run, or sent reply is shown."
      credit="Contact context → a clearly identified assistant"
    >
      <div className="butler-frame" aria-label="Synthetic contact context and disclosed reply">
        <div className="butler-context">
          <div className="butler-context-heading"><span className="contact-initials">AM</span><div><strong>Alex Morgan</strong><span>Example contact folder</span></div></div>
          <dl className="context-files">
            <div><dt>ABOUT.md</dt><dd>What matters in this relationship.</dd></div>
            <div><dt>MEMORY.md</dt><dd>Useful context, with sources and dates.</dd></div>
            <div><dt>STYLE.md</dt><dd>How to help in this conversation.</dd></div>
            <div><dt>AGENTS.md</dt><dd>Guidance the butler can read and revise.</dd></div>
          </dl>
          <p>You can open and edit every note.</p>
        </div>
        <div className="message-stage">
          <p className="stage-label">Example conversation</p>
          <div className="bubble bubble-in">butler, can you help me make a packing list?</div>
          <p className="stage-label stage-label--draft">Butler reply · illustration</p>
          <div className="bubble bubble-out">{'🤖{ Happy to help. Where are you headed, and for how long? }'}</div>
          <p className="butler-disclosure-note">Always recognizable. Never pretending to be you.</p>
        </div>
      </div>
    </MarketingProofFrame>
  );
}

export default function Home() {
  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: HOME_QUESTIONS.map(({ question, answer }) => ({ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } })) };
  return (
    <>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faq) }} />
        <MarketingPage className="mlm-page textbutler-page">
          <ProductHero
            actions={[{ href: '#development', label: 'See what’s ready' }, { href: ARCHITECTURE_URL, label: 'Explore the architecture' }]}
            boundary={HERO_FOOTNOTE}
            className="mlm-marketing-hero"
            eyebrow=""
            frame={<ButlerFrame />}
            heading="A little help in your conversations"
            headingId="textbutler-title"
            name="Textbutler"
            summary="Give a few people access to your personal message butler. Choose your coding agent, give each contact a folder of context, and decide when it can step in. Built for your Mac, with you in control."
          />

          <MarketingSection heading="A butler for each relationship" headingId="contacts-title" id="how-it-works" label="" summary="Choose the contacts it can help. Keep their context separate. Pause one conversation or every conversation whenever you need.">
            <MarketingFlow ariaLabel="How contact-based assistance is designed to work" steps={[
              { label: 'Choose a contact', detail: 'Activation is explicit. Start with a limit of five active contacts and adjust it in settings.' },
              { label: 'Give it context', detail: 'Guidance, preferences, and dated memories live in that contact’s folder. Review and edit them as the relationship changes.' },
              { label: 'Let it know when', detail: 'Smart mode is the default. The keyword “butler” can summon it directly; keyword-only mode keeps it waiting for that invitation.' },
              { label: 'Keep the conversation yours', detail: 'The butler identifies itself, yields when you are talking, and stops when you pause it. Live replies remain disabled during qualification.' },
            ]} />
          </MarketingSection>

          <MarketingSection heading="Memory you can read and change" headingId="memory-title" id="memory" label="" layout="split" summary="The butler’s context belongs in ordinary files. Add what it should know, correct an assumption, or remove a stale note. It is designed to learn from conversation without turning its guesses into facts.">
            <div className="workspace-example"><pre aria-label="Example contact workspace"><code>{`contact/\n├── AGENTS.md\n├── ABOUT.md\n├── MEMORY.md\n├── STYLE.md\n├── history/\n├── notes/\n├── attachments/\n└── outbox/`}</code></pre><p>One contact workspace. Settings, credentials, and permission grants stay outside the agent’s files.</p><Link href="/methodology">Read the legacy evidence methodology</Link></div>
          </MarketingSection>

          <MarketingSection heading="Small parts with clear jobs" headingId="architecture-title" id="architecture" label="" summary="A local daemon handles the work while the Mac app gives you the controls. Hooks and adapters provide room to extend the experience without handing an agent unrestricted access.">
            <dl className="architecture-rows">
              <div><dt>Textbutler</dt><dd>Contacts, response timing, visible disclosure, scoped memory, pause, and action policy.</dd></div>
              <div><dt>Ghostget</dt><dd>The required boundary for Messages and Contacts access, permission checks, and transport capabilities.</dd></div>
              <div><dt>Agentrouter</dt><dd>Reusable Codex and Claude account and execution foundations. The provider must enforce the requested tool and file scope.</dd></div>
              <div><dt>Your hooks</dt><dd>Developer-authored extensions for context and response decisions. Trusted executable hooks stay separate from the agent’s editable memory.</dd></div>
            </dl>
            <p className="mlm-section-link"><a href={ARCHITECTURE_URL}>Read the architecture and capability limits</a></p>
          </MarketingSection>

          <MarketingTrustBoundary className="mlm-marketing-trust" heading="Keep the useful boundaries visible" headingId="boundaries-title" id="boundaries" label="" summary="The contact folder is local. Your chosen coding-agent provider still receives the context needed for its work. Textbutler’s website has no access to that information." items={[
            { label: 'A recognizable assistant', detail: 'Every text reply has a configurable character, begin symbol, and end symbol. The default is 🤖{ hello this is my response }.' },
            { label: 'One conversation at a time', detail: 'The agent boundary is one contact workspace, public web requests, and that conversation’s supported message actions. No shell tools.' },
            { label: 'Capabilities, not promises', detail: 'Files, reactions, stickers, and iMessage apps appear as available only after transport qualification. Unsupported features stay explicit.' },
          ]} />

          <MarketingSection heading="The foundation is here. Live replies are next." headingId="development-title" id="development" label="" summary="Textbutler is in development. You can inspect and build the source now; a signed Mac download is not available yet.">
            <div className="development-status"><div><h3>Implemented in source</h3><p>Mac settings panel, local daemon control channel, contact workspaces, editable memory, disclosure and response policy, and synthetic tests.</p><a href={`${GITHUB_URL}/tree/main/apps/macos`}>Inspect the Mac app source</a></div><div><h3>Still being qualified</h3><p>Ghostget Messages and Contacts integration, permission-scoped agent execution, message delivery, and rich transport features. Automatic replies remain disabled.</p><a href={ARCHITECTURE_URL}>See the integration boundaries</a></div></div>
            <p className="legacy-note">Looking for the original history tools? <a href={RELEASE_URL}>Message Like Me v{SOFTWARE_VERSION}</a> remains available as a legacy release. It does not install Textbutler or enable automatic replies. <Link href="/sources">View legacy history sources.</Link></p>
          </MarketingSection>

          <MarketingQuestionList className="mlm-marketing-questions" heading="A few things to know" headingId="questions-title" id="questions" label="" questions={HOME_QUESTIONS.map(({ answer, question }) => ({ answer: <p>{answer}</p>, question }))} />
          <MarketingCallToAction actions={[{ href: GITHUB_URL, label: 'Explore the source' }, { href: '/docs', label: 'Read the docs' }]} className="mlm-marketing-cta" footnote={HERO_FOOTNOTE} heading="Make room for a little help" headingId="closing-title" id="closing" summary="Follow the build, read the design, and help shape a butler that knows when to speak—and when to stay quiet." />
        </MarketingPage>
      </main>
      <SiteFooter path="/" />
    </>
  );
}
