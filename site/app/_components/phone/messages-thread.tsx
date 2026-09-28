import { Fragment } from 'react';

import { Bubble, type BubbleSide } from './bubble';
import type { Conversation, Message, Perspective, Person, Sender, ThreadItem } from './conversations';
import {
  BackChevronGlyph,
  CameraGlyph,
  MicGlyph,
  PhoneGlyph,
  PlusGlyph,
  SmallChevronGlyph,
  VideoGlyph,
} from './glyphs';
import styles from './phone.module.css';
import { TypingIndicator } from './typing-indicator';

export type PlaybackPhase = 'final' | 'playing' | 'hold' | 'fading';

export interface MessagesScreenProps {
  readonly conversation: Conversation;
  readonly perspective?: Perspective;
  /** How many thread items are on screen. Defaults to all of them. */
  readonly visibleCount?: number;
  /** A message currently shown as typing dots instead of its bubble. */
  readonly typingId?: string;
  readonly phase?: PlaybackPhase;
}

/** Which side of the screen a sender's message sits on, from this phone's point of view. */
export function sideFor(from: Sender, perspective: Perspective): BubbleSide {
  if (perspective === 'owner') return from === 'contact' ? 'in' : 'out';
  return from === 'contact' ? 'out' : 'in';
}

/** The other party in the header: the contact on the owner's phone, the owner on the contact's. */
export function counterpart(conversation: Conversation, perspective: Perspective): Person {
  return perspective === 'owner' ? conversation.contact : conversation.owner;
}

/** iOS Messages (or WhatsApp) chrome and thread for one conversation, inside the phone screen. */
export function MessagesScreen({
  conversation,
  perspective = 'owner',
  visibleCount,
  typingId,
  phase = 'final',
}: MessagesScreenProps) {
  const { app, items } = conversation;
  const count = visibleCount ?? items.length;
  const preset = conversation.preset ?? 0;
  const shown = items.slice(0, count);
  const typingIndex = typingId ? items.findIndex((item) => item.id === typingId) : -1;
  const rows: { item: ThreadItem; index: number; typing: boolean }[] = shown.map((item, index) => ({ item, index, typing: false }));
  if (typingIndex >= count) rows.push({ item: items[typingIndex]!, index: typingIndex, typing: true });

  const sides = rows.map(({ item }) => (item.kind === 'message' ? sideFor(item.from, perspective) : null));
  const lastMessageRow = findLastIndex(rows, ({ item }) => item.kind === 'message');
  const receiptRow =
    app !== 'whatsapp' && lastMessageRow >= 0 && !rows[lastMessageRow]!.typing && sides[lastMessageRow] === 'out'
      ? lastMessageRow
      : -1;
  const playing = phase === 'playing';

  return (
    <div className={styles.messages} data-app={app} data-phase={phase}>
      <div className={styles.thread}>
        <div className={styles.threadInner}>
          {rows.map(({ item, index, typing }, rowIndex) => {
            const enter = playing && index >= preset ? true : undefined;
            if (item.kind === 'header') {
              return (
                <div key={item.id} className={styles.sectionHeader} data-enter={enter}>
                  <span className={styles.sectionHeaderText}>
                    <b>{item.day}</b>
                    {item.time ? ` ${item.time}` : null}
                  </span>
                </div>
              );
            }
            const side = sides[rowIndex]!;
            const prevSide = rowIndex > 0 ? sides[rowIndex - 1] : null;
            const nextSide = rowIndex < rows.length - 1 ? sides[rowIndex + 1] : null;
            const first = prevSide !== side;
            const last = nextSide !== side;
            const reaction = item.reaction
              ? { ...item.reaction, side: sideFor(item.reaction.from, perspective) }
              : undefined;
            return (
              <Fragment key={item.id}>
                <div
                  className={styles.row}
                  data-side={side}
                  data-first={first || undefined}
                  data-last={last || undefined}
                  data-history={index < preset && item.kind === 'message' ? true : undefined}
                  data-reaction={reaction ? true : undefined}
                  data-enter={enter}
                >
                  <div className={styles.rowInner}>
                    {typing ? (
                      <TypingIndicator />
                    ) : (
                      <Bubble
                        side={side}
                        app={app}
                        text={item.text}
                        tail={last}
                        first={first}
                        reaction={reaction}
                        marked={item.from === 'butler'}
                      />
                    )}
                  </div>
                </div>
                {rowIndex === receiptRow ? (
                  <div className={styles.receipt} data-enter={enter}>
                    Delivered
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </div>
      <NavBar conversation={conversation} perspective={perspective} />
      <Composer conversation={conversation} />
    </div>
  );
}

function NavBar({ conversation, perspective }: { readonly conversation: Conversation; readonly perspective: Perspective }) {
  const person = counterpart(conversation, perspective);
  if (conversation.app === 'whatsapp') {
    return (
      <div className={styles.navBar} aria-hidden="true">
        <div className={styles.waNav}>
          <BackChevronGlyph className={styles.navBack} />
          <span className={styles.waAvatar}>{person.initial}</span>
          <span className={styles.waName}>{person.name}</span>
          <span className={styles.waActions}>
            <VideoGlyph className={styles.navVideo} />
            <PhoneGlyph className={styles.navPhone} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.navBar} aria-hidden="true">
      <div className={styles.imNav}>
        <BackChevronGlyph className={styles.navBack} />
        <span className={styles.imContact}>
          <span className={styles.avatar}>{person.initial}</span>
          <span className={styles.imName}>
            {person.name}
            <SmallChevronGlyph className={styles.nameChevron} />
          </span>
          {conversation.via ? <span className={styles.via}>{conversation.via}</span> : null}
        </span>
        <VideoGlyph className={styles.navVideo} />
      </div>
    </div>
  );
}

function Composer({ conversation }: { readonly conversation: Conversation }) {
  if (conversation.app === 'whatsapp') {
    return (
      <div className={styles.composer} aria-hidden="true">
        <div className={styles.waComposer}>
          <PlusGlyph className={styles.waComposerPlus} />
          <span className={styles.waField} />
          <CameraGlyph className={styles.waComposerIcon} />
          <MicGlyph className={styles.waComposerIcon} />
        </div>
      </div>
    );
  }
  return (
    <div className={styles.composer} aria-hidden="true">
      <div className={styles.imComposer}>
        <span className={styles.plusButton}>
          <PlusGlyph className={styles.plusGlyph} />
        </span>
        <span className={styles.field}>
          <span className={styles.placeholder}>{conversation.app === 'imessage' ? 'iMessage' : 'Message'}</span>
          <MicGlyph className={styles.fieldMic} />
        </span>
      </div>
    </div>
  );
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

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) if (predicate(values[index]!)) return index;
  return -1;
}
