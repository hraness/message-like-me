import { PhoneMock, PhoneMockPlayer, type Conversation, type Perspective } from '../phone';

/**
 * The landing's phone: the shared code-drawn iPhone from `../phone`, fed the
 * synthetic scripts in `../phone/conversations`. `play` replays the hero
 * exchange when it scrolls into view; it renders the finished conversation
 * first, so the page reads the same without scripts or with reduced motion.
 */
export function PhoneSlot({ conversation, perspective = 'owner', label, play = false, maxWidth }: Readonly<{ conversation: Conversation; perspective?: Perspective; label?: string; play?: boolean; maxWidth?: number }>) {
  return play
    ? <PhoneMockPlayer conversation={conversation} label={label} maxWidth={maxWidth} perspective={perspective} />
    : <PhoneMock conversation={conversation} label={label} maxWidth={maxWidth} perspective={perspective} />;
}
