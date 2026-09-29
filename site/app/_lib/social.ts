import { product } from '@hraness/design-kit/portfolio';
import { defineSocialImageSite, socialImageAlt, type SocialImagePage } from '@hraness/web-discovery/social-image/card';

import { SOCIAL_ICON_SVG } from './social-icon';

const registry = product('message-like-me');

// The one declaration every TextButler share image renders from. The card
// itself comes from @hraness/web-discovery; pages pass copy only.
export const socialSite = defineSocialImageSite({
  // The product name is TextButler. The portfolio registry in the pinned
  // design-kit still spells it Textbutler, so the card names it directly until
  // a design-kit release carries the new spelling.
  name: 'TextButler',
  description: registry.oneLiner,
  domain: 'textbutler.app',
  icon: { kind: 'app', src: `data:image/svg+xml,${encodeURIComponent(SOCIAL_ICON_SVG)}` },
  // The site's gruvbox light palette from @hraness/design-kit.
  theme: { accent: '#076678', background: '#FBF1C7', foreground: '#3C3836', muted: '#665C54' },
});

export const SOCIAL_IMAGE_ALT = socialImageAlt(socialSite);

export function socialImageAltFor(page: SocialImagePage): string {
  return socialImageAlt(socialSite, page);
}
