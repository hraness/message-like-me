import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';

import {
  absoluteUrl,
  GITHUB_URL,
  serializeJsonLd,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_STATUS_LABEL,
  SITE_TITLE,
  SOCIAL_IMAGE_ALT,
} from './_lib/site';
import { APPLICATION_ID, ORGANIZATION_ID, WEBSITE_ID } from './_lib/structured-data';
import '@hraness/design-kit/fonts.css';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_ORIGIN }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: 'Messaging assistant for Mac',
  keywords: ['TextButler', 'AI butler', 'Mac message assistant', 'contact memory', 'GhostGet', 'iMessage', 'WhatsApp', 'Beeper'],
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '32x32' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/icon.png',
    apple: { url: '/apple-icon.png', type: 'image/png', sizes: '180x180' },
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
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: absoluteUrl('/opengraph-image'),
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: SOCIAL_IMAGE_ALT,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{
      url: absoluteUrl('/opengraph-image'),
      alt: SOCIAL_IMAGE_ALT,
    }],
  },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf1c7' },
    { media: '(prefers-color-scheme: dark)', color: '#282828' },
  ],
};

const websiteId = WEBSITE_ID;
const applicationId = APPLICATION_ID;
const organizationId = ORGANIZATION_ID;
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': organizationId,
      name: 'Hraness',
      alternateName: 'HRNSS',
      url: 'https://hraness.com/',
      logo: 'https://hraness.com/icon.png',
      sameAs: ['https://www.linkedin.com/company/hraness', 'https://github.com/hraness'],
    },
    {
      '@type': 'WebSite',
      '@id': websiteId,
      name: SITE_NAME,
      url: absoluteUrl('/'),
      description: SITE_DESCRIPTION,
      inLanguage: 'en-US',
      publisher: { '@id': organizationId },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': applicationId,
      name: SITE_NAME,
      url: absoluteUrl('/'),
      description: SITE_DESCRIPTION,
      applicationCategory: 'CommunicationApplication',
      operatingSystem: 'macOS',
      sameAs: GITHUB_URL,
      author: { '@id': organizationId },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        'Background service on macOS, controlled from the command line or a guided terminal',
        'Editable notes for each conversation',
        'Visible AI marker on replies, configurable per conversation',
        'Keyword and Smart reply modes',
        'One command to pause every reply, plus per-conversation reply limits',
      ],
      isPartOf: { '@id': websiteId },
    },
    {
      '@type': 'SoftwareSourceCode',
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      codeRepository: GITHUB_URL,
      creativeWorkStatus: SITE_STATUS_LABEL,
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Bun 1.3.14 or newer on macOS',
      license: 'https://opensource.org/license/mit',
      author: { '@id': organizationId },
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
    <html className="hraness-palette" data-hraness-theme="paper" data-hraness-material="lantern" data-hraness-pattern="none" data-palette="gruvbox" lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-bootstrap.js" />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
