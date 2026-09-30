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
    post: 'TextButler is an AI butler that lives in the iMessage, WhatsApp, and Beeper chats you pick on your Mac. When a friend writes “butler”, it answers for you, clearly marked as AI. Nobody else has to use a new app.',
    socialPost: 'TextButler is an AI butler that lives in the text chats you pick on your Mac. When a friend writes “butler”, it answers for you, clearly marked as AI. Nobody else has to use a new app.',
    visual: { kind: 'mockup', id: 'thread', state: { app: 'messages', scene: 'plans' } },
    alt: 'A phone chat, in an illustration with made-up names: a friend asks the butler about plans, and a marked reply answers.',
  },
  {
    id: 'marked',
    part: 'does',
    headline: 'Everything it sends is marked as AI',
    post: 'Every message from the butler comes wrapped in a robot marker, so nobody mistakes it for you. First a quick eyes emoji so your friend knows it heard them, then the answer. You can change the marker for one person.',
    visual: { kind: 'mockup', id: 'marker', state: {} },
    alt: 'Two marked replies up close, in an illustration: the eyes acknowledgment, then the answer, each wrapped in the robot marker.',
  },
  {
    id: 'quiet',
    part: 'does',
    headline: 'Most of the time it stays quiet',
    post: 'It only answers in one-to-one chats you turned on, and only when asked. It waits {cooldown} after you last wrote, sends at most {hourlyCap} replies an hour to one person, and never joins group chats.',
    visual: { kind: 'diagram', src: 'd4-five-checks' },
    alt: 'Diagram of five checks before it speaks: turned on, one-to-one, asked, you have been quiet, under the hourly limit.',
    facts: ['cooldown', 'hourlyCap'],
  },
  {
    id: 'apps',
    part: 'does',
    headline: 'Built for the apps your friends already use',
    post: 'Replies over iMessage have worked end to end in our testing. WhatsApp, and Beeper with Signal, Telegram, Instagram, and more, are not yet tested live, so try them on your own account first.',
    socialPost: 'It works in iMessage today. A friend texts “butler”, and a marked reply comes back from your Mac. Your friend just texts like always.',
    visual: { kind: 'mockup', id: 'thread', state: { app: 'others', scene: 'dinner-and-address' } },
    alt: 'Illustration: WhatsApp-style and Beeper-style chats with made-up names. Neither app is tested live yet.',
  },
  {
    id: 'writers',
    part: 'how',
    headline: 'You pick what writes the replies',
    post: 'Pick one of {replyWriters}: a local model that writes on your Mac with no subscription (in testing), your Claude Code, Codex, or Devin subscription, or your own Vercel AI Gateway key, capped at {gatewayBudget} a day. TextButler AI credits are coming soon.',
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
    post: 'It is for people who already use Claude Code, Codex, or Devin. Paste one prompt and your agent does the setup. You click the macOS permission prompts, pick what writes replies, and turn on one person.',
    visual: { kind: 'mockup', id: 'agent', state: {} },
    alt: 'A coding agent session, in an illustration: it sets up TextButler and stops at the macOS permission prompt.',
  },
  {
    id: 'local',
    part: 'vision',
    headline: 'Where it is heading: replies written on your Mac',
    post: 'Your messages already live on your Mac. With a local model the reply gets written there too, and nothing leaves your Mac to write it. That is where TextButler is heading as the default, once testing is done.',
    socialPost: 'Your messages already live on your Mac. With a local model the reply gets written there too, and nothing leaves your Mac to write it. That is where TextButler is heading.',
    visual: { kind: 'diagram', src: 'd2-words-local' },
    alt: 'Diagram of where your words go with a local model: everything stays inside your Mac.',
  },
  {
    id: 'limits',
    part: 'limits',
    headline: 'You stay in charge of every message',
    post: 'It starts paused, and every chat starts off. Group chats and SMS are not supported. Prefer to read first: ask for a draft, and only the words you read get sent. Drafts expire after {draftExpiry}.',
    visual: { kind: 'mockup', id: 'draft', state: {} },
    alt: 'A terminal, in an illustration: a reply draft, who it goes to, and the review code that sends it.',
    facts: ['draftExpiry'],
  },
  {
    id: 'status',
    part: 'status',
    headline: 'TextButler is in development',
    post: 'Status: {status}. It runs on your Mac, built from its open source code, and it is free and MIT licensed. There is no app store listing yet. Pick one friend and see how it goes.',
    socialPost: 'Status: {status}. It runs on your Mac, built from its open source code, and it is free and MIT licensed. Pick one friend and see how it goes.',
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

/** No public install: TextButler runs from source and has no app to download yet. */
export const launchKitOptions: LaunchKitOptions = {
  status: LAUNCH_STATUS,
  publicInstall: false,
  tagline: launchMessaging.tagline,
  canonicalUrl: LAUNCH_POST_URL,
  forbiddenNames: ['GhostReply'],
};

export const socialKit: SocialKit = buildSocialKit(launchBeats, launchMessaging, launchRelease, LAUNCH_POST_URL);
assertLaunchKit(launchBeats, socialKit, launchKitOptions);
