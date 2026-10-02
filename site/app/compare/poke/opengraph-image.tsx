import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from '@hraness/web-discovery/social-image';

import { socialImageAltFor, socialSite } from '../../_lib/social';
import { comparisonBySlug } from '../_lib/comparisons';

const card = comparisonBySlug('poke').card;

export const alt = socialImageAltFor(card);
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function OpenGraphImage() {
  return createSiteSocialImageResponse(socialSite, card);
}
