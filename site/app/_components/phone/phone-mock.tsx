
import type { Conversation, Perspective } from './conversations';
import { conversationScene, describeConversation, type SceneTheme } from './scene';
import { PhoneView, type PhoneTheme, type SceneVariant } from './phone-view';

export type { PhoneTheme, PlaybackPhase } from './phone-view';

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
}

/**
 * A code-rendered iPhone showing a synthetic conversation, drawn by
 * @hraness/textmockups (the renderer behind textmock.com).
 * Static and server-safe (no scripts): use it in pages that must render without
 * JavaScript, blog image capture and video scenes. `PhoneMockPlayer` adds
 * scripted playback on top of the same markup.
 */
export function PhoneMock({ conversation, perspective = 'owner', theme = 'auto', screenHeight, label, ...rest }: PhoneMockProps) {
  return (
    <PhoneView
      {...rest}
      app={conversation.app}
      label={label ?? describeConversation(conversation, perspective)}
      scenes={sceneVariants(conversation, perspective, theme, screenHeight)}
      theme={theme}
    />
  );
}

/** The validated scene for each appearance the phone draws: both for `auto`, one otherwise. */
export function sceneVariants(conversation: Conversation, perspective: Perspective, theme: PhoneTheme, screenHeight?: number): SceneVariant[] {
  const themes: readonly SceneTheme[] = theme === 'auto' ? ['light', 'dark'] : [theme];
  return themes.map((sceneTheme) => ({ theme: sceneTheme, scene: conversationScene(conversation, { perspective, theme: sceneTheme, screenHeight }) }));
}

