import type { PhoneMockProps } from './phone-mock';
import { sceneVariants } from './phone-mock';
import { PhonePlayback } from './phone-playback';
import { describeConversation, schedule } from './scene';

export interface PhoneMockPlayerProps extends PhoneMockProps {
  /** Milliseconds the finished conversation holds before the loop restarts. */
  readonly holdMs?: number;
  /** Play once and stay on the final frame instead of looping. */
  readonly once?: boolean;
  /** Render a Pause/Play button under the phone (WCAG 2.2.2). */
  readonly controls?: boolean;
}

/**
 * The phone mockup with scripted playback. The server validates the scenes and
 * builds the schedule; the client only advances the timeline. It first renders
 * the finished conversation (identical to the static mock, so there is no
 * flash and no layout shift), and only when scrolled into view does it hold,
 * crossfade to the start, and play. Under `prefers-reduced-motion` it never
 * plays and shows the final frame. The phone's size never changes.
 */
export function PhoneMockPlayer({ conversation, perspective = 'owner', theme = 'auto', screenHeight, label, ...rest }: PhoneMockPlayerProps) {
  return (
    <PhonePlayback
      {...rest}
      app={conversation.app}
      end={schedule(conversation, perspective).end}
      label={label ?? describeConversation(conversation, perspective)}
      scenes={sceneVariants(conversation, perspective, theme, screenHeight)}
      theme={theme}
    />
  );
}
