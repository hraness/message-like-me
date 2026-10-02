import { parseScene, type Scene } from '@hraness/textmockups';

import type { Conversation, Message, Perspective, Person, Sender } from './conversations';

/**
 * Turns a TextButler conversation into a Textmock scene, so the phone is drawn
 * by @hraness/textmockups (the renderer behind textmock.com).
 *
 * The scene carries the playback script as a Textmock timeline: messages appear
 * at their `at` second, and people (never the butler) show typing dots first.
 * Rendering without a time shows the finished conversation.
 */

export type SceneTheme = 'light' | 'dark';
export type BubbleSide = 'in' | 'out';

/** Seconds of typing dots before a person's message. */
export const TYPING_SECONDS = 1.1;
/** Seconds the history (preset) messages take to return to full opacity at the end. */
const UNDIM_SECONDS = 0.7;
const HISTORY_OPACITY = 0.55;

/** Which side of the screen a sender's message sits on, from this phone's point of view. */
export function sideFor(from: Sender, perspective: Perspective): BubbleSide {
  if (perspective === 'owner') return from === 'contact' ? 'in' : 'out';
  return from === 'contact' ? 'out' : 'in';
}

/** The other party in the header: the contact on the owner's phone, the owner on the contact's. */
export function counterpart(conversation: Conversation, perspective: Perspective): Person {
  return perspective === 'owner' ? conversation.contact : conversation.owner;
}

/** The butler sends from the owner's account, so it shares the owner's participant. */
const participantFor = (from: Sender) => (from === 'contact' ? 'contact' : 'owner');

interface Timed {
  readonly message: Message;
  readonly at: number;
  readonly dateLabel: string;
  readonly typingFrom?: number;
  readonly history: boolean;
}

/** The playback schedule, in seconds: when each message lands and when its typing dots start. */
export function schedule(conversation: Conversation, perspective: Perspective): { timed: Timed[]; end: number } {
  const preset = conversation.preset ?? 0;
  const timed: Timed[] = [];
  let t = 0;
  let pendingLabel = '';
  conversation.items.forEach((item, index) => {
    const history = index < preset;
    if (item.kind === 'header') {
      if (!history) t += 0.3;
      pendingLabel = item.time ? `${item.day} ${item.time}` : item.day;
      return;
    }
    let typingFrom: number | undefined;
    if (!history) {
      t += (item.waitMs ?? 700) / 1000;
      const typedByAPerson = item.from !== 'butler' && sideFor(item.from, perspective) === 'in';
      if (typedByAPerson) {
        typingFrom = t;
        t += TYPING_SECONDS;
      }
    }
    timed.push({ message: item, at: history ? 0 : t, dateLabel: pendingLabel, typingFrom, history });
    pendingLabel = '';
  });
  return { timed, end: t };
}

export interface SceneOptions {
  readonly perspective?: Perspective;
  readonly theme: SceneTheme;
  /** Device height in points; shorter phones hug short threads. */
  readonly screenHeight?: number;
  /** Seconds the finished conversation holds at the end of the timeline. */
  readonly holdSeconds?: number;
}

export function conversationScene(conversation: Conversation, options: SceneOptions): Scene {
  const perspective = options.perspective ?? 'owner';
  const { timed, end } = schedule(conversation, perspective);
  const hold = options.holdSeconds ?? 2.5;
  const duration = Math.max(0.1, end + hold);
  const whatsapp = conversation.app === 'whatsapp';
  const person = counterpart(conversation, perspective);
  const self = perspective === 'owner' ? 'owner' : 'contact';
  const lastOut = timed.findLastIndex(({ message }) => sideFor(message.from, perspective) === 'out');
  const tracks: Scene['timeline']['tracks'] = [];

  const typing = timed.filter((entry) => entry.typingFrom !== undefined);
  if (typing.length > 0) {
    tracks.push({
      id: 'typing',
      path: '/composer/typing/visible',
      keyframes: [
        { at: 0, value: false, easing: 'step' },
        ...typing.flatMap((entry) => [
          { at: entry.typingFrom!, value: true, easing: 'step' as const },
          { at: entry.at, value: false, easing: 'step' as const },
        ]),
      ],
    });
  }
  // History stays dimmed while the new exchange plays in, then returns.
  if (end > 0) {
    timed.forEach((entry, index) => {
      if (!entry.history) return;
      tracks.push({
        id: `history-${index}`,
        path: `/messages/${index}/presentation/opacity`,
        keyframes: [
          { at: 0, value: HISTORY_OPACITY, easing: 'step' },
          { at: end, value: HISTORY_OPACITY, easing: 'step' },
          { at: end + UNDIM_SECONDS, value: 1, easing: 'ease' },
        ],
      });
    });
  }

  return parseScene({
    version: 1,
    id: `textbutler-${conversation.id}-${perspective}-${options.theme}`,
    title: conversation.id,
    platform: whatsapp ? 'whatsapp' : 'imessage',
    theme: options.theme,
    device: { frame: 'iphone', width: 393, height: options.screenHeight ?? 852, scale: 1 },
    participants: [
      { id: 'owner', name: conversation.owner.name, isSelf: self === 'owner' },
      { id: 'contact', name: conversation.contact.name, isSelf: self === 'contact' },
    ],
    contact: {
      name: person.name,
      subtitle: conversation.via ?? (whatsapp ? 'online' : ''),
      participantIds: [self === 'owner' ? 'contact' : 'owner'],
    },
    messages: timed.map(({ message, at, dateLabel }, index) => {
      const out = sideFor(message.from, perspective) === 'out';
      return {
        id: message.id,
        senderId: participantFor(message.from),
        at,
        text: message.text,
        dateLabel,
        timestamp: whatsapp ? (message.time ?? '') : '',
        ...(out && (whatsapp || index === lastOut) ? { status: whatsapp ? 'read' : 'delivered' } : {}),
        reactions: message.reaction
          ? [{ id: `${message.id}-reaction`, emoji: message.reaction.emoji, participantId: participantFor(message.reaction.from), at }]
          : [],
      };
    }),
    composer: {
      placeholder: whatsapp ? '' : conversation.app === 'imessage' ? 'iMessage' : 'Message',
      typing: { visible: false, participantId: self === 'owner' ? 'contact' : 'owner' },
    },
    timeline: { duration, loop: false, fps: 30, tracks },
  });
}

/** Reads the whole conversation, in order, for the phone's accessible name. */
export function describeConversation(conversation: Conversation, perspective: Perspective = 'owner'): string {
  const appName = { imessage: 'iMessage', whatsapp: 'WhatsApp', neutral: 'messaging' }[conversation.app];
  const phoneOwner = perspective === 'owner' ? conversation.owner.name : conversation.contact.name;
  const other = counterpart(conversation, perspective).name;
  const self = conversation.owner === conversation.contact || conversation.owner.name === conversation.contact.name;
  const intro = self
    ? `Example ${appName} conversation: ${phoneOwner}’s chat with himself, on his phone.`
    : `Example ${appName} conversation on ${phoneOwner}’s phone with ${other}.`;
  const lines = conversation.items.map((item) => {
    if (item.kind === 'header') return `${item.day}${item.time ? ` ${item.time}` : ''}.`;
    const ends = /[.!?…}\p{Extended_Pictographic}]$/u.test(item.text.trim());
    return `${speaker(item, conversation)}: ${item.text}${ends ? '' : '.'}`;
  });
  return [intro, ...lines, 'The people are made up.'].join(' ');
}

function speaker(message: Message, conversation: Conversation): string {
  if (message.from === 'butler') return `${conversation.owner.name}’s butler, marked`;
  return message.from === 'owner' ? conversation.owner.name : conversation.contact.name;
}
