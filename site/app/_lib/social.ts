import { marketing } from '../../portfolio-copy';
import { defineSocialImageSite, socialImageAlt, type SocialImagePage } from '@hraness/web-discovery/social-image/card';

import { SOCIAL_BRAND_MARK_SVG } from './social-mark';


// The one declaration every TextButler share image renders from. The card
// itself comes from @hraness/web-discovery; pages pass copy only. It draws the
// site's sticky header (foil mark and name) over the hero, in the gruvbox
// palette the site sets as data-palette on <html>.
export const socialSite = defineSocialImageSite({
  name: marketing.names.name,
  brand: marketing.names.name,
  brandMark: SOCIAL_BRAND_MARK_SVG,
  // The home hero headline, set whole as the home card's headline.
  description: marketing.hero.heading,
  domain: 'textbutler.app',
  palette: 'gruvbox',
  keepTogether: ['Claude Code'],
});

export const SOCIAL_IMAGE_ALT = socialImageAlt(socialSite);

export function socialImageAltFor(page: SocialImagePage): string {
  return socialImageAlt(socialSite, page);
}
