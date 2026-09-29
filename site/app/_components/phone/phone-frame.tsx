import type { ReactNode } from 'react';

import { BatteryGlyph, CellularGlyph, WifiGlyph } from './glyphs';
import styles from './phone.module.css';

export interface PhoneFrameProps {
  readonly children: ReactNode;
  /** The screen's background color role; WhatsApp draws its own wallpaper. */
  readonly screen?: 'plain' | 'wallpaper';
}

/**
 * A generic modern iPhone-class device: titanium edge with an inner highlight,
 * dark bezel, side buttons, Dynamic Island, status bar and home indicator.
 * 390 × 844 pt logical screen. No logos, carrier names or real numbers.
 * Purely decorative; the conversation's accessible name lives on the root.
 */
export function PhoneFrame({ children, screen = 'plain' }: PhoneFrameProps) {
  return (
    <div className={styles.device}>
      <span className={styles.buttonAction} aria-hidden="true" />
      <span className={styles.buttonVolumeUp} aria-hidden="true" />
      <span className={styles.buttonVolumeDown} aria-hidden="true" />
      <span className={styles.buttonPower} aria-hidden="true" />
      <div className={styles.bezel}>
        <div className={styles.screen} data-screen={screen}>
          {children}
          <StatusBar />
          <span className={styles.island} aria-hidden="true" />
          <span className={styles.homeIndicator} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className={styles.statusBar} aria-hidden="true">
      <span className={styles.statusTime}>9:41</span>
      <span className={styles.statusGlyphs}>
        <CellularGlyph className={styles.glyphCellular} />
        <WifiGlyph className={styles.glyphWifi} />
        <BatteryGlyph className={styles.glyphBattery} />
      </span>
    </div>
  );
}
