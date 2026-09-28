import type { CSSProperties, Ref } from 'react';

import type { Conversation, Perspective } from './conversations';
import { describeConversation, MessagesScreen, type PlaybackPhase } from './messages-thread';
import { PhoneFrame } from './phone-frame';
import styles from './phone.module.css';

export type PhoneTheme = 'auto' | 'light' | 'dark';

export interface PhoneMockProps {
  readonly conversation: Conversation;
  /** Whose phone this is. `owner` (default) is Sam’s iPhone; `contact` shows the friend’s view. */
  readonly perspective?: Perspective;
  /** `auto` follows the page’s Paper color scheme; `light`/`dark` force one. */
  readonly theme?: PhoneTheme;
  /** Maximum rendered width in CSS pixels. The phone scales down to its container. */
  readonly maxWidth?: number;
  /**
   * Screen height in iOS points (default 844, a full iPhone). A shorter screen
   * crops the empty top of a short thread so the device hugs the conversation.
   */
  readonly screenHeight?: number;
  /** Overrides the generated accessible name (a full reading of the conversation). */
  readonly label?: string;
  readonly className?: string;
  /** Ref to the root element (the player observes it for scroll-into-view). */
  readonly ref?: Ref<HTMLDivElement>;
  /** Internal: playback state from `PhoneMockPlayer`. */
  readonly visibleCount?: number;
  readonly typingId?: string;
  readonly phase?: PlaybackPhase;
}

/**
 * A code-rendered iPhone showing a synthetic Messages conversation.
 * Static and server-safe (no scripts): use it in pages that must render without
 * JavaScript, blog image capture and video scenes. `PhoneMockPlayer` adds
 * scripted playback on top of the same markup.
 */
export function PhoneMock({
  conversation,
  perspective = 'owner',
  theme = 'auto',
  maxWidth,
  screenHeight,
  label,
  className,
  ref,
  visibleCount,
  typingId,
  phase,
}: PhoneMockProps) {
  const vars: Record<string, string> = {};
  if (maxWidth) vars['--phone-max-width'] = `${maxWidth}px`;
  if (screenHeight) vars['--phone-h'] = String(screenHeight + 22);
  const style = Object.keys(vars).length > 0 ? (vars as CSSProperties) : undefined;
  return (
    <div
      ref={ref}
      className={className ? `${styles.root} ${className}` : styles.root}
      data-phone-theme={theme === 'auto' ? undefined : theme}
      role="img"
      aria-label={label ?? describeConversation(conversation, perspective)}
      style={style}
    >
      <PhoneFrame screen={conversation.app === 'whatsapp' ? 'wallpaper' : 'plain'}>
        <MessagesScreen
          conversation={conversation}
          perspective={perspective}
          visibleCount={visibleCount}
          typingId={typingId}
          phase={phase}
        />
      </PhoneFrame>
    </div>
  );
}
