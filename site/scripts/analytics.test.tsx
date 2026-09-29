import { expect, test } from 'bun:test';
import { classifyAnalyticsRoute, isAllowedCustomEvent } from '@hraness/posthog';
import { renderToStaticMarkup } from 'react-dom/server';

import { ctaTarget } from '../app/_components/analytics';
import { TEXTBUTLER_CTA_EVENT, TEXTBUTLER_INSTALL_COPY_EVENT, textbutlerPostHogSite } from '../app/_lib/analytics';
import { REPLY_CREDITS_NOTE } from '../app/_lib/site';
import { REPLY_WRITERS } from '../app/_lib/landing';
import Home from '../app/page';

test('analytics uses the shared small-sites convention for textbutler.app only', () => {
  expect(textbutlerPostHogSite.id).toBe('textbutler');
  expect(textbutlerPostHogSite.canonicalDomain).toBe('textbutler.app');
  expect(classifyAnalyticsRoute(textbutlerPostHogSite, 'https://textbutler-git-main.vercel.app/')).toBeNull();
  expect(classifyAnalyticsRoute(textbutlerPostHogSite, 'http://localhost:3000/')).toBeNull();
  expect(classifyAnalyticsRoute(textbutlerPostHogSite, 'https://textbutler.app/?ref=x#setup')).toMatchObject({
    site_id: 'textbutler', canonical_path: '/', page_kind: 'landing',
  });
  expect(classifyAnalyticsRoute(textbutlerPostHogSite, 'https://textbutler.app/blog/introducing-textbutler')).toMatchObject({
    page_kind: 'post', content_group: 'blog', content_slug: 'introducing-textbutler',
  });
  expect(classifyAnalyticsRoute(textbutlerPostHogSite, 'https://textbutler.app/private/thing')?.canonical_path).toBe('/other');
});

test('only the two conventional custom events are allowed', () => {
  expect<readonly string[]>([...textbutlerPostHogSite.customEvents].sort()).toEqual([TEXTBUTLER_CTA_EVENT, TEXTBUTLER_INSTALL_COPY_EVENT].sort());
  expect(isAllowedCustomEvent(textbutlerPostHogSite, 'cta clicked')).toBe(true);
  expect(isAllowedCustomEvent(textbutlerPostHogSite, 'install command copied')).toBe(true);
  for (const name of ['signup started', 'checkout started', 'cta_clicked']) expect(isAllowedCustomEvent(textbutlerPostHogSite, name)).toBe(false);
});

test('CTA targets never carry a path or query from another site', () => {
  const origin = 'https://textbutler.app';
  expect(ctaTarget('#setup', origin)).toBe('setup');
  expect(ctaTarget('/about?x=1', origin)).toBe('/about');
  expect(ctaTarget('https://github.com/hraness/textbutler?tab=readme', origin)).toBe('github.com');
});

test('credits stay labeled as coming soon and are not offered as a reply writer', () => {
  expect(REPLY_WRITERS.map((writer) => writer.id)).toEqual(['local', 'key', 'subscription']);
  expect(REPLY_CREDITS_NOTE).toStartWith('Coming soon:');
  expect(REPLY_CREDITS_NOTE).toContain('aren’t available yet');
  const html = renderToStaticMarkup(<Home />);
  expect(html).toContain('>Coming</span>');
  expect(html).toContain('Coming soon: Textbutler AI credits');
  expect(html).toContain('coming soon and can’t be bought yet');
});
