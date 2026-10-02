import {
  assertLaunchKit,
  buildSocialKit,
  resolveLaunchBeats,
  type LaunchBeat,
  type LaunchKitOptions,
  type LaunchMessaging,
  type LaunchRelease,
  type SocialKit,
} from '@hraness/design-kit/launch';
import { product } from '@hraness/design-kit/portfolio';

import { SITE_NAME, SITE_ORIGIN, SITE_WHAT_IT_IS } from '../_lib/site';
import { LAUNCH_STATUS, launchFacts } from './facts';

/**
 * The beats of "Introducing TextButler". Each one is a short section on the
 * page and one post in the launch threads, so each reads on its own. Numbers
 * are {placeholders} filled from ./facts; the design kit rejects a beat that
 * types a digit. Mockup ids name components in ../mockups.
 */
const authoredBeats: readonly LaunchBeat[] = [
  {
    id: 'what',
    part: 'what',
    headline: 'TextButler puts an AI butler in your text messages',
    post: 'TextButler adds an assistant to the iMessage, WhatsApp, and Beeper chats you choose on your Mac. In the default mode, it answers “butler” requests with an AI marker. Your friends use their existing messaging app.',
    socialPost: 'TextButler adds an assistant to the chats you choose on your Mac. By default, it answers “butler” requests with an AI marker. Your friends use their existing messaging app.',
    visual: { kind: 'mockup', id: 'thread', state: { app: 'messages', scene: 'plans' } },
    alt: 'A phone chat, in an illustration with made-up names: a friend asks the butler about plans, and a marked reply answers.',
  },
  {
    id: 'marked',
    part: 'does',
    headline: 'AI markers are on by default',
    post: 'Replies and acknowledgments carry a robot marker by default. You can change or remove it per conversation; your own chat keeps a visible marker.',
    visual: { kind: 'mockup', id: 'marker', state: {} },
    alt: 'Two marked replies up close, in an illustration: the eyes acknowledgment, then the answer, each wrapped in the robot marker.',
  },
  {
    id: 'quiet',
    part: 'does',
    headline: 'Most of the time it stays quiet',
    post: 'It answers in conversations you enable, using your chosen reply mode. It waits {cooldown} after you last wrote and sends at most {hourlyCap} replies an hour in one conversation. You can pause it or review a draft before sending.',
    visual: { kind: 'diagram', src: 'd4-five-checks' },
    alt: 'Diagram of five checks before it speaks: turned on, same members, asked, you have been quiet, under the hourly limit.',
    facts: ['cooldown', 'hourlyCap'],
  },
  {
    id: 'apps',
    part: 'does',
    headline: 'Built for the apps your friends already use',
    post: 'Connect iMessage, a WhatsApp linked device, or Beeper Desktop through GhostGet. Choose the conversations TextButler may answer. Your Mac runs the assistant, and replies appear in the same chat.',
    visual: { kind: 'mockup', id: 'thread', state: { app: 'others', scene: 'dinner-and-address' } },
    alt: 'Illustration: WhatsApp-style and Beeper-style chats with made-up names and default AI reply markers.',
  },
  {
    id: 'writers',
    part: 'how',
    headline: 'You pick what writes the replies',
    post: 'Pick one of {replyWriters}: a local model through Ollama, your Claude Code, Codex, or Devin subscription, or your own Vercel AI Gateway key, capped at {gatewayBudget} a day.',
    socialPost: 'Pick one of {replyWriters} to write replies: a local model that runs on your Mac with no subscription, your Claude Code, Codex, or Devin subscription, or your own Vercel AI Gateway key, capped at {gatewayBudget} a day.',
    visual: { kind: 'mockup', id: 'writers', state: {} },
    alt: 'The three reply writers, in an illustration you can click through: the commands for each, and what leaves your Mac.',
    facts: ['replyWriters', 'gatewayBudget'],
    detailHref: '/blog/how-textbutler-uses-xcb',
  },
  {
    id: 'agent',
    part: 'who',
    headline: 'Your coding agent does the setup',
    post: 'It is for people who already use Claude Code, Codex, or Devin. Paste one prompt and your agent does the setup. You click the macOS permission prompts, pick what writes replies, and turn on a chat.',
    visual: { kind: 'mockup', id: 'agent', state: {} },
    alt: 'A coding agent session, in an illustration: it sets up TextButler and stops at the macOS permission prompt.',
  },
  {
    id: 'local',
    part: 'vision',
    headline: 'Keep reply writing on your Mac',
    post: 'A local model writes replies on your Mac. Conversation notes are plain files you can read and edit. Optional web search still sends queries through your saved Gateway key, and each conversation’s settings control whether search is available.',
    visual: { kind: 'diagram', src: 'd2-words-local' },
    alt: 'Diagram of local reply writing: GhostGet, TextButler, and Ollama run on the Mac.',
  },
  {
    id: 'limits',
    part: 'limits',
    headline: 'You stay in charge of every message',
    post: 'It starts paused, and every chat starts off. Ask for a draft to check its words and recipient before sending. Drafts expire after {draftExpiry}.',
    visual: { kind: 'mockup', id: 'draft', state: {} },
    alt: 'A terminal, in an illustration: a reply draft, who it goes to, and the review code that sends it.',
    facts: ['draftExpiry'],
  },
  {
    id: 'status',
    part: 'status',
    headline: 'Start with one conversation',
    post: '{status}. TextButler is free and MIT licensed. Ask your coding agent to follow the setup guide, then choose a conversation and review the first reply.',
    visual: { kind: 'diagram', src: 'd1-one-message' },
    alt: 'Diagram of one message, start to finish: a friend asks, five checks pass, and a marked reply goes back.',
    facts: ['status'],
  },
];

export const launchBeats: readonly LaunchBeat[] = resolveLaunchBeats(authoredBeats, launchFacts);

export const LAUNCH_POST_PATH = '/blog/introducing-textbutler';
export const LAUNCH_POST_URL = `${SITE_ORIGIN}${LAUNCH_POST_PATH}`;

// The registry keeps the frozen message-like-me id; its record is TextButler's.
const portfolio = product('message-like-me');

/**
 * The messaging record. The tagline is the portfolio tagline; the name and
 * one-line description are the site's, which spell it TextButler.
 */
export const launchMessaging: LaunchMessaging = {
  names: { name: SITE_NAME },
  tagline: portfolio.messaging.tagline,
  meta: SITE_WHAT_IT_IS,
};

export const launchRelease: LaunchRelease = {
  status: LAUNCH_STATUS,
  tags: ['Mac', 'Messaging', 'Artificial Intelligence'],
};

/** The setup guide covers local installation; no public prebuilt app is offered. */
export const launchKitOptions: LaunchKitOptions = {
  status: LAUNCH_STATUS,
  publicInstall: false,
  tagline: launchMessaging.tagline,
  canonicalUrl: LAUNCH_POST_URL,
  forbiddenNames: ['GhostReply', 'Message Like Me'],
};

export const socialKit: SocialKit = buildSocialKit(launchBeats, launchMessaging, launchRelease, LAUNCH_POST_URL);
assertLaunchKit(launchBeats, socialKit, launchKitOptions);
