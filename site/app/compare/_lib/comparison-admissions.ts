import {
  isArticleIndexable,
  type ArticleAdmission,
  type ArticleIsoDate,
  type ArticleSourceRecord,
} from '@hraness/design-kit';
import { NOINDEX_ROBOTS } from '@hraness/web-discovery';
import type { Metadata } from 'next';

const CHECKED_ON: ArticleIsoDate = '2026-10-04';
const TEXTBUTLER_SOURCE_COMMIT = '0c00ab74531a510c145294397d655e9edfbd4bdc';
const source = (title: string, url: string): ArticleSourceRecord => ({ title, url, checkedOn: CHECKED_ON });
const textbutlerSource = (title: string, path: string): ArticleSourceRecord =>
  source(title, `https://github.com/hraness/textbutler/blob/${TEXTBUTLER_SOURCE_COMMIT}/${path}`);

const shared = {
  owner: 'Hraness (TextButler)',
  drafting: 'ai',
  review: { reviewer: 'Devin independent editorial review (AI), 2026-10-04', reviewerType: 'ai', reviewedOn: CHECKED_ON },
  humanReview: null,
  reassessOn: '2026-11-01',
  hostFit: 'TextButler owns the portfolio comparison for assistants that answer chats; GhostGet compares only ways agents reach the web.',
} as const;

const TEXTBUTLER_SOURCES: readonly ArticleSourceRecord[] = [
  textbutlerSource('Contact defaults: keyword, marker, and 5-minute wait', 'packages/textbutler/src/config.ts'),
  textbutlerSource('Reply tools a conversation plan can turn on', 'packages/textbutler/src/contact-habitat.ts'),
  textbutlerSource('Setup, reply writers, and the $1 daily Gateway cap', 'docs/textbutler/getting-started.md'),
  textbutlerSource('Messaging apps and the WhatsApp linked device', 'docs/textbutler/messaging-apps.md'),
];

const OPENCLAW_SOURCES: readonly ArticleSourceRecord[] = [
  source('OpenClaw site: platforms, models, license, and foundation', 'https://openclaw.ai'),
  source('OpenClaw README: channels, pairing, and host tools', 'https://github.com/openclaw/openclaw'),
  source('OpenClaw iMessage docs: imsg is the only iMessage path', 'https://docs.openclaw.ai/channels/imessage'),
  source('OpenClaw group docs: allowlists and mention gating', 'https://docs.openclaw.ai/channels/groups'),
  source('OpenClaw pairing docs: unknown senders wait for approval', 'https://docs.openclaw.ai/channels/pairing'),
  source('OpenClaw message docs: optional reply prefix', 'https://docs.openclaw.ai/concepts/messages'),
];

const HERMES_MESSAGING_URL = 'https://hermes-agent.nousresearch.com/docs/user-guide/messaging/';
const HERMES_SOURCES: readonly ArticleSourceRecord[] = [
  source('Hermes Agent site: license, apps, and Nous Portal pricing', 'https://hermes-agent.nousresearch.com'),
  source('Hermes Agent messaging gateway: allowlists and pairing', HERMES_MESSAGING_URL),
  source('Hermes Agent WhatsApp docs: bot number, groups, and reply header', `${HERMES_MESSAGING_URL}whatsapp`),
  source('Hermes Agent BlueBubbles docs: iMessage through your Mac', `${HERMES_MESSAGING_URL}bluebubbles`),
  source('Hermes Agent Photon docs: a hosted iMessage line', `${HERMES_MESSAGING_URL}photon`),
];

const POKE_SOURCES: readonly ArticleSourceRecord[] = [
  source('Poke site: messaging apps, plans, and connected services', 'https://poke.com'),
];

const META_AI_SOURCES: readonly ArticleSourceRecord[] = [
  source('WhatsApp Meta AI page: chats, groups, and Private Processing', 'https://www.whatsapp.com/meta-ai'),
];

const GHOSTREPLY_SOURCES: readonly ArticleSourceRecord[] = [
  source('GhostReply product page: price, trial, and setup', 'https://ghostreply.lol/'),
  source('GhostReply privacy details: local profile and hosted AI', 'https://ghostreply.lol/privacy.html'),
  source('GhostReply safety guide: scope, takeover, and disclosure advice', 'https://ghostreply.lol/is-ai-imessage-auto-reply-safe.html'),
];

export const COMPARISON_ADMISSIONS: readonly ArticleAdmission[] = [
  {
    ...shared,
    href: '/compare',
    lifecycle: 'indexable',
    readerJob: 'Find an AI assistant that works in my texts, and see which ones answer other people in my existing chats instead of only me.',
    nonObviousAnswer: 'OpenClaw, Hermes Agent, Poke, and Meta AI are assistants you message; GhostReply and TextButler answer other people in your own chats, and they differ on groups, AI choice, and whether replies are labeled.',
    originalContribution: 'One table that lines up who each assistant answers, where it runs, its price, and how replies are labeled, with each cell read from that product’s own pages on the check date.',
    nearestUrls: [
      { url: 'https://textbutler.app/', distinction: 'The homepage presents TextButler and its setup; the hub compares it with other assistants.' },
      { url: 'https://textbutler.app/compare/openclaw', distinction: 'Each comparison page covers one product in depth; Poke has only its hub row and question.' },
    ],
    sources: [...OPENCLAW_SOURCES.slice(0, 1), HERMES_SOURCES[0]!, ...POKE_SOURCES, ...META_AI_SOURCES, GHOSTREPLY_SOURCES[0]!, ...TEXTBUTLER_SOURCES],
    observations: [
      'The standalone Poke page was folded into this hub: Poke answers only the person who texts it, so its row and one question cover the comparison, and /compare/poke redirects here.',
      'The recheck changed two hub cells. OpenClaw documents an optional reply prefix, and Hermes Agent’s WhatsApp replies start with a “☤ Hermes Agent” header by default, so neither row says “Not described” any more.',
    ],
    scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    harmIfWrong: 'A reader could pick an assistant that answers the wrong people, costs more than shown, or sends replies without the label they expect.',
    refreshTriggers: [
      'A price or plan change on any listed product’s page',
      'A listed product adds or removes a messaging app, group behavior, or reply label',
      'TextButler changes its default trigger, marker, or reply writers',
    ],
  },
  {
    ...shared,
    href: '/compare/openclaw',
    lifecycle: 'indexable',
    readerJob: 'Decide whether OpenClaw or TextButler should handle my iMessage and WhatsApp chats, and whether OpenClaw can answer my friends for me.',
    nonObviousAnswer: 'OpenClaw lives on your own accounts and can answer allowlisted groups when mentioned, but it is an agent with shell, file, and browser tools that you message; TextButler answers only in the conversations you turn on, and its reply model has no shell.',
    originalContribution: 'Lines up OpenClaw’s documented group, pairing, iMessage, and reply prefix behavior against TextButler’s per-conversation defaults, with a dated source for each cell.',
    nearestUrls: [
      { url: 'https://textbutler.app/compare', distinction: 'The hub keeps one row per product; this page explains OpenClaw’s groups, pairing, iMessage path, and tool access.' },
      { url: 'https://textbutler.app/compare/hermes-agent', distinction: 'Hermes Agent recommends a separate bot number and reaches iMessage through BlueBubbles or Photon; OpenClaw uses your own accounts and imsg.' },
    ],
    sources: [...OPENCLAW_SOURCES, ...TEXTBUTLER_SOURCES],
    observations: [
      'OpenClaw’s iMessage docs say it supports iMessage through imsg only and that BlueBubbles support was removed; the page names imsg and no other iMessage path.',
      'The “Marks replies as AI” cell changed from “Not described” to an optional reply prefix, because OpenClaw’s message docs describe a prefix you can set per channel and account.',
    ],
    scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    harmIfWrong: 'A reader could expect OpenClaw to stay out of their groups, or give an agent with shell access chats they meant to keep separate.',
    refreshTriggers: [
      'OpenClaw changes its iMessage path, group defaults, or pairing',
      'OpenClaw changes its reply prefix settings',
      'An OpenClaw release changes supported platforms or the license',
    ],
  },
  {
    ...shared,
    href: '/compare/hermes-agent',
    lifecycle: 'indexable',
    readerJob: 'Decide between Hermes Agent and TextButler for iMessage and WhatsApp, including whose number answers and which group messages get replies.',
    nonObviousAnswer: 'Hermes Agent’s docs steer WhatsApp to a dedicated bot number and give iMessage either a BlueBubbles Mac with your Apple ID or a Photon line, and it answers every admitted group message by default; TextButler answers from your own accounts and waits for “butler”.',
    originalContribution: 'Separates Hermes Agent’s two iMessage paths and its WhatsApp number advice, which the OpenClaw page does not cover, and dates each cell.',
    nearestUrls: [
      { url: 'https://textbutler.app/compare/openclaw', distinction: 'Both are self-hosted agents you message, but OpenClaw lives on your own accounts and needs a mention in allowlisted groups, while Hermes Agent suggests a separate number and answers every admitted group message by default.' },
      { url: 'https://textbutler.app/compare', distinction: 'The hub keeps one row per product; this page explains numbers, iMessage paths, and group defaults.' },
    ],
    sources: [...HERMES_SOURCES, ...TEXTBUTLER_SOURCES],
    observations: [
      'Hermes Agent’s Photon docs describe a hosted iMessage line that needs no Mac, so the page no longer says its iMessage connection needs an always-on Mac.',
      'Its WhatsApp docs say replies start with a “☤ Hermes Agent” header by default, which you can change or turn off; the table now shows that header instead of “Not described”.',
    ],
    scores: { readerUtility: 1, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    harmIfWrong: 'A reader could link Hermes Agent to a personal WhatsApp number expecting quiet groups, or assume iMessage needs a Mac when Photon assigns a separate line.',
    refreshTriggers: [
      'Hermes Agent changes its WhatsApp bridge, number advice, or reply header',
      'Hermes Agent adds or removes an iMessage path',
      'Nous Portal pricing changes',
    ],
  },
  {
    ...shared,
    href: '/compare/poke',
    lifecycle: 'archived',
    readerJob: 'Find out whether Poke can answer my friends’ texts the way TextButler does.',
    nonObviousAnswer: 'Poke answers only the person who texts it; it is a hosted contact for your own email, calendar, and tasks, so one hub row and one question answer the comparison.',
    originalContribution: 'Nothing beyond the hub row; the standalone page repeated it.',
    nearestUrls: [
      { url: 'https://textbutler.app/compare', distinction: 'Merged: the hub row and its Poke question answer the same need, so this URL redirects there.' },
    ],
    sources: [...POKE_SOURCES],
    observations: [
      'Scored 8 of 12 (reader utility 1, original evidence 1, host fit 1, maintenance 1): Poke never answers your contacts, so a full page adds little to the hub row.',
      'The URL redirects permanently to /compare, which lists Poke’s plans and answers whether Poke replies to your friends.',
    ],
    scores: { readerUtility: 1, originalEvidence: 1, factualConfidence: 2, hostFit: 1, voiceIntegrity: 2, maintenanceValue: 1 },
    harmIfWrong: 'A reader could think Poke answers other people for them.',
    refreshTriggers: ['Poke starts answering other people in your conversations', 'Poke changes its plans or messaging apps'],
  },
  {
    ...shared,
    href: '/compare/meta-ai-whatsapp',
    lifecycle: 'indexable',
    readerJob: 'Find out whether I can use my own AI model in WhatsApp chats instead of Meta AI, and how that differs from Meta AI in groups.',
    nonObviousAnswer: 'Meta AI is the assistant built into WhatsApp and you do not choose its model; TextButler answers in your WhatsApp chats from your own linked account with the model you choose, and it also covers iMessage and Beeper.',
    originalContribution: 'Contrasts who answers in a group, Meta AI itself or your own account with a marker, and where messages are processed, from WhatsApp’s own page.',
    nearestUrls: [
      { url: 'https://textbutler.app/compare', distinction: 'The hub keeps one row per product; this page answers the model-choice and group questions for WhatsApp.' },
    ],
    sources: [...META_AI_SOURCES, ...TEXTBUTLER_SOURCES],
    observations: [
      'WhatsApp’s page says Meta AI features may not be available to all users, and the page repeats that limit instead of promising features.',
      'TextButler reaches WhatsApp as a linked device through GhostGet’s unofficial client, and the page says so beside the comparison.',
    ],
    scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    harmIfWrong: 'A reader could expect to swap Meta AI’s model, or miss that TextButler’s WhatsApp link is unofficial.',
    refreshTriggers: [
      'WhatsApp changes Meta AI features or adds a model choice',
      'GhostGet’s WhatsApp connection changes',
      'TextButler changes its reply writers',
    ],
  },
  {
    ...shared,
    href: '/compare/ghostreply',
    lifecycle: 'indexable',
    readerJob: 'Decide between GhostReply and TextButler for automatic iMessage replies on a Mac, including cost, AI choice, and whether replies say they were automated.',
    nonObviousAnswer: 'GhostReply writes one-to-one iMessage replies in your style with hosted AI included for $4.99 and describes no visible marker; TextButler is free, marks replies by default, keeps notes for each conversation, and lets you choose a local or subscription model.',
    originalContribution: 'Pulls GhostReply’s data path, takeover rule, and safety advice from its own privacy and safety pages and sets them beside TextButler’s defaults.',
    nearestUrls: [
      { url: 'https://textbutler.app/compare', distinction: 'The hub keeps one row per product; this page explains GhostReply’s data path, takeover, and safety advice.' },
    ],
    sources: [...GHOSTREPLY_SOURCES, ...TEXTBUTLER_SOURCES],
    observations: [
      'GhostReply’s own safety guide recommends telling contacts when AI help would matter, and the page cites that advice instead of calling GhostReply undisclosed.',
      'Every GhostReply cell matched its product, privacy, and safety pages on the check date, so no GhostReply fact changed.',
    ],
    scores: { readerUtility: 2, originalEvidence: 1, factualConfidence: 2, hostFit: 2, voiceIntegrity: 2, maintenanceValue: 1 },
    harmIfWrong: 'A reader could pay for the wrong tool, or send unmarked automated replies to people who expect to hear from them directly.',
    refreshTriggers: [
      'GhostReply changes its price, trial, AI provider, or scope',
      'GhostReply adds a reply marker or group chats',
      'TextButler changes its marker or default trigger',
    ],
  },
];

export function comparisonAdmission(path: string): ArticleAdmission {
  const admission = COMPARISON_ADMISSIONS.find((entry) => entry.href === path);
  if (admission === undefined) throw new Error(`No admission record for ${path}`);
  return admission;
}

export function isIndexableComparison(path: string): boolean {
  const admission = COMPARISON_ADMISSIONS.find((entry) => entry.href === path);
  return admission !== undefined && isArticleIndexable(admission);
}

export function comparisonRobots(path: string): Pick<Metadata, 'robots'> {
  return isIndexableComparison(path) ? {} : { robots: NOINDEX_ROBOTS };
}
