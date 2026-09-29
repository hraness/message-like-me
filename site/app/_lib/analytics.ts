import {
  POSTHOG_SCHEMA_VERSION,
  type PostHogSiteDefinition,
} from '@hraness/posthog';

// Textbutler shares the Hraness "small-sites" PostHog project and is told apart
// by site_id. Capture is cookieless and anonymous, runs only on the production
// hosts below, and sends only page views plus the events listed here.
export const TEXTBUTLER_CTA_EVENT = 'cta clicked';
export const TEXTBUTLER_INSTALL_COPY_EVENT = 'install command copied';

export const textbutlerPostHogSite = {
  id: 'textbutler',
  canonicalDomain: 'textbutler.app',
  allowedHosts: ['textbutler.app', 'www.textbutler.app'],
  schemaVersion: POSTHOG_SCHEMA_VERSION,
  routes: [
    { match: 'exact', path: '/', pageKind: 'landing' },
    { match: 'exact', path: '/about', pageKind: 'about' },
    { match: 'exact', path: '/docs', pageKind: 'docs' },
    { match: 'exact', path: '/sources', pageKind: 'sources' },
    { match: 'exact', path: '/research', pageKind: 'research' },
    { match: 'exact', path: '/methodology', pageKind: 'methodology' },
    { match: 'exact', path: '/stills', pageKind: 'stills' },
    { match: 'exact', path: '/blog', pageKind: 'blog' },
    { match: 'prefix', path: '/blog', pageKind: 'post', contentGroup: 'blog', captureSlug: true },
    { match: 'prefix', path: '/compare', pageKind: 'compare', contentGroup: 'compare', captureSlug: true },
  ],
  customEvents: [TEXTBUTLER_CTA_EVENT, TEXTBUTLER_INSTALL_COPY_EVENT],
  stripQueryAttribution: true,
  unknownCanonicalPath: '/other',
} as const satisfies PostHogSiteDefinition;
