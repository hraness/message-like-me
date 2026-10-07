import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import nextConfig, { frameSafePreviewHeaders } from '../next.config.ts';
import PreviewPage, { metadata } from '../app/preview/page.tsx';
import { SITE_HEADLINE, SITE_STATUS } from '../app/_lib/site.ts';

test('server-renders a script-independent preview with the site status and no navigation', () => {
  const html = renderToStaticMarkup(<PreviewPage />);

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain(SITE_HEADLINE);
  expect(html).toContain(SITE_STATUS);
  expect(html).toContain('local model through Ollama');
  expect(html).not.toContain('(in testing)');
  expect(html).toContain('runs in the background with no window or menu bar icon');
  expect(html).toContain('🤖{ 👀 }');
  expect(html).toContain('an AI marker by default');
  expect(html).toContain('Synthetic example · no message sent');
  expect(html).not.toContain('Happy to help');
  expect(html).not.toMatch(/<(?:a|button|form|script)\b/u);
  expect(metadata.robots).toEqual({ follow: false, index: false });
});

test('sets no framing restrictions on any path', async () => {
  const rules = await nextConfig.headers?.();
  expect(rules).toBeDefined();

  const previewRule = rules?.find(({ source }) => source === '/preview');
  const otherRule = rules?.find(({ source }) => source === '/((?!preview$).*)');

  expect(previewRule?.headers).toEqual([...frameSafePreviewHeaders]);
  expect(previewRule?.headers).toContainEqual({
    key: 'X-Robots-Tag',
    value: 'noindex, nofollow',
  });
  for (const rule of rules ?? []) {
    expect(rule.headers.some(({ key }) => key === 'X-Frame-Options')).toBeFalse();
    for (const header of rule.headers) expect(header.value).not.toContain('frame-ancestors');
  }
  expect(otherRule?.headers).toContainEqual({
    key: 'Content-Security-Policy',
    value: expect.stringContaining(
      "img-src 'self' data: https://raw.githubusercontent.com https://skills.sh https://www.skills.sh",
    ),
  });
});
