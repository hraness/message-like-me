'use client';

import { capturePostHogCtaClicked, capturePostHogInstallCommandCopied } from '@hraness/posthog/client';
import { PostHogAnalytics } from '@hraness/posthog/react';
import { useEffect } from 'react';

import { textbutlerPostHogSite } from '../_lib/analytics';

/**
 * Names a call-to-action link without its query or path details: an in-page
 * anchor keeps its fragment name, an outside link keeps only its host.
 */
export function ctaTarget(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (url.origin === origin) return url.hash ? url.hash.slice(1).slice(0, 64) : url.pathname.slice(0, 64);
    return url.hostname.slice(0, 64);
  } catch {
    return null;
  }
}

/** Records that the setup prompt was copied. Returns false when analytics is off. */
export function captureInstallCopied(): boolean {
  return capturePostHogInstallCommandCopied(textbutlerPostHogSite, { installMethod: 'other', placement: 'inline' });
}

function CtaClicks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>('a.hraness-marketing-action');
      if (link === null) return;
      const target = ctaTarget(link.getAttribute('href') ?? '', window.location.origin);
      if (target === null) return;
      const location = link.closest('[data-hraness-marketing]')?.getAttribute('data-hraness-marketing') ?? 'page';
      capturePostHogCtaClicked(textbutlerPostHogSite, { cta: target.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'home', placement: location === 'hero' || location === 'footer' ? location : location === 'header' ? 'nav' : 'inline' });
    };
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);
  return null;
}

/**
 * Cookieless, anonymous PostHog capture. It stays inert outside production on
 * textbutler.app and whenever NEXT_PUBLIC_POSTHOG_KEY is unset.
 */
export function Analytics() {
  return (
    <>
      <PostHogAnalytics captureOutboundLinks apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY} site={textbutlerPostHogSite} />
      <CtaClicks />
    </>
  );
}
