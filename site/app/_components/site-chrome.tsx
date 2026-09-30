import { ThemeMenuButton } from '@hraness/design-kit/react';
import { HranessSiteFooter } from '@hraness/site-footer/react';
import { MarketingSiteFooter, MarketingSiteHeader } from '@hraness/design-kit/react/server';
import { AskAiAboutThis } from '@hraness/ui';

import {
  absoluteUrl,
  SITE_NAME,
  type SitePath,
  GITHUB_URL,
} from '../_lib/site';

export function SiteHeader() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <MarketingSiteHeader
        action={{ href: '/#setup', label: 'Set up' }}
        ariaLabel="Primary navigation"
        brand={SITE_NAME}
        brandLabel={`${SITE_NAME} home`}
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
        ariaLabel={SITE_NAME}
        brand={null}
        brandMark="/marks/message-like-me.svg"
        brandHref="/"
        brandLabel={`${SITE_NAME} home`}
        links={[
          { href: '/about', label: 'About' },
          { href: '/sources', label: 'Legacy history tools' },
          { href: '/docs', label: 'Docs' },
          { href: '/compare/ghostreply', label: 'Compare with GhostReply' },
          { href: '/blog', label: 'Blog' },
          { href: GITHUB_URL, label: 'GitHub' },
        ]}
        name={SITE_NAME}
      >
        <p>AI in your messages · Mac only · MIT source · in development</p>
      </MarketingSiteFooter>
      <HranessSiteFooter
        mailingList={{ kind: "none" }}
        support={{ id: "textbutler", name: SITE_NAME, updates: false, valueProposition: `Support ongoing development of ${SITE_NAME}.` }}
      />
    </>
  );
}
