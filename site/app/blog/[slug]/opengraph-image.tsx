import { notFound } from 'next/navigation';
import {
  createSiteSocialImageResponse,
  socialImageContentType,
  socialImageSize,
} from '@hraness/web-discovery/social-image';

import { BLOG_POSTS, blogPostBySlug, socialPageFor } from '../../_lib/blog';
import { socialSite } from '../../_lib/social';

type Params = Readonly<{ slug: string }>;

export const dynamicParams = false;
export const contentType = socialImageContentType;
export const size = socialImageSize;

export function generateStaticParams(): Params[] {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export default async function BlogPostOpenGraphImage({ params }: Readonly<{ params: Promise<Params> }>) {
  const post = blogPostBySlug((await params).slug);
  if (post === undefined) notFound();
  return createSiteSocialImageResponse(socialSite, socialPageFor(post));
}
