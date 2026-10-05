import type { MetadataRoute } from 'next';
import { createBlogSitemapPaths } from '@hraness/web-discovery';

import { articleDiscovery, BLOG_PATH, indexableBlogPosts } from './_lib/blog';
import { absoluteUrl, PAGE_LAST_MODIFIED } from './_lib/site';
import { isIndexableComparison } from './compare/_lib/comparison-admissions';
import { HUB_PAGE_ENTRIES } from './compare/_lib/comparisons';

const COMPARISON_PATHS = HUB_PAGE_ENTRIES.map(({ path }) => path).filter(isIndexableComparison);

// Indexable posts only; quarantined posts stay out of the sitemap.
function blogEntries(): MetadataRoute.Sitemap {
  const posts = indexableBlogPosts();
  if (posts.length === 0) return [];
  return createBlogSitemapPaths({ path: BLOG_PATH }, posts.map(articleDiscovery)).map(({ lastModified, path }) => ({
    url: absoluteUrl(path),
    ...(lastModified === undefined ? {} : { lastModified: new Date(lastModified) }),
    changeFrequency: 'monthly' as const,
    priority: path === BLOG_PATH ? 0.6 : 0.7,
  }));
}

const lastModified = (path: keyof typeof PAGE_LAST_MODIFIED): Date => new Date(`${PAGE_LAST_MODIFIED[path]}T00:00:00Z`);

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl('/'), lastModified: lastModified('/'), changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/docs'), lastModified: lastModified('/docs'), changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/about'), lastModified: lastModified('/about'), changeFrequency: 'monthly', priority: 0.7 },
    ...(isIndexableComparison('/compare') ? [{ url: absoluteUrl('/compare'), lastModified: lastModified('/compare'), changeFrequency: 'monthly' as const, priority: 0.7 }] : []),
    ...COMPARISON_PATHS.map((path) => ({ url: absoluteUrl(path), lastModified: lastModified(path), changeFrequency: 'monthly' as const, priority: 0.6 })),
    ...blogEntries(),
  ];
}
