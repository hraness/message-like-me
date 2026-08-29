import type { MetadataRoute } from 'next';

import { absoluteUrl } from './_lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const v080LastModified = new Date('2026-08-27T00:00:00Z');
  const v081LastModified = new Date('2026-08-29T00:00:00Z');
  return [
    { url: absoluteUrl('/'), lastModified: v081LastModified, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/sources'), lastModified: v081LastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/docs'), lastModified: v081LastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/methodology'), lastModified: v080LastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/research'), lastModified: v080LastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/about'), lastModified: v080LastModified, changeFrequency: 'yearly', priority: 0.5 },
  ];
}
