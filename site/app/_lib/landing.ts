import { marketingHeading } from "../../portfolio-copy";
// Reader-facing facts for the landing page, llms.txt, and About. Every number
// here traces to source (config.ts contact defaults, decision.ts, the default
// reply model); keep latency, test counts, and user counts off these pages.

export type MessagingApp = Readonly<{
  name: string;
  networks?: string;
  gets: string;
  limits: string;
}>;

export const MESSAGING_APPS: readonly MessagingApp[] = [
  {
    name: 'iMessage',
    gets: 'Replies in the direct and group chats you choose in Messages.',
    limits: 'Keep your Mac awake and signed in to Messages.',
  },
  {
    name: 'WhatsApp',
    gets: 'Replies in selected direct and group chats, through a linked device.',
    limits: 'Pair your WhatsApp account during setup.',
  },
  {
    name: 'Beeper',
    networks: 'Signal, Telegram, Instagram, and more',
    gets: 'Text replies in selected direct and group chats, through Beeper Desktop.',
    limits: 'Keep Beeper Desktop open with your messaging accounts connected.',
  },
];

export type ReplyWriter = Readonly<{
  id: 'local' | 'key' | 'subscription';
  name: string;
  short: string;
  command: string;
  leaves: string;
  note: string;
}>;

export const REPLY_WRITERS: readonly ReplyWriter[] = [
  {
    id: 'local',
    name: marketingHeading("home-writer-local"),
    short: 'Ollama',
    command: 'ollama pull qwen3:4b-instruct-2507-q4_K_M\ntextbutler providers local',
    leaves: 'Reply writing stays on your Mac. Optional web search sends queries through your saved Gateway key.',
    note: 'Use Ollama to run the reply model locally, with no model API bill.',
  },
  {
    id: 'key',
    name: marketingHeading("home-writer-key"),
    short: 'Your key',
    command: 'pbpaste | textbutler providers gateway-key',
    leaves: 'The conversation context goes to Vercel AI Gateway.',
    note: 'Spending stops at $1 a day.',
  },
  {
    id: 'subscription',
    name: marketingHeading("home-writer-subscription"),
    short: 'Through xcb',
    command: 'textbutler providers check ACCOUNT',
    leaves: 'The conversation context goes through xcb to that account.',
    note: 'Use a Claude Code, Codex, or Devin subscription you already have. xcb keeps your sign-in.',
  },
];

export const HOW_IT_WORKS_STEPS = [
  { label: marketingHeading("home-flow-text"), detail: 'They write in a direct or group chat you’ve turned on. GhostGet passes the message to TextButler, running in the background on your Mac.' },
  { label: marketingHeading("home-flow-checks"), detail: 'It checks the selected chat and its members, the reply mode, and your recent activity. The default limits leave 5 minutes after your last message and cap replies at 12 an hour. An 8-second pause lets a burst of texts become one request.' },
  { label: marketingHeading("home-flow-indicator"), detail: 'It sends an acknowledgment before preparing the answer: 🤖{ 👀 } with the default marker.' },
  { label: marketingHeading("home-flow-context"), detail: 'It reads the notes you keep for this conversation (how you talk, what matters, what’s off-limits) and the recent conversation. In your own chat it can also search your full history; for other people that’s off unless you turn it on.' },
  { label: marketingHeading("home-flow-model"), detail: 'That’s a local model, Qwen through your key, or your subscription. If search is enabled for this person, it can search the web with a saved Gateway key, and it refuses any search that reuses words from your private messages.' },
  { label: marketingHeading("home-flow-send"), detail: 'The reply uses this conversation’s marker settings; the default is 🤖{ … }. If it can’t tell whether a send went through, it doesn’t send it again.' },
  { label: marketingHeading("home-flow-step-in"), detail: 'Write in the chat yourself and it stays out of it. Pause everything with one command. Or ask for a draft to review before anything is sent. Drafts expire after 15 minutes.' },
] as const;

export const REPLY_MODES = [
  { term: 'Keyword', badge: 'Default', detail: 'Answers only messages that contain the word “butler”, in any capitalization.' },
  { term: 'Smart', detail: 'Can answer a request for help without the keyword. It asks a model whether help was requested and stays quiet when the result is uncertain.' },
  { term: 'You can ask too', detail: 'Say “butler” in any chat you’ve turned on, including your own, and it answers you.' },
] as const;

export const SETUP_STEPS = [
  { label: marketingHeading("home-setup-agent"), detail: 'Your agent installs TextButler, connects your messaging apps, and checks the setup.' },
  { label: marketingHeading("home-setup-mac"), detail: 'Grant Messages access or pair your messaging account when prompted. Choose a local model, a Gateway key, or an AI subscription.' },
  { label: marketingHeading("home-setup-person"), detail: 'New installs start paused. Choose a conversation, turn on replies, and resume TextButler when you are ready.' },
] as const;
