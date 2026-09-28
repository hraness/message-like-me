import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from '@hraness/web-discovery/social-image';

import { BLOG_INDEX_SOCIAL_PAGE } from '../_lib/blog';
import { socialImageAltFor, socialSite } from '../_lib/social';

export const alt = socialImageAltFor(BLOG_INDEX_SOCIAL_PAGE);
export const contentType = socialImageContentType;
export const size = socialImageSize;

export default function BlogOpenGraphImage() {
  return createSiteSocialImageResponse(socialSite, BLOG_INDEX_SOCIAL_PAGE);
}
