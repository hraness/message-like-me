import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { socialImageContentType, socialImageSize } from '@hraness/web-discovery/social-image';
import { socialImageFit, socialImageSiteDetails } from '@hraness/web-discovery/social-image/card';

import * as rootImage from '../app/opengraph-image.tsx';
import * as blogImage from '../app/blog/opengraph-image.tsx';
import * as postImage from '../app/blog/[slug]/opengraph-image.tsx';
import { SOCIAL_ICON_SVG } from '../app/_lib/social-icon.ts';
import { SOCIAL_IMAGE_ALT, socialSite } from '../app/_lib/social.ts';
import { BLOG_INDEX_SOCIAL_PAGE, BLOG_POSTS, socialPageFor } from '../app/_lib/blog.ts';
import { SITE_HEADLINE, SITE_NAME } from '../app/_lib/site.ts';

const siteRoot = resolve(import.meta.dir, '..');

describe('social images', () => {
  test('one declaration names the real site, icon, and palette', async () => {
    expect(socialSite.name).toBe(SITE_NAME);
    expect(socialSite.domain).toBe('textbutler.app');
    expect(socialSite.icon?.kind).toBe('app');
    expect(socialSite.icon?.src?.startsWith('data:image/svg+xml,')).toBe(true);
    const appIcon = await readFile(resolve(siteRoot, '../native/app-icon.svg'), 'utf8');
    expect(SOCIAL_ICON_SVG).toBe(
      appIcon.trim().replace('viewBox="0 0 1024 1024" width="1024" height="1024"', 'viewBox="100 100 824 824" width="824" height="824"'),
    );
    expect(socialSite.theme?.accent).toBe('#076678');
    expect(socialSite.theme?.wash).toBe('#E0309A');
  });

  test('every route declares the shared size and content type', () => {
    for (const route of [rootImage, blogImage, postImage]) {
      expect(route.size).toEqual(socialImageSize);
      expect(route.contentType).toBe(socialImageContentType);
    }
    expect(rootImage.alt).toBe(SOCIAL_IMAGE_ALT);
    expect(blogImage.alt).toContain(BLOG_INDEX_SOCIAL_PAGE.headline ?? '');
  });

  test('post cards receive copy only and render for every post', async () => {
    expect(postImage.generateStaticParams()).toEqual(BLOG_POSTS.map(post => ({ slug: post.slug })));
    for (const post of BLOG_POSTS) {
      expect(Object.keys(socialPageFor(post)).toSorted()).toEqual(['description', 'eyebrow', 'headline']);
    }
    const response = await postImage.default({ params: Promise.resolve({ slug: BLOG_POSTS[0]!.slug }) });
    expect(response.headers.get('content-type')).toBe('image/png');
  });

  test('every card fits as written with no review findings', () => {
    const cards = [undefined, BLOG_INDEX_SOCIAL_PAGE, ...BLOG_POSTS.map(socialPageFor)];
    for (const page of cards) {
      const fit = socialImageFit(socialImageSiteDetails(socialSite, page));
      expect({ headline: page?.headline, findings: fit.findings }).toEqual({ headline: page?.headline, findings: [] });
    }
  });

  test('every page card shows its eyebrow', () => {
    for (const page of [BLOG_INDEX_SOCIAL_PAGE, ...BLOG_POSTS.map(socialPageFor)]) {
      const fit = socialImageFit(socialImageSiteDetails(socialSite, page));
      expect(typeof page.eyebrow).toBe('string');
      expect(fit.eyebrow).toBe(page.eyebrow as string);
    }
  });

  test('the blog card does not repeat its eyebrow in the headline', () => {
    expect(BLOG_INDEX_SOCIAL_PAGE.eyebrow).toBe('Blog');
    expect(BLOG_INDEX_SOCIAL_PAGE.headline?.toLowerCase()).not.toContain('blog');
  });

  test('the home card shows the home page headline whole', () => {
    expect(socialSite.description).toBe(SITE_HEADLINE);
    const fit = socialImageFit(socialImageSiteDetails(socialSite));
    expect(fit.headline.lines).toEqual([SITE_NAME]);
    expect(fit.description?.cut).toBe('none');
    expect(fit.description?.lines.join(' ')).toBe(SITE_HEADLINE);
  });
});
