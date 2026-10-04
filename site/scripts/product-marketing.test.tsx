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
import { AGENT_SETUP_PROMPT, GETTING_STARTED_URL, GITHUB_URL, REPLY_WRITERS_SENTENCE, SITE_STATUS } from '../app/_lib/site.ts';

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

test('renders TextButler with early model choices and setup', () => {
  const html = renderToStaticMarkup(<Home />);
  expect(html.match(/<h1\b/gu)).toHaveLength(1);
  expect(/<h1[^>]*>([^<]+)<\/h1>/u.exec(html)?.[1]).toBe('An AI butler in your messaging apps.');
  for (const role of ['header', 'hero', 'section', 'flow', 'questions', 'cta', 'footer']) {
    expect(html).toContain(`data-hraness-marketing="${role}"`);
  }
  expect(html).toContain('hraness-marketing-header__brand');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  expect(header).toContain('aria-label="TextButler home"');
  expect(header).toContain('hraness-foil-mark');
  expect(header).toContain('src="/marks/textbutler.svg"');
  expect(header).not.toContain('src="/icon.png"');
  expect(html).toContain('data-foil=""');
  expect(html).toContain('TextButler');
  expect(html).toContain('Have your agent set it up');
  expect(html).toContain('id="how-it-works"');
  expect(html).toContain('id="setup"');
  expect(html).toContain('id="models"');
  expect(html).toContain('id="supports"');
  // One Mac/setup note, followed by model choices and setup before detail.
  expect(html.split(SITE_STATUS)).toHaveLength(2);
  expect(html.indexOf(SITE_STATUS)).toBeLessThan(html.indexOf('id="how-it-works"'));
  expect(html.toLowerCase()).toContain('new installs start paused');
  expect(html.indexOf('id="models"')).toBeLessThan(html.indexOf('id="setup"'));
  expect(html.indexOf('id="setup"')).toBeLessThan(html.indexOf('id="how-it-works"'));
  expect(html.indexOf('id="setup"')).toBeLessThan(html.indexOf('id="supports"'));
  for (const channel of ['iMessage', 'WhatsApp', 'Beeper']) expect(html).toContain(channel);
  expect(html).toContain(REPLY_WRITERS_SENTENCE);
  expect(html).not.toMatch(/Works today|In testing|not yet tested live/iu);
  expect(html).toContain('Spending stops at $1 a day.');
  expect(html).toContain('If you choose one with a command, that choice wins.');
  expect(html).toContain('Connect your AI subscription');
  expect(html).toContain('A local model writes replies on your Mac too.');
  expect(html).toContain('MIT licensed');
  expect(html).toContain('Keep Beeper Desktop open with your messaging accounts connected.');
  expect(html).toContain('Choose a group, review its members, and turn on replies.');
  expect(html).not.toContain('Built on your Mac');
  expect(html).toContain('After you write in a chat, it pauses for the human cooldown you set (5 minutes by default).');
  expect(html).not.toMatch(/message like me|messagelikeme|\/sources"/iu);
  expect(html).toContain('Only anonymous visit counts. textbutler.app counts page views');
  expect(html).toContain('It sets no cookies, doesn’t identify you, and doesn’t record sessions.');
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
  expect(hero?.[0]).not.toContain('hraness-marketing-hero__boundary');
  expect(hero?.[0]).not.toContain('hraness-marketing-hero__install');
  expect(hero?.[0]).not.toContain('git clone');
  for (const word of HERO_VOCABULARY_TO_AVOID) expect(heroCopy).not.toMatch(new RegExp(`\\b${word}\\b`, 'u'));
});

test('keeps delivery vocabulary off the product pages', async () => {
  const discovery = await getDiscoveryText().text();
  const pages = {
    home: textBeforeRelated(renderToStaticMarkup(<Home />)),
    about: textBeforeRelated(renderToStaticMarkup(<About />)),
    preview: textBeforeRelated(renderToStaticMarkup(<Preview />)),
    discovery: discovery.toLowerCase(),
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
  expect(html).toContain('TextButler runs on your Mac.');
  expect(html).not.toContain('Happy to help');
  expect(html).toContain('MEMORY.md');
  expect(html).toContain('AGENTS.md');
  expect(html).toContain('the word “butler”');
  expect(html).toContain('Connect them through Beeper Desktop for text replies.');
  expect(html).toContain('under its own data policies');
  // The agent prompt is shown verbatim, copied by a button, never submitted.
  expect(html).toContain('aria-label="Copy setup prompt"');
  for (const line of AGENT_SETUP_PROMPT.split('\n')) expect(html).toContain(line.replaceAll("'", '&#x27;'));
  expect(html).toContain('Leave every chat turned off and don&#x27;t send any messages.');
});

test('offers local coding apps for setup on the reader’s Mac', () => {
  const html = renderToStaticMarkup(<Home />);
  const targets: string[] = [];
  new HTMLRewriter().on('#setup a[data-agent-target]', {
    element(element) { targets.push(element.getAttribute('data-agent-target') ?? ''); },
  }).transform(html);
  expect(targets).toEqual(['cursor', 'codex-app']);
  expect(html).toContain('Paste this prompt into your coding agent.');
  expect(html).toContain('aria-label="Copy setup prompt"');
});

test('binds the released Design Kit to the portable Paper palette', async () => {
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
    .toBe('github:hraness/design-kit#v0.40.0');
  expect(manifest.dependencies?.['@hraness/ui'])
    .toBe('github:hraness/ui#v0.5.19');
  expect(css).toContain("@import '@hraness/design-kit/compiler-foundation.css';");
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
  expect(snapshot.source.commit).toBe('9103a32de3902b64a69e069326586d25927f35bc');
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

test('keeps machine-readable setup and reply controls consistent with the landing', async () => {
  const discovery = await getDiscoveryText().text();
  expect(discovery).toContain('New installations start paused and new conversations start turned off.');
  expect(discovery).toContain('Automatic AI replies need the installed TextButler command');
  expect(discovery).toContain(REPLY_WRITERS_SENTENCE);
  expect(discovery).toContain('ollama pull qwen3:4b-instruct-2507-q4_K_M');
  expect(discovery).toContain(AGENT_SETUP_PROMPT);
  expect(discovery).toContain('Smart mode can recognize a request for help without the keyword');
  expect(discovery).toContain('carry an AI marker by default');
  expect(discovery).toContain('web search sends queries through a saved Gateway key, even when a local model writes the reply');
  expect(discovery).not.toMatch(/85% sure|Works today|In testing|Coming soon/iu);
});

test('offers guided setup and draft review without implying a menu bar app', async () => {
  const home = renderToStaticMarkup(<Home />).replace(/<\/?span\b[^>]*>/gu, '');
  const discovery = await getDiscoveryText().text();
  for (const content of [home, discovery]) {
    expect(content).toContain(SITE_STATUS);
    expect(content).toContain(GETTING_STARTED_URL);
    expect(content).not.toMatch(/menu bar companion|menubar|prebuilt runner/iu);
    expect(content).not.toContain(`${GITHUB_URL}/tree/main/apps/macos`);
  }
  expect(home).toContain('Have your agent set it up');
  expect(home).toContain('href="#setup"');
  expect(home).toContain(`${GITHUB_URL}/blob/main/docs/textbutler/native-subscription.md`);
  expect(discovery).toContain('replies show DRAFT');
  expect(discovery).toContain('replies send DRAFT DIGEST');
});

test('keeps manual installation in its setup guide after the agent prompt', () => {
  const html = renderToStaticMarkup(<Home />);
  const guides: string[] = [];
  new HTMLRewriter().on('#install a', {
    element(element) { guides.push(element.getAttribute('href') ?? ''); },
  }).transform(html);
  expect(guides).toContain(GETTING_STARTED_URL);
  expect(html).not.toContain('git clone');
  expect(html.indexOf('Copy setup prompt')).toBeLessThan(html.indexOf('id="install"'));
});
