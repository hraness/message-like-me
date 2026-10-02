import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from '@hraness/web-discovery/social-image';

import { socialImageAltFor, socialSite } from '../_lib/social';
import { HUB_CARD } from './_lib/comparisons';

export const alt = socialImageAltFor(HUB_CARD);
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function CompareOpenGraphImage() {
  return createSiteSocialImageResponse(socialSite, HUB_CARD);
}
