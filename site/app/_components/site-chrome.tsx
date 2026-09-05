import { MarketingSiteHeader } from '@hraness/design-kit/react/server';
import { AskAiAboutThis } from '@hraness/ui';
import Link from 'next/link';

import {
  absoluteUrl,
  type CanonicalPagePath,
  GITHUB_URL,
  SOFTWARE_VERSION,
} from '../_lib/site';

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: '/#install', label: `Install v${SOFTWARE_VERSION}` }}
        ariaLabel="Primary navigation"
        brand="Message Like Me"
        brandLabel="Message Like Me home"
        className="site-header"
        links={[
          { href: '/sources', label: 'Sources' },
          { href: '/docs', label: 'Docs' },
          { href: '/methodology', label: 'Method' },
          { href: '/research', label: 'Research' },
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
        <Link className="wordmark" href="/">Message Like Me</Link>
        <p>Open source · MIT · local first</p>
        <nav aria-label="Footer navigation">
          <Link href="/about">About</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/docs">Docs</Link>
          <a href={GITHUB_URL}>GitHub</a>
        </nav>
      </footer>
    </>
  );
}
