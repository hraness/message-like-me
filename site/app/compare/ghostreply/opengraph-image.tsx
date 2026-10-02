import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from '@hraness/web-discovery/social-image';

import { socialImageAltFor, socialSite } from '../../_lib/social';
import { GHOSTREPLY_CARD } from '../_lib/comparisons';

const card = GHOSTREPLY_CARD;

export const alt = socialImageAltFor(card);
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function OpenGraphImage() {
  return createSiteSocialImageResponse(socialSite, card);
}
