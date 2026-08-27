import type { MetadataRoute } from 'next';

import { absoluteUrl } from './_lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date('2026-08-27T00:00:00Z');
  return [
    { url: absoluteUrl('/'), lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/sources'), lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/docs'), lastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/methodology'), lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/research'), lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/about'), lastModified, changeFrequency: 'yearly', priority: 0.5 },
  ];
}
