import { AgentSession, MockupRoot, TerminalFrame, type AgentTurn } from '@hraness/design-kit/mockups';

import { heroConversation, PhoneMock, PhoneMockPlayer } from '../_components/phone';
import { AGENT_SETUP_PROMPT } from '../_lib/site';
import { beeperConversation, DRAFT_REVIEW_LINES, markerMessages, whatsappConversation } from './samples';
import { WritersShowcase } from './writers';

/**
 * Code-built illustrations of TextButler's real surfaces for the launch post,
 * the homepage, and the launch film. Everything shown is synthetic: made-up
 * people, and commands and prompts the product ships. Third-party apps are
 * drawn without their names or marks.
 */

export type ThreadApp = 'messages' | 'whatsapp' | 'beeper' | 'others';

const OTHER_APPS = {
  whatsapp: {
    conversation: whatsappConversation,
    label: 'Illustration: a WhatsApp-style chat. Jordan asks the butler about Thursday, and marked replies answer. Names are made up.',
  },
  beeper: {
    conversation: beeperConversation,
    label: 'Illustration: a Beeper-style chat. Marcus asks the butler for Sam’s work address, and a marked reply declines. Names are made up.',
  },
} as const;

/**
 * The phone chat. `messages` plays the hero exchange; `whatsapp` and `beeper`
 * use synthetic conversations; `others` shows those two side by side.
 */
export function ThreadMockup({ app = 'messages', play = false }: Readonly<{ app?: ThreadApp; play?: boolean }>) {
  if (app === 'others') {
    return (
      <div className="tbm-phone-pair">
        <ThreadMockup app="whatsapp" />
        <ThreadMockup app="beeper" />
      </div>
    );
  }
  const conversation = app === 'messages' ? heroConversation : OTHER_APPS[app].conversation;
  const label = app === 'messages' ? undefined : OTHER_APPS[app].label;
  return (
    <div className="tbm-phone">
      {play
        ? <PhoneMockPlayer controls conversation={conversation} label={label} maxWidth={360} />
        : <PhoneMock conversation={conversation} label={label} maxWidth={360} screenHeight={700} />}
    </div>
  );
}

/** A close-up of the two marked messages: the 👀 acknowledgment, then the answer. */
export function MarkerMockup() {
  return (
    <MockupRoot
      className="tbm-marker"
      describe="Illustration: two messages from the butler up close. First 🤖{ 👀 }, sent right away, then the answer, each wrapped in the 🤖{ } marker."
      kind="tb-marker"
    >
      <ol className="tbm-marker__list">
        <li>
          <span className="tbm-bubble">{markerMessages.acknowledgment}</span>
          <span className="tbm-note">Sent right away, so they know it heard them</span>
        </li>
        <li>
          <span className="tbm-bubble">{markerMessages.answer}</span>
          <span className="tbm-note">The answer, wrapped the same way</span>
        </li>
      </ol>
    </MockupRoot>
  );
}

const SETUP_TURNS: readonly AgentTurn[] = [
  { role: 'user', text: AGENT_SETUP_PROMPT.split('\n').slice(0, 2).join('\n') },
  { role: 'tool', tool: 'Run command', text: 'bun install --frozen-lockfile --ignore-scripts && bun run textbutler:install', status: 'ok' },
  { role: 'tool', tool: 'Run command', text: 'textbutler doctor', status: 'warn' },
  { role: 'agent', text: 'This step is yours: macOS needs you to turn on Full Disk Access for the TextButler helper. Tell me when it is on and I will run doctor again.' },
];

/** A neutral coding-agent session doing the setup and stopping at the macOS permission step. */
export function AgentMockup({ height }: Readonly<{ height?: number }>) {
  return (
    <AgentSession
      agent="generic-cli"
      describe="Illustration: a coding agent session. You paste the setup prompt, the agent installs TextButler and runs textbutler doctor, then stops and asks you to turn on Full Disk Access."
      title="Coding agent"
      turns={SETUP_TURNS}
      {...(height === undefined ? {} : { height })}
    />
  );
}

/** The guided terminal reviewing a suggested reply before anything is sent. */
export function DraftMockup() {
  return (
    <TerminalFrame
      describe="Illustration: the guided terminal shows a suggested reply to Maya, who it goes to, when it expires, and asks you to type send before it goes out."
      lines={DRAFT_REVIEW_LINES}
      title="Terminal"
    />
  );
}

export { WritersShowcase as WritersMockup };

/** Beat and scene ids to the component that draws them. */
export const SURFACE_COMPONENTS = {
  thread: ThreadMockup,
  marker: MarkerMockup,
  writers: WritersShowcase,
  agent: AgentMockup,
  draft: DraftMockup,
} as const;

export type SurfaceId = keyof typeof SURFACE_COMPONENTS;
