// Reader-facing facts for the landing page, llms.txt, and About. Every number
// here traces to source (config.ts contact defaults, decision.ts, the default
// reply model); keep latency, test counts, and user counts off these pages.

export type SupportChip = 'Works today' | 'Lightly tested' | 'Text only' | 'In testing' | 'Not supported' | 'Coming' | 'Becoming the default · in testing' | 'Default today';

export type MessagingApp = Readonly<{
  name: string;
  networks?: string;
  chip: SupportChip;
  gets: string;
  limits: string;
}>;

export const MESSAGING_APPS: readonly MessagingApp[] = [
  {
    name: 'iMessage',
    chip: 'Works today',
    gets: 'Automatic, marked replies in one-to-one chats.',
    limits: 'One-to-one only. No tapbacks or other reactions on a normal Mac. SMS and RCS aren’t supported. Your Mac must be awake and signed in to Messages.',
  },
  {
    name: 'WhatsApp',
    chip: 'Lightly tested',
    gets: 'Replies in one-to-one chats, through a linked device.',
    limits: 'You pair it once yourself. It uses an unofficial client, so try it on your own account before you rely on it.',
  },
  {
    name: 'Beeper',
    networks: 'Signal, Telegram, Instagram, and more',
    chip: 'Text only',
    gets: 'Replies in direct chats, through Beeper Desktop.',
    limits: 'Beeper Desktop has to stay open. No photos, reactions, or polls. Telegram’s terms limit AI use of message content, so ask the person first.',
  },
  {
    name: 'Group chats, SMS, and RCS',
    chip: 'Not supported',
    gets: 'Nothing. Textbutler ignores group chats, reactions, and old messages.',
    limits: 'It answers one person at a time, in the one-to-one chats you turn on.',
  },
];

export type ReplyWriter = Readonly<{
  id: 'local' | 'key' | 'subscription';
  name: string;
  short: string;
  chip: SupportChip;
  command: string;
  leaves: string;
  note: string;
}>;

export const REPLY_WRITERS: readonly ReplyWriter[] = [
  {
    id: 'local',
    name: 'A local model on your Mac',
    short: 'Ollama',
    chip: 'Becoming the default · in testing',
    command: 'ollama pull qwen3:4b-instruct-2507-q4_K_M\ntextbutler providers local',
    leaves: 'Nothing, for writing the reply.',
    note: 'About 2.5 GB. Textbutler never downloads a model for you.',
  },
  {
    id: 'key',
    name: 'Qwen 3.5 Flash with your own Vercel AI Gateway key',
    short: 'Your key',
    chip: 'Default today',
    command: 'pbpaste | textbutler providers gateway-key',
    leaves: 'The conversation context goes to Vercel AI Gateway.',
    note: 'Spending stops at $1 a day.',
  },
  {
    id: 'subscription',
    name: 'Your Claude Code, Codex, or Devin subscription',
    short: 'Through xcb',
    chip: 'Works today',
    command: 'textbutler providers check ACCOUNT',
    leaves: 'The conversation context goes through xcb to that account.',
    note: 'Connect xcb first. The model gets no tools of its own, and xcb keeps your sign-in.',
  },
];

export const HOW_IT_WORKS_STEPS = [
  { label: 'Someone texts you.', detail: 'They write in a one-to-one chat you’ve turned on. Ghostget passes the message to Textbutler, running in the background on your Mac.' },
  { label: 'It checks before it speaks.', detail: 'Is this person turned on? Is it a one-to-one chat? Did they say “butler”? Have you stayed out of the chat for 5 minutes? Is it under 12 replies this hour? It also waits 8 seconds, so a burst of texts gets one answer.' },
  { label: '👀, right away.', detail: 'It sends 🤖{ 👀 } so they know it’s on it.' },
  { label: 'It reads the room.', detail: 'It reads the notes you keep for this person (how you talk, what matters, what’s off-limits), up to 64 remembered notes, and the recent conversation. It can search your full history with this person.' },
  { label: 'Your chosen model writes the reply.', detail: 'That’s a local model, Qwen through your key, or your subscription. Web search is off unless you turn it on, and it never searches with your private wording.' },
  { label: 'Marked, then sent.', detail: 'The reply arrives as 🤖{ … }, so nobody mistakes it for you. If it can’t tell whether a send went through, it doesn’t send it again.' },
  { label: 'You’re always in charge.', detail: 'Write in the chat yourself and it stays out of it. Pause everything with one command. Or ask for a draft to review before anything is sent. Drafts expire after 15 minutes.' },
] as const;

export const REPLY_MODES = [
  { term: 'Keyword', badge: 'Default', detail: 'Answers only messages that contain the word “butler”, in any capitalization.' },
  { term: 'Smart', detail: 'Decides when a reply is clearly wanted. It answers only when it’s at least 85% sure, and stays quiet otherwise.' },
  { term: 'You can ask too', detail: 'Say “butler” in any chat you’ve turned on, including your own, and it answers you.' },
] as const;

export const SETUP_STEPS = [
  { label: 'Ask your agent.', detail: 'Paste the prompt below into Claude Code, Codex, or Devin. It clones the repo, installs it, connects your messaging apps, and runs textbutler doctor until only your steps are left.' },
  { label: 'Say yes to your Mac.', detail: 'For iMessage, turn on Full Disk Access for the TextButler helper and allow the Messages prompt. For WhatsApp or Beeper, pair once. Then choose what writes replies: pull the local model, paste a Gateway key, or sign in through xcb.' },
  { label: 'Turn on one person.', detail: 'Everyone starts off. Turn on one chat and resume the butler. When that person says “butler”, your butler answers.' },
] as const;
