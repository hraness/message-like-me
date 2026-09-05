import type { MetadataRoute } from 'next';

import { absoluteUrl } from './_lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const existingContentLastModified = new Date('2026-08-27T00:00:00Z');
  const sourceIntegrationLastModified = new Date('2026-09-05T00:00:00Z');
  return [
    { url: absoluteUrl('/'), lastModified: sourceIntegrationLastModified, changeFrequency: 'weekly', priority: 1 },
    { url: absoluteUrl('/sources'), lastModified: sourceIntegrationLastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/docs'), lastModified: sourceIntegrationLastModified, changeFrequency: 'monthly', priority: 0.9 },
    { url: absoluteUrl('/methodology'), lastModified: existingContentLastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/research'), lastModified: existingContentLastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: absoluteUrl('/about'), lastModified: existingContentLastModified, changeFrequency: 'yearly', priority: 0.5 },
  ];
}
