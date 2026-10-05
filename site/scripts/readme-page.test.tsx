import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import DocsPage from '../app/docs/page.tsx';
import { SITE_STATUS } from '../app/_lib/site.ts';

const text = (html: string) => html.replace(/<\/?(?:a|code|em|strong)\b[^>]*>/gu, '').replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');

test('renders the complete README with one source-owned heading and working anchors', async () => {
  const html = renderToStaticMarkup(<DocsPage />);
  const css = await Bun.file(new URL('../app/globals.css', import.meta.url)).text();

  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(html).toContain('<h1 id="textbutler">TextButler</h1>');
  expect(html).not.toContain('skills.sh');
  expect(html).not.toContain('id="install-and-first-run"');
  expect(html).not.toMatch(/message like me|messagelikeme|message-like-me/iu);
  for (const fragment of html.matchAll(/href="#([^"]+)"/gu)) expect(html).toContain(`id="${fragment[1]}"`);
  expect(html).toContain('"headline":"TextButler"');
  expect(html).toContain('"dateModified":"2026-10-04"');
  expect(css).toContain('.readme-prose img { height: auto; max-width: 100%; }');
});

test('leads with the agent setup prompt, then the guided terminal and complete draft review', () => {
  const html = renderToStaticMarkup(<DocsPage />);
  expect(html).toContain('<h2 id="open-the-guided-terminal">Open the guided terminal</h2>');
  expect(html.replace(/<\/?span\b[^>]*>/gu, '')).toContain('bun run textbutler tui');
  expect(html).toContain('docs/textbutler/getting-started.md');
  // README.md repeats SITE_STATUS word for word, so the site and the README
  // state the same setup defaults.
  expect(text(html)).toContain(SITE_STATUS.replace(/\s+/gu, ' '));
  expect(html.replace(/<\/?span\b[^>]*>/gu, '')).toContain('bun run textbutler:install');
  expect(html).toContain('href="https://github.com/hraness/xcb"');
  expect(text(html)).toContain('~/.local/bin/textbutler');
  expect(text(html)).toContain('The installer refuses to build if the code doesn’t match the last reviewed version.');
  expect(html.replace(/<\/?span\b[^>]*>/gu, '')).toContain('bun run textbutler replies show DRAFT');
  expect(html.replace(/<\/?span\b[^>]*>/gu, '')).toContain('bun run textbutler replies send DRAFT DIGEST');
  expect(html.indexOf('id="set-it-up-with-your-agent"')).toBeLessThan(html.indexOf('id="open-the-guided-terminal"'));
  expect(html.replace(/<\/?span\b[^>]*>/gu, '')).toContain('ollama pull qwen3:4b-instruct-2507-q4_K_M');
});
