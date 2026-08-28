import { AskAiAboutThis } from '@hraness/ui';
import Link from 'next/link';

import {
  absoluteUrl,
  type CanonicalPagePath,
  GITHUB_URL,
} from '../_lib/site';

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Message Like Me home">
          message <span>like me</span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link className="nav-priority" href="/sources">Sources</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/methodology">Method</Link>
          <Link href="/research">Research</Link>
          <a href={GITHUB_URL}>GitHub ↗</a>
        </nav>
      </header>
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
      <footer>
        <Link className="wordmark" href="/">message <span>like me</span></Link>
        <p>Open source · MIT · local first</p>
        <nav aria-label="Footer navigation">
          <Link href="/about">About</Link>
          <Link href="/sources">Sources</Link>
          <Link href="/docs">Docs</Link>
          <a href={GITHUB_URL}>GitHub ↗</a>
        </nav>
      </footer>
    </>
  );
}
