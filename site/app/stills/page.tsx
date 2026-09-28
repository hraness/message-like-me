import type { CSSProperties } from 'react';
import type { Metadata } from 'next';

import { conversations, PhoneMock, type PhoneTheme } from '../_components/phone';

export const metadata: Metadata = {
  title: { absolute: 'Textbutler | Launch stills' },
  robots: { follow: false, index: false },
};

type Scene = Readonly<{ id: string; conversation: (typeof conversations)[keyof typeof conversations]; perspective?: 'owner' | 'contact'; screenHeight?: number }>;

const SCENES: readonly Scene[] = [
  { id: 'hero', conversation: conversations.hero },
  { id: 'hero-friend', conversation: conversations.heroFriend, perspective: 'contact' },
  { id: 'ask-yourself', conversation: conversations.askYourself, screenHeight: 600 },
  { id: 'stays-out', conversation: conversations.staysOut, screenHeight: 540 },
  { id: 'boundaries', conversation: conversations.boundaries, screenHeight: 540 },
  { id: 'whatsapp-reply', conversation: conversations.whatsappReply, screenHeight: 540 },
];

// The site's gruvbox Paper values, fixed so a capture never depends on the viewer's theme.
const CARD_THEMES = {
  light: { paper: '#fbf1c7', ink: '#393533', muted: '#584f48', accent: '#065968' },
  dark: { paper: '#282828', ink: '#f0e5c7', muted: '#c7baa3', accent: '#a9c1b8' },
} as const;

/**
 * The 1200 × 630 card: the headline beside the same hero phone, rising from
 * the bottom edge. `og` is the link preview; `readme-*` head the README.
 */
function SocialCard({ capture, theme }: Readonly<{ capture: string; theme: keyof typeof CARD_THEMES }>) {
  const OG = CARD_THEMES[theme];
  const card: CSSProperties = {
    position: 'relative',
    inlineSize: 1200,
    blockSize: 630,
    flex: 'none',
    overflow: 'hidden',
    background: `radial-gradient(640px 520px at 960px 360px, color-mix(in oklch, ${OG.accent} 14%, transparent), transparent 70%), ${OG.paper}`,
    color: OG.ink,
    fontFamily: 'var(--font-text)',
  };
  return (
    <div data-card={capture} style={card}>
      <div style={{ position: 'absolute', insetBlockStart: 64, insetInlineStart: 80, display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="" height={52} src="/marks/message-like-me.svg" width={52} />
        <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.01em' }}>Textbutler</span>
      </div>
      <div style={{ position: 'absolute', insetBlockStart: 168, insetInlineStart: 80, inlineSize: 620 }}>
        <p style={{ margin: 0, fontSize: 104, fontWeight: 600, lineHeight: 0.98, letterSpacing: '-0.035em' }}>AI in your messages.</p>
        <p style={{ margin: '28px 0 0', color: OG.muted, fontSize: 27, lineHeight: 1.38, maxInlineSize: 580, textWrap: 'balance' }}>Say “butler” in a chat you’ve turned on. A clearly marked assistant answers.</p>
      </div>
      <div style={{ position: 'absolute', insetBlockEnd: 56, insetInlineStart: 80, display: 'flex', gap: 28, color: OG.muted, fontSize: 22 }}>
        <span style={{ color: OG.accent, fontWeight: 600 }}>textbutler.app</span>
        <span>iMessage, WhatsApp, and Beeper on Mac</span>
      </div>
      <div style={{ position: 'absolute', insetBlockStart: 52, insetInlineStart: 760, inlineSize: 380 }}>
        <PhoneMock conversation={conversations.hero} label="" maxWidth={380} screenHeight={700} theme={theme} />
      </div>
    </div>
  );
}

const THEMES: readonly Exclude<PhoneTheme, 'auto'>[] = ['light', 'dark'];

/**
 * Capture sheet for launch media: every synthetic phone scene in both
 * appearances, static and script-free. `bun run stills` screenshots each
 * `[data-still]` into public/launch/ for the README and film, and the
 * `[data-card]` captures into public/og.png (link previews) and
 * public/launch/readme-hero-*.png (the README's opening image).
 * Not linked from the site and not indexed.
 */
export default function StillsPage() {
  return (
    <main id="main-content" style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: 24 }}>
      <SocialCard capture="og" theme="light" />
      <SocialCard capture="readme-hero-light" theme="light" />
      <SocialCard capture="readme-hero-dark" theme="dark" />
      {SCENES.flatMap(scene => THEMES.map(theme => (
        <div data-still={`${scene.id}-${theme}`} key={`${scene.id}-${theme}`} style={{ inlineSize: 488, padding: 54 }}>
          <PhoneMock conversation={scene.conversation} maxWidth={380} perspective={scene.perspective} screenHeight={scene.screenHeight} theme={theme} />
        </div>
      )))}
    </main>
  );
}
