import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://messagelikeme.com'),
  title: 'Message Like Me — Study how you message',
  description:
    'A local-first CLI and Agent Skill for studying private messaging history and drafting messages that sound like you.',
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Message Like Me',
    title: 'Message Like Me — Study how you message',
    description:
      'A local-first CLI and Agent Skill for studying private messaging history and drafting messages that sound like you.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'Message Like Me — Study how you message.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Message Like Me — Study how you message',
    description:
      'A local-first CLI and Agent Skill for studying private messaging history and drafting messages that sound like you.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
