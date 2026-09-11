import { MarketingSiteHeader } from '@hraness/design-kit/react/server';
import { AskAiAboutThis } from '@hraness/ui';
import Link from 'next/link';

import {
  absoluteUrl,
  type CanonicalPagePath,
  GITHUB_URL,
  ARCHITECTURE_URL,
} from '../_lib/site';

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: '/#development', label: 'Development status' }}
        ariaLabel="Primary navigation"
        brand="Textbutler"
        brandLabel="Textbutler home"
        className="site-header"
        links={[
          { href: '/#how-it-works', label: 'How it works' },
          { href: '/docs', label: 'Docs' },
          { href: ARCHITECTURE_URL, label: 'Architecture' },
          { href: GITHUB_URL, label: 'GitHub' },
        ]}
      />
    </>
  );
}

export function SiteFooter({ path }: Readonly<{ path?: CanonicalPagePath }>) {
  return (
    <>
      {path === undefined ? null : (
        <AskAiAboutThis
          className="message-like-me-ask-ai"
          url={absoluteUrl(path)}
        />
      )}
      <footer className="site-footer">
        <Link className="wordmark" href="/">Textbutler</Link>
        <p>Built for Mac · MIT source · in development</p>
        <nav aria-label="Footer navigation">
          <Link href="/about">About</Link>
          <Link href="/sources">Legacy history tools</Link>
          <Link href="/docs">Docs</Link>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
      </footer>
    </>
  );
}
