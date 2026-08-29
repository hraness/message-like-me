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
  expect(html).toContain('"headline":"Message Like Me"');
  expect(css).toContain('.readme-prose img { height: auto; max-width: 100%; }');
});

test.each([
  ['methodology', 'Methodology', MethodologyPage],
  ['research', 'Research and prior art', ResearchPage],
] as const)('keeps one source-owned heading on the %s document', (_, heading, Page) => {
  const html = renderToStaticMarkup(<Page />);
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain(`"headline":"${heading}"`);
});
