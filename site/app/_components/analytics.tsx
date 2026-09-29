'use client';

import { capturePostHogEvent } from '@hraness/posthog/client';
import { PostHogAnalytics } from '@hraness/posthog/react';
import { useEffect } from 'react';

import { TEXTBUTLER_CTA_EVENT, TEXTBUTLER_INSTALL_COPY_EVENT, textbutlerPostHogSite } from '../_lib/analytics';

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
export function captureInstallCopied(target: string): boolean {
  return capturePostHogEvent(textbutlerPostHogSite, TEXTBUTLER_INSTALL_COPY_EVENT, { copy_target: target });
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
      capturePostHogEvent(textbutlerPostHogSite, TEXTBUTLER_CTA_EVENT, { cta_target: target, cta_location: location });
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
      <PostHogAnalytics apiKey={process.env.NEXT_PUBLIC_POSTHOG_KEY} site={textbutlerPostHogSite} />
      <CtaClicks />
    </>
  );
}
