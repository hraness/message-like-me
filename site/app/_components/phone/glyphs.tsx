/**
 * Decorative iOS-style chrome glyphs drawn as inline SVG. Every glyph is
 * aria-hidden and uses currentColor so light and dark follow the phone theme.
 * They are original drawings, not Apple assets.
 */

interface GlyphProps {
  readonly className?: string;
}

export function CellularGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 19 12" aria-hidden="true" focusable="false">
      <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.9" fill="currentColor" />
      <rect x="5.1" y="5.2" width="3.2" height="6.8" rx="0.9" fill="currentColor" />
      <rect x="10.2" y="2.7" width="3.2" height="9.3" rx="0.9" fill="currentColor" />
      <rect x="15.3" y="0" width="3.2" height="12" rx="0.9" fill="currentColor" />
    </svg>
  );
}

export function WifiGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 17 12.3" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8.5 2.6c2.4 0 4.6.9 6.2 2.4.2.2.5.2.7 0l1.2-1.2c.2-.2.2-.5 0-.7C14.5 1.2 11.6 0 8.5 0S2.5 1.2.4 3.1c-.2.2-.2.5 0 .7L1.6 5c.2.2.5.2.7 0C3.9 3.5 6.1 2.6 8.5 2.6Z"
      />
      <path
        fill="currentColor"
        d="M8.5 6.4c1.3 0 2.5.5 3.5 1.3.2.2.5.2.7 0l1.2-1.2c.2-.2.2-.5 0-.7-1.4-1.3-3.3-2-5.4-2s-4 .7-5.4 2c-.2.2-.2.5 0 .7l1.2 1.2c.2.2.5.2.7 0 1-.8 2.2-1.3 3.5-1.3Z"
      />
      <path
        fill="currentColor"
        d="M11.1 9.4c.2-.2.2-.5 0-.7-.7-.6-1.6-1-2.6-1s-1.9.4-2.6 1c-.2.2-.2.5 0 .7l2.2 2.2c.2.2.5.2.7 0l2.3-2.2Z"
      />
    </svg>
  );
}

export function BatteryGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 27.4 13" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="24" height="12" rx="3.8" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <rect x="2" y="2" width="21" height="9" rx="2.5" fill="currentColor" />
      <path d="M26 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1S26.8 4.7 26 4.4Z" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

export function BackChevronGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 12 21" aria-hidden="true" focusable="false">
      <path d="M10.2 1.6 1.6 10.5l8.6 8.9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SmallChevronGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 6 10" aria-hidden="true" focusable="false">
      <path d="M1.2 1.2 4.8 5 1.2 8.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function VideoGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 28 18" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="18.5" height="16" rx="4.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M21.3 7.1 26 3.9c.5-.4 1.2 0 1.2.7v8.8c0 .7-.7 1.1-1.2.7l-4.7-3.2V7.1Z" fill="currentColor" />
    </svg>
  );
}

export function PhoneGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        d="M6.2 1.8 3.6 2.4C2.4 2.7 1.6 3.9 1.9 5.2c1.3 6.1 6.8 11.6 12.9 12.9 1.3.3 2.5-.5 2.8-1.7l.6-2.6c.2-.7-.2-1.4-.9-1.7l-3-1.3c-.6-.3-1.3-.1-1.7.4l-1.2 1.5C9 11.6 8.4 11 7.6 10.2 6.8 9.4 6.4 8.8 5.3 6.8l1.5-1.2c.5-.4.7-1.1.4-1.7L5.9 2.7c-.2-.6-.9-1-1.6-.9Z"
      />
    </svg>
  );
}

export function PlusGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5v13M1.5 8h13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

export function MicGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 14 20" aria-hidden="true" focusable="false">
      <rect x="3.6" y="0.9" width="6.8" height="11.6" rx="3.4" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M1 9.2a6 6 0 0 0 12 0M7 15.2v3.6M4.2 18.8h5.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function CameraGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 22 18" aria-hidden="true" focusable="false">
      <path
        d="M3.5 4h2.6l1.5-2.1c.3-.4.7-.6 1.2-.6h4.4c.5 0 .9.2 1.2.6L15.9 4h2.6C19.9 4 21 5.1 21 6.5v8C21 15.9 19.9 17 18.5 17h-15C2.1 17 1 15.9 1 14.5v-8C1 5.1 2.1 4 3.5 4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="11" cy="10.2" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

/** WhatsApp-style delivered ticks (double, grey: delivered, not read). */
export function DoubleTickGlyph({ className }: GlyphProps) {
  return (
    <svg className={className} viewBox="0 0 16 11" aria-hidden="true" focusable="false">
      <path d="M1 6.1 3.9 9 10.4 1.6M6.7 8.2l.8.8L14 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
