import { product } from '@hraness/design-kit/portfolio';
import { defineSocialImageSite, socialImageAlt, type SocialImagePage } from '@hraness/web-discovery/social-image/card';

import { SOCIAL_ICON_SVG } from './social-icon';

const registry = product('message-like-me');

// The one declaration every TextButler share image renders from. The card
// itself comes from @hraness/web-discovery; pages pass copy only.
export const socialSite = defineSocialImageSite({
  name: 'TextButler',
  // The registry one-liner ("AI butler for the iMessage, WhatsApp, and Beeper
  // chats you choose") does not fit the card's two lines and would be cut to
  // "AI butler for the iMessage", so the card carries the registry tagline,
  // which is also the home page's headline (SITE_HEADLINE).
  description: registry.messaging.tagline,
  domain: 'textbutler.app',
  icon: { kind: 'app', src: `data:image/svg+xml,${encodeURIComponent(SOCIAL_ICON_SVG)}` },
  // The site's gruvbox light palette from @hraness/design-kit. The crimson wash keeps the card apart from the other cream and sage
  // portfolio cards in a feed (web-discovery v0.12.0 README).
  theme: { accent: '#076678', background: '#FBF1C7', foreground: '#3C3836', muted: '#665C54', wash: '#E0309A' },
  keepTogether: ['Claude Code', 'Message Like Me'],
});

export const SOCIAL_IMAGE_ALT = socialImageAlt(socialSite);

export function socialImageAltFor(page: SocialImagePage): string {
  return socialImageAlt(socialSite, page);
}
