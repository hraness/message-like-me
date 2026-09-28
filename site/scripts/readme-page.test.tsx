import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import DocsPage from '../app/docs/page.tsx';
import MethodologyPage from '../app/methodology/page.tsx';
import ResearchPage from '../app/research/page.tsx';
import { SITE_STATUS } from '../app/_lib/site.ts';

const text = (html: string) => html.replace(/<\/?(?:a|code|em|strong)\b[^>]*>/gu, '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');

test('renders the complete README with one source-owned heading and working anchors', async () => {
  const html = renderToStaticMarkup(<DocsPage />);
  const css = await Bun.file(new URL('../app/globals.css', import.meta.url)).text();

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain('<h1 id="textbutler">Textbutler</h1>');
  // The legacy Message Like Me reference moved to docs/message-like-me.md.
  expect(html).not.toContain('skills.sh');
  expect(html).not.toContain('id="install-and-first-run"');
  expect(html).toContain('href="https://github.com/hraness/textbutler/blob/main/docs/message-like-me.md"');
  for (const fragment of html.matchAll(/href="#([^"]+)"/gu)) expect(html).toContain(`id="${fragment[1]}"`);
  expect(html).toContain('"headline":"Textbutler"');
  expect(html).toContain('"dateModified":"2026-09-28"');
  expect(css).toContain('.readme-prose img { height: auto; max-width: 100%; }');
});

test('leads with the agent setup prompt, then the guided terminal and complete draft review', () => {
  const html = renderToStaticMarkup(<DocsPage />);
  expect(html).toContain('<h2 id="open-the-guided-terminal">Open the guided terminal</h2>');
  expect(html).toContain('bun run textbutler tui');
  expect(html).toContain('docs/textbutler/getting-started.md');
  // README.md repeats SITE_STATUS word for word, so the site and the README
  // state one development status.
  expect(text(html)).toContain(SITE_STATUS.replace(/\s+/gu, ' '));
  expect(html).toContain('bun run textbutler:install');
  expect(html).toContain('href="https://github.com/hraness/xcb"');
  expect(text(html)).toContain('Running from source never writes AI replies');
  expect(text(html)).toContain('match the reviewed record in qualification/');
  expect(html).toContain('bun run textbutler replies show DRAFT');
  expect(html).toContain('bun run textbutler replies send DRAFT DIGEST');
  expect(html.indexOf('id="set-it-up-with-your-agent"')).toBeLessThan(html.indexOf('id="open-the-guided-terminal"'));
  expect(html).toContain('ollama pull qwen3:4b-instruct-2507-q4_K_M');
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
  expect(html).toContain('This page comes from Message Like Me, Textbutler’s predecessor.');
  expect(html).toContain('not Textbutler’s live messaging');
});
