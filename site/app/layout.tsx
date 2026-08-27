import type { Metadata, Viewport } from 'next';

import {
  absoluteUrl,
  GITHUB_URL,
  RELEASE_URL,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  SOFTWARE_VERSION,
} from './_lib/site';
import '@hraness/design-kit/fonts.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: 'Message Like Me — Study how you message',
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_ORIGIN }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: 'developer tools',
  keywords: [
    'local-first AI',
    'message analysis',
    'messaging style',
    'Agent Skill',
    'iMessage analysis',
    'private AI tools',
  ],
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    shortcut: '/icon.svg',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: 'Message Like Me — Study how you message',
    description: SITE_DESCRIPTION,
    images: [
      {
        url: absoluteUrl('/og.png'),
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} — local-first messaging style analysis.`,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Message Like Me — Study how you message',
    description: SITE_DESCRIPTION,
    images: [{
      url: absoluteUrl('/og.png'),
      alt: `${SITE_NAME} — local-first messaging style analysis.`,
    }],
  },
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f4f0e8',
};

const websiteId = `${absoluteUrl('/')}#website`;
const applicationId = `${absoluteUrl('/')}#application`;
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': websiteId,
      name: SITE_NAME,
      url: absoluteUrl('/'),
      description: SITE_DESCRIPTION,
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': applicationId,
      name: SITE_NAME,
      url: absoluteUrl('/'),
      description: SITE_DESCRIPTION,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS',
      softwareVersion: SOFTWARE_VERSION,
      isAccessibleForFree: true,
      sameAs: GITHUB_URL,
      downloadUrl: RELEASE_URL,
      offers: {
        '@type': 'Offer',
        price: 0,
        priceCurrency: 'USD',
      },
      isPartOf: { '@id': websiteId },
    },
    {
      '@type': 'SoftwareSourceCode',
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      codeRepository: GITHUB_URL,
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Bun 1.3.14 or newer on macOS',
      version: SOFTWARE_VERSION,
      license: 'https://opensource.org/license/mit',
      targetProduct: { '@id': applicationId },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
        {children}
      </body>
    </html>
  );
}
