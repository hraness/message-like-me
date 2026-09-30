import { boundariesConversation, marked, whatsappReplyConversation, type Conversation } from '../_components/phone';
import type { TerminalLine } from '@hraness/design-kit/mockups';

import { launchFacts } from '../launch/facts';

/**
 * Synthetic content for the launch mockups. Every person is made up; the
 * commands and prompts are the ones the product ships (cli-help.ts, tui.ts,
 * README.md). Numbers come from ../launch/facts.
 */

/**
 * The boundaries exchange in a neutral Beeper-style app, as the apps beat
 * shows it: its own scene, so the page does not repeat the hero chat.
 */
export const beeperConversation: Conversation = {
  ...boundariesConversation,
  id: 'beeper-boundaries',
  via: 'via Beeper · not yet tested live',
};

/** The WhatsApp reply from the phone kit, labelled as not yet tested live. */
export const whatsappConversation: Conversation = {
  ...whatsappReplyConversation,
  via: 'not yet tested live',
};

/** The two marked messages the marker close-up shows, straight from the hero. */
export const markerMessages = {
  acknowledgment: marked('👀'),
  answer: marked('On Monday Sam said Friday at 6:30 at the gym, and that he’d bring the spare harness for you.'),
} as const;

export type WriterId = 'local' | 'subscription' | 'key';

export type Writer = Readonly<{
  id: WriterId;
  label: string;
  hint: string;
  commands: readonly string[];
  where: string;
}>;

/** The three reply writers, in the order the site names them (REPLY_WRITERS_SENTENCE). */
export const WRITERS: readonly Writer[] = [
  {
    id: 'local',
    label: 'On your Mac',
    hint: 'A local model through Ollama. In testing.',
    commands: ['ollama pull qwen3:4b-instruct-2507-q4_K_M', 'textbutler providers local'],
    where: `Written on this Mac. Nothing leaves it to write the reply. The model is about ${launchFacts.localModelSize.value}.`,
  },
  {
    id: 'subscription',
    label: 'Your subscription',
    hint: 'Your Claude Code, Codex, or Devin account through xcb.',
    commands: ['xcb accounts', 'textbutler setup --xcb /path/to/xcb --xcb-account claude:ACCOUNT_ID --xcb-model MODEL_KEY'],
    where: 'The conversation goes through xcb to the subscription you already pay for.',
  },
  {
    id: 'key',
    label: 'Your key',
    hint: 'Qwen 3.5 Flash through your own Vercel AI Gateway key.',
    commands: ['pbpaste | textbutler providers gateway-key'],
    where: `The conversation goes to Vercel AI Gateway. Spending stops at ${launchFacts.gatewayBudget.value} a day.`,
  },
];

/** The guided terminal's review of a suggested reply (tui.ts terminalDraft and its prompts). */
export const DRAFT_REVIEW_LINES = [
  { kind: 'input', text: 'textbutler tui' },
  { kind: 'comment', text: 'Inbox & replies › Maya' },
  { kind: 'output', text: '[t] Type a reply  [s] Suggest a reply  [Enter] Back: s', tone: 'muted' },
  { kind: 'output', text: 'To: Maya · imessage' },
  { kind: 'output', text: '1. Message' },
  { kind: 'output', text: 'Friday at 6:30 at the gym, and Sam is bringing the spare harness.' },
  { kind: 'output', text: 'Expires: 2026-10-05T19:53:00.000Z', tone: 'muted' },
  { kind: 'output', text: 'Sending includes every action above, in that order.', tone: 'muted' },
  { kind: 'output', text: 'Type send to send these exact actions, or Enter to cancel: send', tone: 'ok' },
] as const satisfies readonly TerminalLine[];
