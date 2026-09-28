import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from '@hraness/web-discovery/social-image';

import { SOCIAL_IMAGE_ALT, socialSite } from './_lib/social';

export const alt = SOCIAL_IMAGE_ALT;
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function OpenGraphImage() {
  return createSiteSocialImageResponse(socialSite);
}
