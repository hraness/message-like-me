import type { Metadata } from 'next';

export const SITE_NAME = 'Message Like Me';
export const SITE_ORIGIN = 'https://messagelikeme.com';
export const SITE_DESCRIPTION =
  'A local-first CLI and Agent Skill for studying private messaging history and drafting messages that sound like you.';
export const GITHUB_URL = 'https://github.com/hraness/message-like-me';
export const SOFTWARE_VERSION = '0.8.0';
export const RELEASE_URL = `${GITHUB_URL}/releases/tag/v${SOFTWARE_VERSION}`;

export const CANONICAL_PAGE_PATHS = [
  '/',
  '/about',
  '/sources',
  '/docs',
  '/methodology',
  '/research',
] as const;

export type CanonicalPagePath = (typeof CANONICAL_PAGE_PATHS)[number];
export type SitePath = `/${string}`;

export function absoluteUrl(path: SitePath = '/'): string {
  if (path === '/') return SITE_ORIGIN;
  return new URL(path, `${SITE_ORIGIN}/`).toString();
}

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</gu, '\\u003c');
}

export function pageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: CanonicalPagePath;
}): Metadata {
  const url = absoluteUrl(path);
  const resolvedTitle = path === '/' ? { absolute: title } : title;
  return {
    title: resolvedTitle,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title,
      description,
      images: [{
        url: absoluteUrl('/og.png'),
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — local-first messaging style analysis.`,
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [{
        url: absoluteUrl('/og.png'),
        alt: `${SITE_NAME} — local-first messaging style analysis.`,
      }],
    },
  };
}
