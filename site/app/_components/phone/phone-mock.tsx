import { PhoneFit } from '@hraness/textmockups';
import '@hraness/textmockups/phone.css';
import './phone-overrides.css';
import type { CSSProperties, Ref } from 'react';

import type { Conversation, Perspective } from './conversations';
import { conversationScene, describeConversation, type SceneTheme } from './scene';
import styles from './phone.module.css';

export type PhoneTheme = 'auto' | 'light' | 'dark';
export type PlaybackPhase = 'final' | 'playing' | 'hold' | 'fading';

export interface PhoneMockProps {
  readonly conversation: Conversation;
  /** Whose phone this is. `owner` (default) is Sam’s iPhone; `contact` shows the friend’s view. */
  readonly perspective?: Perspective;
  /** `auto` follows the page’s Paper color scheme; `light`/`dark` force one. */
  readonly theme?: PhoneTheme;
  /** Maximum rendered width in CSS pixels. The phone scales down to its container. */
  readonly maxWidth?: number;
  /**
   * Device height in points (default 852, a full iPhone). A shorter device
   * crops the empty top of a short thread so the phone hugs the conversation.
   */
  readonly screenHeight?: number;
  /** Show only the top of the complete device, in device points, with a quiet fade. */
  readonly crop?: number;
  /** Overrides the generated accessible name (a full reading of the conversation). */
  readonly label?: string;
  readonly className?: string;
  /** Ref to the root element (the player observes it for scroll-into-view). */
  readonly ref?: Ref<HTMLDivElement>;
  /** Internal: the playback second from `PhoneMockPlayer`. Absent draws the finished conversation. */
  readonly time?: number;
  readonly phase?: PlaybackPhase;
}

const DEVICE_WIDTH = 393;

/**
 * A code-rendered iPhone showing a synthetic conversation, drawn by
 * @hraness/textmockups (the renderer behind textmock.com).
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
  crop,
  label,
  className,
  ref,
  time,
  phase = 'final',
}: PhoneMockProps) {
  const themes: readonly SceneTheme[] = theme === 'auto' ? ['light', 'dark'] : [theme];
  const style = maxWidth ? ({ '--phone-max-width': `${maxWidth}px` } as CSSProperties) : undefined;
  const phone = (
    <div
      ref={ref}
      className={className ? `${styles.root} ${className}` : styles.root}
      data-tb-phone=""
      data-app={conversation.app}
      data-phase={phase}
      data-phone-theme={theme}
      role="img"
      aria-label={label ?? describeConversation(conversation, perspective)}
      style={style}
    >
      {themes.map((sceneTheme) => (
        <div key={sceneTheme} className={styles.variant} data-variant={theme === 'auto' ? sceneTheme : undefined}>
          <PhoneFit
            scene={conversationScene(conversation, { perspective, theme: sceneTheme, screenHeight })}
            time={time}
            watermark={false}
          />
        </div>
      ))}
    </div>
  );
  if (crop === undefined) return phone;
  if (!Number.isFinite(crop) || crop <= 0) throw new RangeError('Phone crop must be positive.');
  return (
    <div
      className={styles.crop}
      data-phone-crop=""
      style={{ '--crop-ratio': `${DEVICE_WIDTH} / ${crop}`, ...(maxWidth ? { '--crop-max': `${maxWidth}px` } : {}) } as CSSProperties}
    >
      {phone}
    </div>
  );
}
