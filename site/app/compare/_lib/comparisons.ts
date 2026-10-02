import type { MarketingComparisonRow } from '@hraness/design-kit/react/server';
import type { SocialImagePage } from '@hraness/web-discovery/social-image/card';

import {
  GETTING_STARTED_URL,
  MESSAGING_APPS_URL,
  REPLY_WRITERS_SENTENCE,
  SUBSCRIPTION_GUIDE_URL,
  type CanonicalPagePath,
} from '../../_lib/site';
import type { Question } from '../../_lib/structured-data';

// The date every fact about another product on these pages was last read from
// that product's own public pages. Update it only after checking them again.
export const COMPARISONS_CHECKED_ON = '2026-10-02';

export type Source = Readonly<{ label: string; href: string }>;

export type HubSummary = Readonly<{
  // Each value is one short table cell on /compare.
  youTalkTo: string;
  answers: string;
  runsOn: string;
  ai: string;
  price: string;
  disclosure: string;
}>;

export type Comparison = Readonly<{
  slug: string;
  path: CanonicalPagePath;
  name: string;
  officialUrl: string;
  title: string;
  description: string;
  heading: string;
  lede: string;
  card: SocialImagePage;
  rows: readonly MarketingComparisonRow[];
  note: string;
  chooseOther: string;
  chooseTextButler: string;
  sections: readonly Readonly<{ heading: string; paragraphs: readonly string[] }>[];
  questions: readonly Question[];
  sources: readonly Source[];
  hub: HubSummary;
  hubLine: string;
}>;

export const TEXTBUTLER_SOURCES: readonly Source[] = [
  { label: 'TextButler setup guide', href: GETTING_STARTED_URL },
  { label: 'TextButler messaging app support and limits', href: MESSAGING_APPS_URL },
  { label: 'How TextButler connects a subscription through xcb', href: SUBSCRIPTION_GUIDE_URL },
];

export const TEXTBUTLER_HUB: HubSummary = {
  youTalkTo: 'Your existing chats with other people',
  answers: 'People in chats you turn on, when they say “butler”',
  runsOn: 'Your Mac',
  ai: 'Ollama, your Gateway key, or Claude Code, Codex, or Devin through xcb',
  price: 'Free · MIT',
  disclosure: '🤖{ } on by default',
};

const TEXTBUTLER_WHAT_IT_DOES = [
  'TextButler is a headless macOS butler: a command line, a guided terminal, and a background service, with no window or menu bar icon. GhostGet, a separate Mac tool, connects it to iMessage, WhatsApp, and Beeper. You turn it on one direct or group conversation at a time; new installations start paused and new conversations start disabled.',
  `Once a conversation is on, TextButler answers by default only messages that contain the word “butler”, and it waits 5 minutes after you last wrote there. Replies go out from your own account wrapped in a marker, such as 🤖{ On Monday Sam said Friday at 6:30. }, which you can change or clear per conversation. Each conversation keeps its own notes as ordinary files on your Mac. ${REPLY_WRITERS_SENTENCE} The reply model works only with that conversation’s notes, optional web search, and proposed messages; it gets no shell and no other files on your Mac.`,
];

const OPENCLAW_URL = 'https://openclaw.ai';
const OPENCLAW_GITHUB_URL = 'https://github.com/openclaw/openclaw';

const openclaw: Comparison = {
  slug: 'openclaw',
  path: '/compare/openclaw',
  name: 'OpenClaw',
  officialUrl: OPENCLAW_URL,
  title: 'OpenClaw vs TextButler for iMessage chats',
  description:
    'OpenClaw is an open-source agent you message to get tasks done. TextButler answers inside your chats with other people. Compare chat apps, tools, groups, and disclosure.',
  heading: 'TextButler compared with OpenClaw',
  lede:
    'OpenClaw is a general-purpose agent you message from more than 20 chat apps, and it can work across your files, browser, and shell. TextButler does one job: it answers in the iMessage, WhatsApp, and Beeper conversations you choose, marks those replies as AI, and keeps notes for each conversation.',
  card: {
    eyebrow: 'Compare',
    headline: 'TextButler and OpenClaw',
    description: 'An agent you message, or a butler in the chats you already have.',
  },
  rows: [
    { label: 'Software', values: ['Free · MIT', 'Free · MIT'] },
    { label: 'Main use', values: ['Answering people in your chats', 'Tasks you ask it to do'] },
    { label: 'Chat apps', values: ['iMessage, WhatsApp, Beeper', 'iMessage, WhatsApp, Telegram, Slack, Discord, Signal, and more'] },
    { label: 'Runs on', values: ['Your Mac', 'Mac, Windows, or Linux'] },
    { label: 'What the model can use', values: ['One conversation’s notes, optional web search', 'Shell, files, browser, and connected accounts'] },
    { label: 'Group chats', values: ['Groups you select, “butler” keyword by default', 'Allowlisted groups, mention required by default'] },
    { label: 'Marks replies as AI', values: ['🤖{ } by default', 'Not described'] },
    { label: 'AI', values: ['Ollama, Gateway key, or subscription through xcb', 'Hosted, subscription, gateway, or local models'] },
  ],
  note: 'OpenClaw facts come from its site, README, and channel docs.',
  chooseOther:
    'Choose OpenClaw for one agent you can message from many apps that can check you in for a flight, handle email, browse, or run commands on your computer.',
  chooseTextButler:
    'Choose TextButler when you want help inside specific conversations with other people, with each conversation’s notes kept apart, replies marked as AI, and a reply model that can’t run commands on your Mac.',
  sections: [
    {
      heading: 'What OpenClaw does',
      paragraphs: [
        'OpenClaw describes itself as an open-source AI assistant that runs on your own computer. It installs with a script or npm and a setup command, runs on macOS, Windows, and Linux, and is run by the OpenClaw Foundation, a US non-profit. Its site says there is no subscription and no hosted tier. You bring hosted, subscription-backed, gateway, or local models.',
        'You talk to it from chat apps such as WhatsApp, Telegram, Discord, Slack, Signal, and iMessage. On a Mac, its iMessage channel uses the imsg tool on the Mac that is signed in to Messages, and its docs also describe a dedicated macOS user with a separate iMessage identity. The agent keeps persistent memory and can handle email, calendars, browsing, forms, files, and shell commands. Its README says tools run on the host for the main session unless you configure sandboxing.',
        'OpenClaw’s group docs say it lives on your own messaging accounts, so it can see and answer in groups you belong to. Groups are blocked until you allowlist them, and group replies need a mention by default. Unknown people who message it directly get a pairing code, and their messages are not processed until you approve them.',
      ],
    },
    { heading: 'What TextButler does', paragraphs: TEXTBUTLER_WHAT_IT_DOES },
  ],
  questions: [
    {
      question: 'Can OpenClaw answer my friends for me like TextButler does?',
      answer:
        'It can answer in groups you belong to, since its docs say it lives on your own messaging accounts; group replies need a mention by default, and groups must be allowlisted. Its site presents it mainly as an agent you message to get things done. TextButler is built for the other case: it answers people in the conversations you turn on, marks replies with 🤖{ } by default, and waits 5 minutes after you last wrote.',
    },
    {
      question: 'Is TextButler a lighter OpenClaw?',
      answer:
        'No. They do different jobs. OpenClaw is a general agent with tools for your files, browser, accounts, and shell. TextButler only reads and writes messages in the conversations you select, and its reply model works with one conversation’s notes plus optional web search, with no shell and no other files on your Mac.',
    },
    {
      question: 'Do both run on my own computer?',
      answer:
        'Yes. OpenClaw runs on macOS, Windows, or Linux and keeps its state on that machine. TextButler runs only on a Mac that stays awake and signed in. Both send message context to a hosted model if you choose one, and both can use a local model instead.',
    },
  ],
  sources: [
    { label: 'OpenClaw site', href: OPENCLAW_URL },
    { label: 'OpenClaw README on GitHub', href: OPENCLAW_GITHUB_URL },
    { label: 'OpenClaw iMessage channel docs', href: 'https://docs.openclaw.ai/channels/imessage' },
    { label: 'OpenClaw group chat docs', href: 'https://docs.openclaw.ai/channels/groups' },
    { label: 'OpenClaw pairing docs', href: 'https://docs.openclaw.ai/channels/pairing' },
  ],
  hub: {
    youTalkTo: 'An agent you message from 20+ chat apps',
    answers: 'You and approved senders; allowlisted groups on mention',
    runsOn: 'Mac, Windows, or Linux',
    ai: 'Hosted, subscription, gateway, or local models',
    price: 'Free · MIT',
    disclosure: 'Not described',
  },
  hubLine: 'Open-source agent you message to get tasks done across your files, browser, accounts, and shell.',
};

const HERMES_URL = 'https://hermes-agent.nousresearch.com';
const HERMES_MESSAGING_URL = `${HERMES_URL}/docs/user-guide/messaging/`;

const hermes: Comparison = {
  slug: 'hermes-agent',
  path: '/compare/hermes-agent',
  name: 'Hermes Agent',
  officialUrl: HERMES_URL,
  title: 'Hermes Agent vs TextButler for messaging',
  description:
    'Hermes Agent from Nous Research is a self-hosted agent you reach through a messaging gateway. TextButler answers in your own chats. Compare setup, access, groups, and disclosure.',
  heading: 'TextButler compared with Hermes Agent',
  lede:
    'Hermes Agent is an open-source agent from Nous Research that you reach through Telegram, WhatsApp, Slack, iMessage, and other apps. TextButler answers the people in the iMessage, WhatsApp, and Beeper conversations you choose, from your own account, with replies marked as AI.',
  card: {
    eyebrow: 'Compare',
    headline: 'TextButler and Hermes Agent',
    description: 'A self-hosted agent you message, or a butler in your chats.',
  },
  rows: [
    { label: 'Software', values: ['Free · MIT', 'Free · MIT'] },
    { label: 'Main use', values: ['Answering people in your chats', 'An agent you and approved users message'] },
    { label: 'Chat apps', values: ['iMessage, WhatsApp, Beeper', 'Telegram, WhatsApp, Slack, Discord, Signal, iMessage, and more'] },
    { label: 'Runs on', values: ['Your Mac', 'Mac, Windows, Linux, or a server'] },
    { label: 'Suggested WhatsApp number', values: ['Your own, as a linked device', 'A dedicated bot number'] },
    { label: 'Group chats', values: ['Groups you select, “butler” keyword by default', 'Admitted groups; mention optional'] },
    { label: 'Marks replies as AI', values: ['🤖{ } by default', 'Not described'] },
    { label: 'AI', values: ['Ollama, Gateway key, or subscription through xcb', 'Your provider or Nous Portal'] },
  ],
  note: 'Hermes Agent facts come from its site and messaging gateway docs.',
  chooseOther:
    'Choose Hermes Agent for a self-hosted agent that keeps one memory across many messaging apps, runs scheduled tasks, and can live on a server while you message it from your phone.',
  chooseTextButler:
    'Choose TextButler when the people you want helped are already in your iMessage, WhatsApp, or Beeper chats, and you want each conversation’s notes kept apart and every reply marked as AI.',
  sections: [
    {
      heading: 'What Hermes Agent does',
      paragraphs: [
        'Hermes Agent is an MIT-licensed agent from Nous Research that keeps conversations, memories, and skills across sessions and writes new skills as it works. It has desktop apps for macOS and Windows, a terminal installer for Linux, and an optional hosted deployment. You bring your own model provider or buy credits through Nous Portal.',
        'Its messaging gateway is one background process, run as a launchd agent on macOS, that connects to Telegram, Discord, Slack, WhatsApp, Signal, SMS, email, iMessage through BlueBubbles or Photon, and many more apps. By default the gateway ignores anyone who is not on an allowlist or paired through a one-time code.',
        'For WhatsApp, its docs recommend a dedicated phone number for the bot, with a self-chat mode on your own number for testing, because the bridge is unofficial. For iMessage, it uses the Apple ID signed in to Messages on a Mac running BlueBubbles Server. In admitted groups it answers every message by default; you can require a mention instead.',
      ],
    },
    { heading: 'What TextButler does', paragraphs: TEXTBUTLER_WHAT_IT_DOES },
  ],
  questions: [
    {
      question: 'Can Hermes Agent reply in my iMessage group chats?',
      answer:
        'Yes, through BlueBubbles on a Mac signed in to your Apple ID. Its docs say it answers every authorized direct or group message by default, and you can require a mention for groups. TextButler answers only in conversations you turn on, and by default only to messages that contain “butler”.',
    },
    {
      question: 'Where does each one run?',
      answer:
        'Hermes Agent runs on your computer or a server, and its iMessage connection needs an always-on Mac running BlueBubbles Server. TextButler runs only on your Mac, which must stay awake and signed in.',
    },
    {
      question: 'Do they mark AI replies?',
      answer:
        'TextButler wraps replies in 🤖{ } by default and keeps a visible marker in your own chat. The Hermes Agent messaging docs do not describe a reply marker. For WhatsApp they recommend a dedicated bot number, so people message the bot rather than you.',
    },
  ],
  sources: [
    { label: 'Hermes Agent site', href: HERMES_URL },
    { label: 'Hermes Agent messaging gateway docs', href: HERMES_MESSAGING_URL },
    { label: 'Hermes Agent WhatsApp docs', href: `${HERMES_MESSAGING_URL}whatsapp` },
    { label: 'Hermes Agent BlueBubbles (iMessage) docs', href: `${HERMES_MESSAGING_URL}bluebubbles` },
  ],
  hub: {
    youTalkTo: 'A self-hosted agent through a messaging gateway',
    answers: 'Allowlisted or paired users',
    runsOn: 'Mac, Windows, Linux, or a server',
    ai: 'Your provider or Nous Portal',
    price: 'Free · MIT; models billed separately',
    disclosure: 'Not described',
  },
  hubLine: 'Open-source agent from Nous Research with one memory across many messaging apps.',
};

const POKE_URL = 'https://poke.com';

const poke: Comparison = {
  slug: 'poke',
  path: '/compare/poke',
  name: 'Poke',
  officialUrl: POKE_URL,
  title: 'Poke vs TextButler: AI assistants in your texts',
  description:
    'Poke is a hosted assistant you text that connects to your email and calendar. TextButler answers in your chats with other people from your Mac. Compare price, data, and setup.',
  heading: 'TextButler compared with Poke',
  lede:
    'Poke is a hosted assistant you text in Messages, WhatsApp, or Telegram, and it works across your email, calendar, and apps. TextButler runs on your Mac and answers the people in the conversations you choose, with replies marked as AI.',
  card: {
    eyebrow: 'Compare',
    headline: 'TextButler and Poke',
    description: 'An assistant you text, or a butler in the chats you already have.',
  },
  rows: [
    { label: 'Software', values: ['Free · MIT', 'Free, Pro $19/mo, Ultra $199/mo'] },
    { label: 'Main use', values: ['Answering people in your chats', 'Your own reminders, email, and tasks'] },
    { label: 'Where you use it', values: ['Your iMessage, WhatsApp, and Beeper chats', 'A contact in Messages, WhatsApp, or Telegram'] },
    { label: 'Runs on', values: ['Your Mac', 'Poke’s hosted service'] },
    { label: 'Connected accounts', values: ['None', 'Gmail, Calendar, Notion, and many more'] },
    { label: 'Marks replies as AI', values: ['🤖{ } by default', 'It is its own contact'] },
    { label: 'AI', values: ['Ollama, Gateway key, or subscription through xcb', 'Included in each plan'] },
    { label: 'Setup', values: ['Coding agent or setup guide', 'Sign up and text it'] },
  ],
  note: 'Poke facts come from its site and privacy policy.',
  chooseOther:
    'Choose Poke for a hosted assistant you text from any phone that watches your email and calendar, sets reminders, and runs automations, with no Mac to keep awake.',
  chooseTextButler:
    'Choose TextButler when you want an assistant to answer other people inside your own conversations, with notes and, if you choose Ollama, replies that stay on your Mac.',
  sections: [
    {
      heading: 'What Poke does',
      paragraphs: [
        'Poke, from The Interaction Company of California, describes itself as an assistant that lives in your texts. You message it as a contact in Messages, WhatsApp, or Telegram, by text or voice. It sets reminders, starts tasks, and uses connected services such as Gmail, Google Calendar, Outlook, Notion, and GitHub to help at the right time. Recipes set up integrations and automations, and developers can build their own.',
        'Poke runs as a hosted service. The free plan connects your apps, email, and calendar; Pro is $19 a month and Ultra $199 a month, with frontier models, background automations, and higher limits. Its privacy policy says content may be used to train its models unless you choose Maximum Privacy. Its site also announces that Poke is joining Cognition.',
      ],
    },
    { heading: 'What TextButler does', paragraphs: TEXTBUTLER_WHAT_IT_DOES },
  ],
  questions: [
    {
      question: 'Does Poke reply to my friends for me?',
      answer:
        'Poke’s site describes a contact you text, not an assistant that answers other people in your conversations. TextButler does that: it answers in the chats you turn on, from your account, and marks replies with 🤖{ } by default.',
    },
    {
      question: 'Where do my messages go?',
      answer:
        'Poke runs on its own hosted service and, with your permission, reads connected accounts such as Gmail and Google Calendar. TextButler reads messages on your Mac and keeps each conversation’s notes there. A local model keeps replies on your Mac; a Gateway key or subscription sends the conversation context to that provider.',
    },
    {
      question: 'Which costs less?',
      answer:
        'Poke has a free plan and paid plans at $19 and $199 a month. TextButler is free and open source; you pay nothing for a local model, Vercel bills Gateway usage, which TextButler stops at $1 a day, or you use a subscription you already have.',
    },
  ],
  sources: [
    { label: 'Poke site and pricing', href: POKE_URL },
    { label: 'Poke privacy policy', href: `${POKE_URL}/privacy` },
  ],
  hub: {
    youTalkTo: 'A hosted assistant contact',
    answers: 'You',
    runsOn: 'Poke’s hosted service',
    ai: 'Included in each plan',
    price: 'Free; Pro $19/mo; Ultra $199/mo',
    disclosure: 'It is its own contact',
  },
  hubLine: 'Hosted assistant you text that works across your email, calendar, and apps.',
};

const META_AI_URL = 'https://www.whatsapp.com/meta-ai';

const metaAi: Comparison = {
  slug: 'meta-ai-whatsapp',
  path: '/compare/meta-ai-whatsapp',
  name: 'Meta AI in WhatsApp',
  officialUrl: META_AI_URL,
  title: 'Meta AI in WhatsApp vs TextButler',
  description:
    'Meta AI is built into WhatsApp as a chat and in groups. TextButler adds your own assistant to the WhatsApp, iMessage, and Beeper chats you choose. Compare models, memory, and privacy.',
  heading: 'TextButler compared with Meta AI in WhatsApp',
  lede:
    'Meta AI is Meta’s assistant inside WhatsApp: you chat with it, or bring it into a group. TextButler is a Mac service that answers in the WhatsApp, iMessage, and Beeper conversations you choose, with your own model and notes for each conversation.',
  card: {
    eyebrow: 'Compare',
    headline: 'TextButler and Meta AI in WhatsApp',
    description: 'Meta’s built-in assistant, or your own butler in your chats.',
  },
  rows: [
    { label: 'Software', values: ['Free · MIT', 'Built into WhatsApp'] },
    { label: 'Where you use it', values: ['Your iMessage, WhatsApp, and Beeper chats', 'Its own WhatsApp chat and your groups'] },
    { label: 'Runs on', values: ['Your Mac', 'Meta’s service'] },
    { label: 'Setup', values: ['Coding agent or setup guide', 'Built in'] },
    { label: 'iMessage and Beeper', values: [true, false] },
    { label: 'Marks replies as AI', values: ['🤖{ } by default', 'Replies come from Meta AI'] },
    { label: 'AI', values: ['Ollama, Gateway key, or subscription through xcb', 'Meta AI'] },
  ],
  note: 'Meta AI facts come from WhatsApp’s Meta AI page.',
  chooseOther:
    'Choose Meta AI for an assistant that is already in WhatsApp on every phone, with no setup, for questions, images, and summaries of unread messages.',
  chooseTextButler:
    'Choose TextButler for an assistant that uses your chosen model, keeps notes you can edit for each conversation, and also works in iMessage and Beeper.',
  sections: [
    {
      heading: 'What Meta AI in WhatsApp does',
      paragraphs: [
        'WhatsApp’s Meta AI page describes an assistant you can chat with by text or voice, ask in a group chat, or use to create and edit images, learn from photos, and summarize unread messages. The page notes that features may not be available to all users.',
        'The page says personal messages and calls are protected with end-to-end encryption. For features that use your messages, it says Private Processing lets Meta AI respond without Meta or WhatsApp being able to read those messages. Incognito chats with Meta AI are not stored and disappear when you leave.',
      ],
    },
    { heading: 'What TextButler does', paragraphs: TEXTBUTLER_WHAT_IT_DOES },
  ],
  questions: [
    {
      question: 'Can I use a model other than Meta AI in WhatsApp?',
      answer: `Not inside Meta AI. TextButler lets you choose. ${REPLY_WRITERS_SENTENCE}`,
    },
    {
      question: 'How does TextButler connect to WhatsApp?',
      answer:
        'Through GhostGet, which pairs your account as a linked device on your Mac using an unofficial WhatsApp client. Keep the Mac awake and signed in. Meta AI needs no setup because it is part of WhatsApp.',
    },
    {
      question: 'Who answers in a group chat?',
      answer:
        'With Meta AI, Meta AI answers in the group when someone asks it. With TextButler, your account answers in groups you turn on, by default only when someone says “butler”, and the reply carries the 🤖{ } marker.',
    },
  ],
  sources: [{ label: 'Meta AI in WhatsApp', href: META_AI_URL }],
  hub: {
    youTalkTo: 'A built-in WhatsApp assistant',
    answers: 'You, and groups that ask it',
    runsOn: 'Meta’s service',
    ai: 'Meta AI',
    price: 'Built into WhatsApp',
    disclosure: 'Replies come from Meta AI',
  },
  hubLine: 'Meta’s assistant built into WhatsApp chats and groups.',
};

// GhostReply has its own hand-written page at /compare/ghostreply; this entry
// feeds the hub table and llms.txt only.
export const GHOSTREPLY_HUB_ENTRY = {
  name: 'GhostReply',
  path: '/compare/ghostreply',
  officialUrl: 'https://ghostreply.lol',
  hub: {
    youTalkTo: 'Your existing iMessage chats',
    answers: 'One person or all one-to-one chats',
    runsOn: 'Your Mac',
    ai: 'Hosted AI included',
    price: '$4.99 once · one Mac',
    disclosure: 'No marker described',
  },
  hubLine: 'Mac app that answers your one-to-one iMessage chats in your texting style.',
} as const satisfies Pick<Comparison, 'name' | 'path' | 'officialUrl' | 'hub' | 'hubLine'>;

export const COMPARISONS: readonly Comparison[] = [openclaw, hermes, poke, metaAi];

export const HUB_ENTRIES = [...COMPARISONS, GHOSTREPLY_HUB_ENTRY] as const;

export function comparisonBySlug(slug: string): Comparison {
  const comparison = COMPARISONS.find((entry) => entry.slug === slug);
  if (comparison === undefined) throw new Error(`Unknown comparison ${slug}`);
  return comparison;
}

export function comparisonSocialImagePath(path: CanonicalPagePath): `/${string}` {
  return `${path}/opengraph-image`;
}

export const HUB_TITLE = 'TextButler vs OpenClaw, Poke, Hermes, Meta AI';
export const HUB_DESCRIPTION =
  'How TextButler compares with OpenClaw, Hermes Agent, Poke, Meta AI in WhatsApp, and GhostReply: who each assistant talks to, where it runs, which AI it uses, and what it costs.';
export const HUB_FRAMING =
  'Most personal AI agents are a contact you text: you message the bot, and it works for you. TextButler works the other way around. It runs on your Mac and answers inside the iMessage, WhatsApp, and Beeper conversations you already have with other people, only in the chats you turn on, with replies marked as AI by default.';

export const HUB_CARD: SocialImagePage = {
  eyebrow: 'Compare',
  headline: 'AI assistants you can text, compared',
  description: 'OpenClaw, Hermes Agent, Poke, Meta AI, and GhostReply.',
};

export const HUB_QUESTIONS: readonly Question[] = [
  {
    question: 'What is TextButler?',
    answer:
      'TextButler adds an assistant to the iMessage, WhatsApp, and Beeper chats you choose on your Mac. By default, it answers “butler” requests and marks its replies as AI. It is free, MIT-licensed, and runs as a background service with a command line and guided terminal.',
  },
  {
    question: 'How is TextButler different from OpenClaw, Poke, and other personal agents?',
    answer:
      'OpenClaw, Hermes Agent, Poke, and Meta AI are assistants you message to get help yourself. TextButler answers other people in your existing conversations: you turn it on one chat at a time, it keeps separate notes for each conversation, and it wraps replies in 🤖{ } by default so people know the butler wrote them.',
  },
  {
    question: 'Which assistant should I choose?',
    answer:
      'Choose OpenClaw or Hermes Agent for a self-hosted agent that works across your computer and accounts. Choose Poke for a hosted assistant that handles your email and calendar by text. Choose Meta AI for an assistant already built into WhatsApp. Choose GhostReply for one-to-one iMessage replies in your own style with hosted AI included. Choose TextButler for disclosed help inside the chats you pick, with your own model.',
  },
];

export const GHOSTREPLY_CARD: SocialImagePage = {
  eyebrow: 'Compare',
  headline: 'TextButler and GhostReply',
  description: 'Replies in your style, or marked replies with your own AI.',
};
