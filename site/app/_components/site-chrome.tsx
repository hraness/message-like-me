import { ThemeMenuButton } from '@hraness/design-kit/react';
import { HranessSiteFooter } from '@hraness/site-footer/react';
import { MarketingSiteFooter, MarketingSiteHeader } from '@hraness/design-kit/react/server';
import { AskAiAboutThis } from '@hraness/ui';

import {
  absoluteUrl,
  type SitePath,
  GITHUB_URL,
} from '../_lib/site';

// The shared footer contract pins the canonical generated icon element exactly.
// eslint-disable-next-line @next/next/no-img-element
const productMark = <img alt="" height={20} src="/icon.png" width={20} />;

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: '/#setup', label: 'Set up' }}
        ariaLabel="Primary navigation"
        brand="Textbutler"
        brandLabel="Textbutler home"
        brandMark="/marks/message-like-me.svg"
        className="site-header"
        trailing={<ThemeMenuButton aria-label="Appearance" />}
        links={[
          { href: '/#how-it-works', label: 'How it works' },
          { href: '/#setup', label: 'Setup' },
          { href: '/blog', label: 'Blog' },
          { href: GITHUB_URL, label: 'GitHub' },
        ]}
      />
    </>
  );
}

export function SiteFooter({ path }: Readonly<{ path?: SitePath }>) {
  return (
    <>
      {path === undefined ? null : (
        <AskAiAboutThis
          className="message-like-me-ask-ai"
          url={absoluteUrl(path)}
        />
      )}
      <MarketingSiteFooter
        ariaLabel="Textbutler"
        brand={productMark}
        brandHref="/"
        brandLabel="Textbutler home"
        links={[
          { href: '/about', label: 'About' },
          { href: '/sources', label: 'Legacy history tools' },
          { href: '/docs', label: 'Docs' },
          { href: '/blog', label: 'Blog' },
          { href: GITHUB_URL, label: 'GitHub' },
        ]}
        name="Textbutler"
      >
        <p>AI in your messages · Mac only · MIT source · in development</p>
      </MarketingSiteFooter>
      <HranessSiteFooter
        mailingList={{ kind: "none" }}
        support={{ id: "textbutler", name: "Textbutler", updates: false, valueProposition: "Support ongoing development of Textbutler." }}
      />
    </>
  );
}
