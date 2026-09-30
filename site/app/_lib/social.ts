import { marketing } from '../../portfolio-copy';
import { defineSocialImageSite, socialImageAlt, type SocialImagePage } from '@hraness/web-discovery/social-image/card';

import { SOCIAL_ICON_SVG } from './social-icon';


// The one declaration every TextButler share image renders from. The card
// itself comes from @hraness/web-discovery; pages pass copy only.
export const socialSite = defineSocialImageSite({
  name: marketing.names.name,
  // The canonical tagline fits the shared card without trimming its copy.
  description: marketing.tagline,
  domain: 'textbutler.app',
  icon: { kind: 'app', src: `data:image/svg+xml,${encodeURIComponent(SOCIAL_ICON_SVG)}` },
  // The site's gruvbox light palette from @hraness/design-kit. The crimson wash keeps the card apart from the other cream and sage
  // portfolio cards in a feed (web-discovery v0.12.0 README).
  theme: { accent: '#076678', background: '#FBF1C7', foreground: '#3C3836', muted: '#665C54', wash: '#C3224B' },
  keepTogether: ['Claude Code', 'Message Like Me'],
});

export const SOCIAL_IMAGE_ALT = socialImageAlt(socialSite);

export function socialImageAltFor(page: SocialImagePage): string {
  return socialImageAlt(socialSite, page);
}
