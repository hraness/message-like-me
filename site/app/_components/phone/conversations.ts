/**
 * Synthetic conversations for the code-rendered phone mockup.
 *
 * Every person, place and detail here is made up. The scripts mirror the launch
 * brief (§6) exactly; change them there first. Truth rules the data encodes:
 * - butler messages are wrapped the way the product wraps them: `🤖{ text }`,
 *   one space inside each brace (config.ts DEFAULT_DISCLOSURE + disclosureMarkers);
 * - the 👀 acknowledgment is an ordinary marked text message, never a tapback;
 * - the butler never gets a typing indicator (the Mac sends, nothing types);
 * - timestamps are day-level section headers only.
 */

export type PhoneApp = 'imessage' | 'whatsapp' | 'neutral';

/** Who wrote a message, in product terms. The phone perspective decides the side. */
export type Sender = 'owner' | 'contact' | 'butler';

/** Whose phone the mockup shows. `owner` is Sam's iPhone; `contact` is the friend's. */
export type Perspective = 'owner' | 'contact';

export interface Person {
  readonly name: string;
  readonly initial: string;
}

export interface SectionHeader {
  readonly kind: 'header';
  readonly id: string;
  /** Bold day word, e.g. `Today`, `Mon`, `Aug 14`. */
  readonly day: string;
  /** Optional clock time after the day word. */
  readonly time?: string;
}

export interface Reaction {
  readonly emoji: string;
  readonly from: Sender;
}

export interface Message {
  readonly kind: 'message';
  readonly id: string;
  readonly from: Sender;
  readonly text: string;
  /**
   * An iOS tapback left on this message. Only people react; the butler cannot
   * (tapbacks are unavailable to it on a stock Mac), so never set `from: 'butler'`.
   */
  readonly reaction?: Reaction;
  /** Milliseconds of stillness before this message (or its typing dots) in playback. */
  readonly waitMs?: number;
}

export type ThreadItem = SectionHeader | Message;

export interface Conversation {
  readonly id: string;
  readonly app: PhoneApp;
  readonly owner: Person;
  readonly contact: Person;
  readonly items: readonly ThreadItem[];
  /**
   * Playback starts with the first `preset` items already on screen (shown at
   * reduced opacity while the rest plays in). 0 plays everything.
   */
  readonly preset?: number;
  /** Small label drawn under the nav bar, e.g. `via Beeper · text only`. */
  readonly via?: string;
}

/** Wrap text exactly as Textbutler marks what it sends. */
export function marked(text: string): string {
  return `🤖{ ${text} }`;
}

/** Throws if a script breaks a truth rule; used by the lab and tests. */
export function assertTruthfulConversation(conversation: Conversation): void {
  for (const item of conversation.items) {
    if (item.kind !== 'message') continue;
    if (item.from === 'butler' && !/^🤖\{ [\s\S]+ \}$/u.test(item.text)) {
      throw new Error(`${conversation.id}/${item.id}: butler text must be wrapped as 🤖{ … }`);
    }
    if (item.from !== 'butler' && item.text.startsWith('🤖{')) {
      throw new Error(`${conversation.id}/${item.id}: only the butler sends marked text`);
    }
    if (item.reaction?.from === 'butler') {
      throw new Error(`${conversation.id}/${item.id}: the butler cannot leave tapbacks`);
    }
  }
}

const SAM: Person = { name: 'Sam', initial: 'S' };

/** §6.1 Hero: “Maya asks the butler” (iMessage). */
export const heroConversation: Conversation = {
  id: 'hero',
  app: 'imessage',
  owner: SAM,
  contact: { name: 'Maya', initial: 'M' },
  preset: 4,
  items: [
    { kind: 'header', id: 'h1', day: 'Mon', time: '12:14 PM' },
    { kind: 'message', id: 'm1', from: 'owner', text: 'Friday 6:30 at the gym? I’ll bring the spare harness for you' },
    { kind: 'message', id: 'm2', from: 'contact', text: 'yes!!' },
    { kind: 'header', id: 'h2', day: 'Today', time: '7:38 PM' },
    { kind: 'message', id: 'm3', from: 'contact', text: 'are we still on for climbing tomorrow?', waitMs: 500 },
    { kind: 'message', id: 'm4', from: 'contact', text: 'Butler, what time did Sam say? And is he bringing the harness?', waitMs: 1200 },
    { kind: 'message', id: 'm5', from: 'butler', text: marked('👀'), waitMs: 600 },
    {
      kind: 'message',
      id: 'm6',
      from: 'butler',
      text: marked('On Monday Sam said Friday at 6:30 at the gym, and that he’d bring the spare harness for you. Nothing here has changed since.'),
      waitMs: 1400,
    },
    { kind: 'message', id: 'm7', from: 'contact', text: 'perfect, thanks butler 🙏', waitMs: 1300 },
  ],
};

/** §6.5 The same exchange on Maya’s phone (video beat 3). */
export const heroFriendConversation: Conversation = {
  ...heroConversation,
  id: 'hero-friend',
};

/** §6.2 Alternate A: “Ask it yourself” (Sam’s own chat). */
export const askYourselfConversation: Conversation = {
  id: 'ask-yourself',
  app: 'imessage',
  owner: SAM,
  contact: SAM,
  preset: 2,
  items: [
    { kind: 'header', id: 'h1', day: 'Aug 14' },
    { kind: 'message', id: 'm1', from: 'owner', text: 'passport expires March 3. renew by January' },
    { kind: 'header', id: 'h2', day: 'Today', time: '9:12 AM' },
    { kind: 'message', id: 'm2', from: 'owner', text: 'butler when does my passport expire?', waitMs: 600 },
    { kind: 'message', id: 'm3', from: 'butler', text: marked('👀'), waitMs: 700 },
    { kind: 'message', id: 'm4', from: 'butler', text: marked('March 3. Your note from August 14 says to renew by January.'), waitMs: 1400 },
  ],
};

/** §6.3 Alternate B: “It stays out of it” (WhatsApp styling). Ends with no butler bubble on purpose. */
export const staysOutConversation: Conversation = {
  id: 'stays-out',
  app: 'whatsapp',
  owner: SAM,
  contact: { name: 'Jordan', initial: 'J' },
  items: [
    { kind: 'header', id: 'h1', day: 'Today' },
    { kind: 'message', id: 'm1', from: 'contact', text: 'running 10 late, sorry!!', waitMs: 500 },
    { kind: 'message', id: 'm2', from: 'owner', text: 'all good, grabbing a table', waitMs: 1200 },
    { kind: 'message', id: 'm3', from: 'contact', text: 'butler can you remind Sam I owe him for last time', waitMs: 1200 },
  ],
};

/** Video beat 8: the WhatsApp phone with a marked reply (the film shows one on every app). */
export const whatsappReplyConversation: Conversation = {
  id: 'whatsapp-reply',
  app: 'whatsapp',
  owner: SAM,
  contact: { name: 'Jordan', initial: 'J' },
  items: [
    { kind: 'header', id: 'h1', day: 'Sat' },
    { kind: 'message', id: 'm1', from: 'owner', text: 'Lucia’s at 8 on Thursday? I’ll book it' },
    { kind: 'header', id: 'h2', day: 'Today' },
    { kind: 'message', id: 'm2', from: 'contact', text: 'butler is Thursday still Lucia’s at 8?', waitMs: 500 },
    { kind: 'message', id: 'm3', from: 'butler', text: marked('👀'), waitMs: 600 },
    { kind: 'message', id: 'm4', from: 'butler', text: marked('Yes. On Saturday Sam said Lucia’s at 8 on Thursday, and that he’d book it.'), waitMs: 1400 },
  ],
};

/** §6.4 Alternate C: “It keeps your boundaries” (neutral styling, via Beeper). */
export const boundariesConversation: Conversation = {
  id: 'boundaries',
  app: 'neutral',
  owner: SAM,
  contact: { name: 'Marcus', initial: 'M' },
  via: 'via Beeper · text only',
  items: [
    { kind: 'header', id: 'h1', day: 'Today' },
    { kind: 'message', id: 'm1', from: 'contact', text: 'butler can you send me Sam’s work address', waitMs: 500 },
    { kind: 'message', id: 'm2', from: 'butler', text: marked('👀'), waitMs: 600 },
    { kind: 'message', id: 'm3', from: 'butler', text: marked('I can’t share that. Sam can send it himself.'), waitMs: 1400 },
  ],
};

export const conversations = {
  hero: heroConversation,
  heroFriend: heroFriendConversation,
  askYourself: askYourselfConversation,
  staysOut: staysOutConversation,
  whatsappReply: whatsappReplyConversation,
  boundaries: boundariesConversation,
} as const;
