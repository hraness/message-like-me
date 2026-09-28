import type { PhoneApp, Reaction } from './conversations';
import { DoubleTickGlyph } from './glyphs';
import styles from './phone.module.css';

export type BubbleSide = 'in' | 'out';

export interface BubbleProps {
  readonly side: BubbleSide;
  readonly app: PhoneApp;
  readonly text: string;
  /** Last bubble of a same-side run: draws the iOS tail. */
  readonly tail: boolean;
  /** First bubble of a same-side run: WhatsApp draws its tail at the top. */
  readonly first: boolean;
  /** Side the reacting person sits on, when a tapback is shown. */
  readonly reaction?: Reaction & { readonly side: BubbleSide };
  readonly marked?: boolean;
}

/**
 * The iOS Messages tail: a concave hook that leaves the bubble's straight edge
 * and flicks out past the bottom corner. Drawn for the right side; the left tail
 * mirrors it. Coordinates are relative to the bubble's bottom-right corner.
 */
const TAIL_PATH =
  'M-16 -17.5H0C0 -7.6 1.7 -2.4 6.4 -0.45 6.95 -0.2 6.85 0.45 6.2 0.5 2.6 0.7 -1.2 -0.6 -3.4 -2.5 -4.3 -3.3 -5.2 -4.1 -6 -4.9L-16 -17.5Z';

/** WhatsApp's small corner flag on the first bubble of a run (top outer corner). */
const WA_TAIL_PATH = 'M-6 0H7.2C8.3 0 8.8 1.3 8.1 2.1L0 11V0H-6Z';

export function Bubble({ side, app, text, tail, first, reaction, marked }: BubbleProps) {
  const emojiOnly = isEmojiOnly(text);
  return (
    <div
      className={styles.bubble}
      data-side={side}
      data-tail={app === 'whatsapp' ? (first ? 'top' : undefined) : tail ? 'bottom' : undefined}
      data-emoji-only={emojiOnly || undefined}
      data-marked={marked || undefined}
    >
      <span className={styles.bubbleText}>{text}</span>
      {app === 'whatsapp' && side === 'out' ? (
        <span className={styles.waMeta} aria-hidden="true">
          <DoubleTickGlyph className={styles.waTick} />
        </span>
      ) : null}
      {app === 'whatsapp' && side === 'in' ? <span className={styles.waMetaSpacer} aria-hidden="true" /> : null}
      {app !== 'whatsapp' && tail && !emojiOnly ? (
        <svg className={styles.tail} viewBox="-16 -17.5 23 18" aria-hidden="true" focusable="false">
          <path d={TAIL_PATH} />
        </svg>
      ) : null}
      {app === 'whatsapp' && first ? (
        <svg className={styles.waTail} viewBox="-6 0 14.6 11" aria-hidden="true" focusable="false">
          <path d={WA_TAIL_PATH} />
        </svg>
      ) : null}
      {reaction ? <Tapback emoji={reaction.emoji} side={reaction.side} /> : null}
    </div>
  );
}

/** An iOS tapback badge pinned to the bubble's top outer corner. */
export function Tapback({ emoji, side }: { readonly emoji: string; readonly side: BubbleSide }) {
  return (
    <span className={styles.tapback} data-reactor={side} aria-hidden="true">
      <span className={styles.tapbackEmoji}>{emoji}</span>
      <span className={styles.tapbackDotLarge} />
      <span className={styles.tapbackDotSmall} />
    </span>
  );
}

/** iOS renders one to three emoji with no text as large, bubble-free glyphs. */
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}‍️\s]+$/u.test(trimmed)) return false;
  if (/[0-9#*]/u.test(trimmed)) return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = [...segmenter.segment(trimmed.replace(/\s+/gu, ''))];
  return graphemes.length <= 3;
}
