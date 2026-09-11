import type { MetadataRoute } from 'next';

import { absoluteUrl } from './_lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const rebrandDate = new Date('2026-09-11T00:00:00Z');
  return [
    { url: absoluteUrl('/'), lastModified: rebrandDate, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/sources'), lastModified: rebrandDate, changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/docs'), lastModified: rebrandDate, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/methodology'), lastModified: rebrandDate, changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/research'), lastModified: rebrandDate, changeFrequency: 'monthly', priority: 0.6 },
    { url: absoluteUrl('/about'), lastModified: rebrandDate, changeFrequency: 'monthly', priority: 0.7 },
  ];
}
