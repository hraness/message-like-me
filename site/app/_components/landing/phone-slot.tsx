import type { CSSProperties } from 'react';

import { PhoneMock, PhoneMockPlayer, type Conversation, type Perspective } from '../phone';

/**
 * The landing's phone: the shared code-drawn iPhone from `../phone`, fed the
 * synthetic scripts in `../phone/conversations`. `play` replays the hero
 * exchange when it scrolls into view; it renders the finished conversation
 * first, so the page reads the same without scripts or with reduced motion.
 */
export function PhoneSlot({ conversation, perspective = 'owner', label, play = false, maxWidth, crop }: Readonly<{ conversation: Conversation; perspective?: Perspective; label?: string; play?: boolean; maxWidth?: number; crop?: number }>) {
  if (play) return <PhoneMockPlayer controls conversation={conversation} label={label} maxWidth={maxWidth} perspective={perspective} />;
  const phone = <PhoneMock conversation={conversation} label={label} maxWidth={maxWidth} perspective={perspective} />;
  // `crop` shows the top `crop` points of a full-size 866 pt iPhone, fading out
  // at the bottom, so a short example keeps real phone proportions.
  if (crop === undefined) return phone;
  const style = { '--crop-h': String(crop), ...(maxWidth ? { '--crop-max': `${maxWidth}px` } : {}) } as CSSProperties;
  return <div className="tb-phone-crop" style={style}>{phone}</div>;
}
