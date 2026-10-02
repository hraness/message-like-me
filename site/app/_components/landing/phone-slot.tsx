import { MockupCredit, PhoneMock, PhoneMockPlayer, type Conversation, type Perspective } from '../phone';

/**
 * The landing's phone: the shared code-drawn iPhone from `../phone`, fed the
 * synthetic scripts in `../phone/conversations`. `play` replays the hero
 * exchange when it scrolls into view; it renders the finished conversation
 * first, so the page reads the same without scripts or with reduced motion.
 * The “Made with Textmock” credit sits under the phone and its controls.
 */
export function PhoneSlot({ conversation, perspective = 'owner', label, play = false, maxWidth, crop }: Readonly<{ conversation: Conversation; perspective?: Perspective; label?: string; play?: boolean; maxWidth?: number; crop?: number }>) {
  const props = { conversation, perspective, label, maxWidth, crop };
  return (
    <>
      {play ? <PhoneMockPlayer controls {...props} /> : <PhoneMock {...props} />}
      <MockupCredit />
    </>
  );
}
