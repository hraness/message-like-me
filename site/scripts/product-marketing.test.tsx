import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import Home from '../app/page.tsx';
import { TERMINAL_FIRST_RUN } from '../app/_lib/terminal.ts';
import About from '../app/about/page.tsx';
import Preview from '../app/preview/page.tsx';
import { GET as getDiscoveryText } from '../app/llms.txt/route.ts';
import { checkMarketingSnapshot } from '../styles/vendor/hraness-marketing/check.mjs';
import { AGENT_SETUP_PROMPT, GETTING_STARTED_URL, GITHUB_URL, REPLY_WRITERS_SENTENCE, SITE_STATUS, SITE_STATUS_LABEL, SOFTWARE_VERSION } from '../app/_lib/site.ts';

const siteRoot = resolve(import.meta.dir, '..');

const HERO_VOCABULARY_TO_AVOID = [
  'bounded',
  'exact',
  'authority',
  'custody',
  'immutable',
  'inspectable',
  'canonical',
  'projection',
  'receipt',
] as const;

// Delivery vocabulary from AGENTS.md and the XCB receipt. Pages say what the
// reader gets instead; the one status statement lives in SITE_STATUS.
const PAGE_VOCABULARY_TO_AVOID = [
  'admission',
  'admitted',
  'qualification',
  'qualified',
  'custody',
  'composition',
  'source pilot',
  'source daemon',
  'compiled runtime',
  'receipt',
] as const;

// The shared Related block is portfolio copy owned outside this repository.
function textBeforeRelated(html: string): string {
  const related = html.indexOf('data-hraness-marketing="related"');
  return (related === -1 ? html : html.slice(0, related)).replace(/<[^>]+>/gu, ' ').toLowerCase();
}

test('renders Textbutler with the shared grammar and one development status', () => {
  const html = renderToStaticMarkup(<Home />);
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(/<h1[^>]*>([^<]+)<\/h1>/u.exec(html)?.[1]).toBe('AI in your messages.');
  for (const role of ['header', 'hero', 'section', 'flow', 'questions', 'cta', 'footer']) {
    expect(html).toContain(`data-hraness-marketing="${role}"`);
  }
  expect(html).toContain('hraness-marketing-header__brand');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  expect(header).toContain('aria-label="Textbutler home"');
  expect(header).toContain('hraness-foil-mark');
  expect(header).toContain('src="/marks/message-like-me.svg"');
  expect(header).not.toContain('src="/icon.png"');
  expect(html).toContain('data-foil=""');
  expect(html).toContain('Textbutler');
  expect(html).toContain('See how it works');
  expect(html).toContain('id="how-it-works"');
  expect(html).toContain('id="setup"');
  expect(html).toContain('id="models"');
  expect(html).toContain('id="supports"');
  // SITE_STATUS renders once, directly under the hero.
  expect(html.split(SITE_STATUS)).toHaveLength(2);
  expect(html.indexOf(SITE_STATUS)).toBeLessThan(html.indexOf('id="how-it-works"'));
  expect(html).toContain('new installs start paused');
  expect(html).toContain('iMessage, WhatsApp, and Beeper');
  expect(html).toContain(REPLY_WRITERS_SENTENCE);
  expect(html).toContain('In testing');
  expect(html).toContain('ollama pull qwen3:4b-instruct-2507-q4_K_M');
  expect(html).toContain('pbpaste | textbutler providers gateway-key');
  expect(html).toContain('Spending stops at $1 a day.');
  expect(html).toContain('If you choose one with a command, that choice wins.');
  expect(html).toContain('That copy writes the AI replies');
  expect(html).toContain('can’t run commands on your Mac');
  expect(html).toContain('MIT licensed');
  expect(html).toContain('Telegram’s terms limit AI use of message content, so ask the person first.');
  expect(html).toContain('Built on your Mac');
  expect(html).toContain('Setup builds a small helper app on your Mac so macOS can grant iMessage access.');
  expect(html).toContain('It waits 5 minutes after you last wrote, and skips requests in that window rather than saving them.');
  expect(html).not.toContain(`Textbutler v${SOFTWARE_VERSION}`);
  expect(html).toContain('Installing them doesn’t install Textbutler or turn on automatic replies.');
  expect(html).toContain('No. textbutler.app is informational');
  expect(html).toContain('"@type":"FAQPage"');
  expect(html).not.toMatch(/<(?:form|input|textarea)\b/u);
  expect(html).not.toContain('bun add --global');
  expect(html).not.toContain('Install v');
});

test('keeps the hero outcome-led and free of contract vocabulary', () => {
  const html = renderToStaticMarkup(<Home />);
  const hero = /<header[^>]*data-hraness-marketing="hero"[\s\S]*?<\/header>/u.exec(html);
  expect(hero).not.toBeNull();
  const heroCopy = (hero?.[0] ?? '').replace(/<[^>]+>/gu, ' ').toLowerCase();
  const heading = /<h1[^>]*>([^<]+)<\/h1>/u.exec(html)?.[1] ?? '';
  expect(heading.split(/\s+/u).length).toBeLessThanOrEqual(10);
  expect(heroCopy).toContain('your');
  const boundary = /<p\b[^>]*class="[^"]*\bhraness-marketing-hero__boundary\b[^"]*"[^>]*>([^<]+)<\/p>/u.exec(hero?.[0] ?? '')?.[1] ?? '';
  expect(boundary).toStartWith(`${SITE_STATUS_LABEL} · macOS`);
  for (const app of ['iMessage', 'WhatsApp', 'Beeper']) expect(boundary).toContain(app);
  expect(boundary).not.toContain(SOFTWARE_VERSION);
  for (const word of HERO_VOCABULARY_TO_AVOID) expect(heroCopy).not.toMatch(new RegExp(`\\b${word}\\b`, 'u'));
});

test('keeps delivery vocabulary off the product pages', async () => {
  const discovery = await getDiscoveryText().text();
  const pages = {
    home: textBeforeRelated(renderToStaticMarkup(<Home />)),
    about: textBeforeRelated(renderToStaticMarkup(<About />)),
    preview: textBeforeRelated(renderToStaticMarkup(<Preview />)),
    discovery: discovery.slice(0, discovery.indexOf('## Legacy Message Like Me history tools')).toLowerCase(),
  };
  for (const [name, copy] of Object.entries(pages)) {
    expect(copy.length, name).toBeGreaterThan(0);
    for (const word of PAGE_VOCABULARY_TO_AVOID) expect(copy, `${name}: ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`, 'u'));
  }
});

test('shows the real first terminal screen, synthetic conversations, and disclosure without claiming transport support', async () => {
  const html = renderToStaticMarkup(<Home />);
  // The manual path mirrors the guided terminal's own first screen.
  const tui = await readFile(resolve(siteRoot, '../packages/textbutler/src/tui.ts'), 'utf8');
  for (const line of TERMINAL_FIRST_RUN) {
    if (line) expect(tui, line).toContain(JSON.stringify(line));
  }
  expect(html.replace(/<\/?span\b[^>]*>/gu, '')).toContain('$ bun run textbutler tui');
  expect(html).toContain('data-hraness-marketing="proof-frame"');
  expect(html).toContain('data-language="shell"');
  expect(html).toContain('syntax-token--command');
  expect(html).not.toContain('Illustration only.');
  expect(html).not.toMatch(/data-hraness-hero-item|hraness-hero-backdrop|conversation-field/u);
  // The marker is literal text with one space inside each brace.
  expect(html).toContain('🤖{ 👀 }');
  expect(html).toContain('Textbutler runs on Sam’s Mac; the people are made up.');
  expect(html).not.toContain('Happy to help');
  expect(html).toContain('MEMORY.md');
  expect(html).toContain('AGENTS.md');
  expect(html).toContain('the word “butler”');
  expect(html).toContain('No tapbacks or other reactions on a normal Mac.');
  expect(html).toContain('SMS and RCS aren’t supported.');
  expect(html).toContain('under its own data policies');
  // The agent prompt is shown verbatim, copied by a button, never submitted.
  expect(html).toContain('Copy prompt');
  for (const line of AGENT_SETUP_PROMPT.split('\n')) expect(html).toContain(line.replaceAll("'", '&#x27;'));
  expect(html).toContain('Leave every chat turned off and don&#x27;t send any messages.');
});

test('binds Design Kit v0.24.0 to the portable Paper palette', async () => {
  const [layout, css, manifestSource, paper] = await Promise.all([
    readFile(resolve(siteRoot, 'app/layout.tsx'), 'utf8'),
    readFile(resolve(siteRoot, 'app/globals.css'), 'utf8'),
    readFile(resolve(siteRoot, 'package.json'), 'utf8'),
    readFile(resolve(siteRoot, 'styles/vendor/hraness-paper/paper-theme.css'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestSource) as {
    dependencies?: Record<string, string>;
  };

  expect(manifest.dependencies?.['@hraness/design-kit'])
    .toBe('github:hraness/design-kit#v0.24.0');
  expect(manifest.dependencies?.['@hraness/ui'])
    .toBe('github:hraness/ui#v0.5.19');
  expect(css).toContain("@import '@hraness/design-kit/styles.css';");
  expect(layout).toContain("colorScheme: 'light dark'");
  expect(layout).toContain('data-hraness-theme="paper"');
  expect(css).toContain("@import '../styles/vendor/hraness-paper/paper-theme.css';");
  expect(paper).toContain('color-scheme: light dark;');
  expect(paper).toContain('--hraness-site-accent: var(--primary);');
  expect(paper).toContain('--hraness-site-accent-ink: var(--primary-foreground);');
  expect(css).toContain(':where(.hraness-marketing-page, .hraness-marketing-header) {');
  expect(css).toContain('.textbutler-marketing .hraness-marketing-hero {');
  expect(css).not.toMatch(/backdrop-filter:(?!\s*none)/u);
  expect(layout).toContain('data-hraness-pattern="none"');
  expect(css).not.toContain('--acid');
  expect(css).not.toMatch(/transition:/u);
});


test('admits the released finite marketing snapshot and scopes it to the landing', async () => {
  const snapshot = await checkMarketingSnapshot();
  expect(snapshot.source.commit).toBe('3df4c411c7f5e5cbc02448463571696f0d47cee5');
  const html = renderToStaticMarkup(<Home />);
  // React hoists the product icon's preload ahead of the document root.
  expect(html.replace(/^(?:<link\b[^>]*>\s*)+/u, ''))
    .toStartWith('<div class="textbutler-marketing" data-hraness-marketing-preset="editorial" data-hraness-pattern="none">');
  expect(renderToStaticMarkup(<About />)).not.toContain('data-hraness-marketing-preset');
  expect(renderToStaticMarkup(<Preview />)).not.toContain('data-hraness-marketing-preset');
  // The Quiet landing uses no material panes, walls, or translucent chrome.
  for (const page of [html, renderToStaticMarkup(<About />), renderToStaticMarkup(<Preview />)]) {
    expect(page).not.toContain('hraness-material');
  }
});

test('keeps machine-readable setup and conditional subscription admission consistent with the landing', async () => {
  const discovery = await getDiscoveryText().text();
  expect(discovery).toContain('New installations start paused and new contacts start disabled.');
  expect(discovery).toContain('only from the local install that bun run textbutler:install builds');
  expect(discovery).toContain('it checks its own source against the last reviewed version first');
  expect(discovery).toContain('Running from source never writes AI replies.');
  expect(discovery).toContain('A subscription account must also pass providers check');
  expect(discovery).toContain(REPLY_WRITERS_SENTENCE);
  expect(discovery).toContain('ollama pull qwen3:4b-instruct-2507-q4_K_M');
  expect(discovery).not.toContain('still needs an xcb account');
  expect(discovery.slice(0, discovery.indexOf('## Legacy Message Like Me history tools'))).not.toContain('habitat');
  expect(discovery).toContain('no app to download and no published Textbutler package');
  expect(discovery).toContain(AGENT_SETUP_PROMPT);
  expect(discovery).toContain('Test inference and delivery on your own account');
});

test('offers guided source setup without implying a released AI engine or a menu bar app', async () => {
  const home = renderToStaticMarkup(<Home />).replace(/<\/?span\b[^>]*>/gu, '');
  const about = renderToStaticMarkup(<About />);
  const discovery = await getDiscoveryText().text();
  // The full status renders on the home page and in llms.txt; About links to it.
  for (const content of [home, discovery]) expect(content).toContain(SITE_STATUS);
  expect(about).not.toContain(SITE_STATUS);
  expect(about).toContain('href="/#status"');
  for (const content of [home, about, discovery]) {
    expect(content).toContain(GETTING_STARTED_URL);
    expect(content).toContain('bun run textbutler:install');
    expect(content).toMatch(/last reviewed version/u);
    expect(content).toMatch(/That copy writes the AI replies|AI replies come only from the local install/u);
    if (content !== home) expect(content).toMatch(/Claude API route (?:isn’t|is not) available in any build of this repository/u);
    expect(content).toContain('https://github.com/hraness/xcb');
    expect(content).toContain('no window');
    expect(content).not.toMatch(/menu bar companion|menubar|prebuilt runner/iu);
    expect(content).not.toContain('Claude API is available after setup');
    expect(content).not.toContain(`${GITHUB_URL}/tree/main/apps/macos`);
  }
  expect(home).toContain('Have your agent set it up');
  expect(home).toContain('href="#setup"');
  expect(home).toContain(`${GITHUB_URL}/blob/main/docs/textbutler/native-subscription.md`);
  expect(discovery).toContain('replies show DRAFT');
  expect(discovery).toContain('replies send DRAFT DIGEST');
});
