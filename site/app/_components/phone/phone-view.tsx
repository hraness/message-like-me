import { PhoneFit, type Scene } from '@hraness/textmockups';
import '@hraness/textmockups/phone.css';
import './phone-overrides.css';
import type { CSSProperties, Ref } from 'react';

import type { Conversation } from './conversations';
import type { SceneTheme } from './scene';
import styles from './phone.module.css';

export type PhoneTheme = 'auto' | 'light' | 'dark';
export type PlaybackPhase = 'final' | 'playing' | 'hold' | 'fading';

/** Points across the device; the crop keeps this width. */
const DEVICE_WIDTH = 393;

export interface SceneVariant {
  readonly theme: SceneTheme;
  readonly scene: Scene;
}

export interface PhoneViewProps {
  readonly app: Conversation['app'];
  readonly scenes: readonly SceneVariant[];
  readonly theme: PhoneTheme;
  readonly label: string;
  readonly maxWidth?: number;
  readonly crop?: number;
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
  readonly time?: number;
  readonly phase?: PlaybackPhase;
}

/**
 * Draws already-validated scenes, so the client player never parses a scene
 * (schema validation stays on the server, under the site's CSP).
 */
export function PhoneView({ app, scenes, theme, label, maxWidth, crop, className, ref, time, phase = 'final' }: PhoneViewProps) {
  const style = maxWidth ? ({ '--phone-max-width': `${maxWidth}px` } as CSSProperties) : undefined;
  const phone = (
    <div
      ref={ref}
      className={className ? `${styles.root} ${className}` : styles.root}
      data-tb-phone=""
      data-app={app}
      data-phase={phase}
      data-phone-theme={theme}
      role="img"
      aria-label={label}
      style={style}
    >
      {scenes.map(({ theme: sceneTheme, scene }) => (
        <div key={sceneTheme} className={styles.variant} data-variant={theme === 'auto' ? sceneTheme : undefined}>
          <PhoneFit scene={scene} time={time} watermark={false} />
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
