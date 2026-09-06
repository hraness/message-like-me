import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import DocsPage from '../app/docs/page.tsx';
import MethodologyPage from '../app/methodology/page.tsx';
import ResearchPage from '../app/research/page.tsx';

test('renders the complete README with one source-owned heading and working anchors', async () => {
  const html = renderToStaticMarkup(<DocsPage />);
  const css = await Bun.file(new URL('../app/globals.css', import.meta.url)).text();

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain('<h1 id="message-like-me">Message Like Me</h1>');
  expect(html).toContain('src="https://skills.sh/b/hraness/message-like-me"');
  expect(html).toContain('href="#install-and-first-run"');
  expect(html).toContain('<h2 id="install-and-first-run">Install and first run</h2>');
  expect(html).toMatch(
    /Beeper users can bring a bounded observation from supported connected accounts\s+into the same private evidence layer as Apple Messages\./u,
  );
  expect(html).toContain(
    '<td>A finished local bundle from Wrench v0.16.7 and adapter 2.4.0; its reviewed surface has 32 operations: 26 through one pinned Beeper CLI 0.6.2 executable, including supported actions and writes, plus six fixed Desktop loopback reads</td>',
  );
  expect(html).toContain(
    'Message Like Me receives no provider credentials, never calls Wrench or a Beeper operation, and never sends',
  );
  expect(html).toContain('"headline":"Message Like Me"');
  expect(html).toContain('"dateModified":"2026-09-06"');
  expect(css).toContain('.readme-prose img { height: auto; max-width: 100%; }');
});

test.each([
  ['methodology', 'Methodology', MethodologyPage],
  ['research', 'Research and prior art', ResearchPage],
] as const)('keeps one source-owned heading on the %s document', (_, heading, Page) => {
  const html = renderToStaticMarkup(<Page />);
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(/<h1[^>]*>([^<]+)<\/h1>/u.exec(html)?.[1]).toBe(heading);
  expect(html).toContain(`"headline":"${heading}"`);
  expect(html).toContain('"dateModified":"2026-08-27"');
});
