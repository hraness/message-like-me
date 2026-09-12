import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { assertPresentation, browserCases, browserEnvironment, browserOwner, deadline, isSyntheticBadge } from './browser-contract.mjs';

// This gate serves only the built informational website. It never runs the CLI,
// Mac application, messaging providers, account checks, or personal-data readers.
const root = fileURLToPath(new URL('../', import.meta.url));
const executablePath = process.env.TEXTBUTLER_BROWSER_EXECUTABLE;
const node = process.env.TEXTBUTLER_NODE_EXECUTABLE;
assert.ok(executablePath?.startsWith('/'), 'Set TEXTBUTLER_BROWSER_EXECUTABLE to an installed Chromium executable.');
assert.ok(node?.startsWith('/'), 'Set TEXTBUTLER_NODE_EXECUTABLE to an installed Node 24 executable.');
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const present = await access(join(root, name)).then(() => true, () => false);
  assert.equal(present, false, `This verification checkout must not contain ${name}; preserve private environment files.`);
}
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: root, encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const tree = git('rev-parse', 'HEAD^{tree}');
assert.equal(git('status', '--porcelain=v1'), '', 'Commit the converged browser candidate first.');
const directory = join(root, '.browser-artifacts', new Date().toISOString().replaceAll(':', '-'));
const home = join(directory, 'runtime-home');
const profile = join(directory, 'chromium-profile');
await mkdir(home, { recursive: true, mode: 0o700 });
const env = browserEnvironment(process.env, home);
const badgeFixture = await readFile(join(root, 'scripts/fixtures/skills-badge.svg'));
const nodeVersion = execFileSync(node, ['--version'], { env, encoding: 'utf8' }).trim();
assert.match(nodeVersion, /^v24\./u);
const report = { head, tree, dirty: false, nodeVersion, bunVersion: process.versions.bun,
  browserSha256: createHash('sha256').update(await readFile(executablePath)).digest('hex'),
  lockfileSha256: createHash('sha256').update(await readFile(join(root, 'bun.lock'))).digest('hex'),
  buildId: (await readFile(join(root, '.next/BUILD_ID'), 'utf8')).trim(),
  profile, cases: [], passed: false, cleanup: { browser: false, server: false } };
const server = spawn(node, [join(root, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '0'],
  { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
report.serverPid = server.pid;
const serverClosed = new Promise((resolve) => server.once('close', resolve));
let output = '';
const ready = deadline(new Promise((resolve, reject) => {
  const capture = (chunk) => {
    output = (output + chunk.toString()).slice(-8_000);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/u);
    if (match && output.includes('Ready in')) resolve(`http://127.0.0.1:${match[1]}`);
  };
  server.stdout.on('data', capture);
  server.stderr.on('data', capture);
  server.once('error', reject);
  server.once('close', (code) => reject(new Error(`Next exited ${code}: ${output}`)));
}), 'Next startup', 30_000);
const owner = browserOwner({
  launch: () => chromium.launchPersistentContext(profile, { executablePath, env, headless: true,
    args: ['--mute-audio'], timeout: 20_000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }),
  close: async (context) => { await deadline(context.close(), 'Browser cleanup'); report.cleanup.browser = true; },
  stopServer: async () => {
    const alive = () => server.exitCode === null && server.signalCode === null;
    if (alive()) server.kill('SIGTERM');
    const force = setTimeout(() => { if (alive()) server.kill('SIGKILL'); }, 5_000);
    try { await deadline(serverClosed, 'Next cleanup'); report.cleanup.server = true; }
    finally { clearTimeout(force); }
  },
});
let interrupted = false;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  process.once(signal, () => {
    interrupted = true;
    process.exitCode = code;
    void owner.stop().catch(() => { process.exitCode = 1; });
  });
}

try {
  const origin = await ready;
  assert.equal(interrupted, false);
  const persistent = await owner.start();
  const browser = persistent.browser();
  assert.ok(browser);
  report.browserVersion = browser.version();
  const census = await deadline(browser.newBrowserCDPSession(), 'Browser census session');
  report.browserPid = (await deadline(census.send('SystemInfo.getProcessInfo'), 'Browser process census')).processInfo.find((item) => item.type === 'browser')?.id;
  await deadline(census.detach(), 'Browser census detach');
  for (const sample of browserCases()) {
    assert.equal(interrupted, false);
    const context = await deadline(browser.newContext({ viewport: { width: sample.width, height: 900 },
      colorScheme: sample.theme, isMobile: sample.width < 500, hasTouch: sample.width < 500,
      reducedMotion: 'reduce', serviceWorkers: 'block' }), 'Context startup');
    const item = { ...sample, passed: false };
    report.cases.push(item);
    let page;
    const name = `${sample.width}-${sample.theme}-${sample.path.slice(1) || 'home'}`;
    try {
      const unexpected = [];
      const failures = [];
      const assets = new Set();
      item.syntheticAssets = [];
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (isSyntheticBadge({ url: request.url(), method: request.method(), resourceType: request.resourceType() })) {
          item.syntheticAssets.push('Repository fixture: README skills.sh badge (no external request).');
          await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: badgeFixture });
        } else if ((url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) && ['GET', 'HEAD'].includes(request.method())) {
          await route.continue();
        } else {
          unexpected.push({ origin: url.origin, path: url.pathname, method: request.method() });
          await route.abort();
        }
      });
      page = await deadline(context.newPage(), 'Page startup');
      page.setDefaultTimeout(10_000);
      page.setDefaultNavigationTimeout(15_000);
      page.on('pageerror', (error) => failures.push(error.message));
      page.on('requestfailed', (request) => failures.push(`Request failed: ${new URL(request.url()).pathname} ${request.failure()?.errorText}`));
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (response.status() >= 400) failures.push(`${response.status()} ${path}`);
        if (/\.(?:css|woff2|svg)(?:$|\?)/u.test(path)) assets.add(path);
      });
      assert.equal((await page.goto(origin + sample.path, { waitUntil: 'load' })).status(), 200);
      await deadline(page.evaluate(async (landing) => {
        for (const weight of ['400', '500', '600', '700']) await document.fonts.load(`${weight} 16px "Nebula Sans"`, 'Textbutler');
        if (landing) await document.fonts.load('400 48px "Instrument Serif"', 'conversations');
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, sample.path === '/'), 'Font settlement', 15_000);
      const metrics = await deadline(page.evaluate(() => {
        const heading = document.querySelector('h1');
        const style = getComputedStyle(heading);
        const headerInner = document.querySelector('.hraness-marketing-header__inner');
        const field = document.querySelector('.hraness-marketing-field');
        const hero = document.querySelector('.hraness-marketing-hero');
        const summary = document.querySelector('.hraness-marketing-hero__summary');
        const workspace = document.querySelector('.workspace-example pre');
        const frame = document.querySelector('.hraness-marketing-proof-frame');
        const layers = [];
        const visit = (rules) => {
          for (const rule of rules) {
            if (rule.constructor.name === 'CSSLayerBlockRule') layers.push(rule.name);
            if (rule.styleSheet) visit(rule.styleSheet.cssRules);
            else if (rule.cssRules) visit(rule.cssRules);
          }
        };
        for (const sheet of document.styleSheets) visit(sheet.cssRules);
        return { paper: document.documentElement.dataset.hranessTheme,
          background: getComputedStyle(document.body).backgroundColor,
          bodyFont: getComputedStyle(document.body).fontFamily,
          bodyInk: getComputedStyle(document.body).color,
          coarse: matchMedia('(pointer: coarse)').matches,
          overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
          forms: document.querySelectorAll('form,input,textarea').length,
          headers: document.querySelectorAll('.hraness-marketing-header').length,
          footers: document.querySelectorAll('.site-footer').length,
          askAi: document.querySelectorAll('.message-like-me-ask-ai').length,
          preset: document.querySelector('[data-hraness-marketing-preset]')?.getAttribute('data-hraness-marketing-preset') ?? null,
          headingFont: style.fontFamily, headingSize: Number.parseFloat(style.fontSize),
          headingLeading: Number.parseFloat(style.lineHeight), headingWeight: style.fontWeight,
          headingTracking: Number.parseFloat(style.letterSpacing),
          headerMinHeight: headerInner && getComputedStyle(headerInner).minHeight,
          headerWidth: headerInner?.getBoundingClientRect().width,
          gutter: headerInner && getComputedStyle(headerInner).paddingInlineStart,
          heroPadding: hero && [getComputedStyle(hero).paddingBlockStart, getComputedStyle(hero).paddingBlockEnd],
          summarySize: summary && Number.parseFloat(getComputedStyle(summary).fontSize),
          summaryLeading: summary && Number.parseFloat(getComputedStyle(summary).lineHeight),
          workspaceInk: workspace && getComputedStyle(workspace).color,
          workspaceBackground: workspace && getComputedStyle(workspace).backgroundColor,
          frameBackground: frame && getComputedStyle(frame).backgroundColor,
          sections: [...document.querySelectorAll('.textbutler-marketing h2')].map((element) => {
            const style = getComputedStyle(element);
            return { font: style.fontFamily, weight: style.fontWeight, size: Number.parseFloat(style.fontSize),
              leading: Number.parseFloat(style.lineHeight), tracking: Number.parseFloat(style.letterSpacing) };
          }),
          fieldBackground: field && getComputedStyle(field).backgroundImage,
          actionHeights: [...document.querySelectorAll('.hraness-marketing-action')].map((action) => action.getBoundingClientRect().height),
          actionRadii: [...document.querySelectorAll('.hraness-marketing-action')].map((action) => getComputedStyle(action).borderRadius),
          fontWeights: [...document.fonts].filter((font) => font.status === 'loaded' && font.family.includes('Nebula Sans')).map((font) => font.weight),
          layers };
      }), 'Presentation metrics');
      const cdp = await deadline(context.newCDPSession(page), 'Font inspection session');
      await deadline(cdp.send('DOM.enable'), 'Font DOM inspection');
      await deadline(cdp.send('CSS.enable'), 'Font CSS inspection');
      const { root: documentNode } = await deadline(cdp.send('DOM.getDocument'), 'Font document inspection');
      const { nodeId } = await deadline(cdp.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: 'h1' }), 'Font heading inspection');
      metrics.renderedFonts = (await deadline(cdp.send('CSS.getPlatformFontsForNode', { nodeId }), 'Rendered font inspection')).fonts;
      await deadline(cdp.detach(), 'Font inspection detach');
      item.metrics = metrics;
      item.assets = [...assets].sort();
      item.failures = failures;
      assertPresentation(metrics, sample);
      if (sample.path === '/') {
        const summary = page.locator('details summary').first();
        await summary.focus();
        await summary.press('Enter');
        await page.locator('details[open]').first().waitFor({ state: 'visible' });
        await summary.press('Enter');
        assert.equal(await page.locator('details[open]').count(), 0);
        await page.getByRole('link', { name: 'See what’s ready', exact: true }).click();
        await page.waitForURL((url) => url.hash === '#development');
        await page.getByRole('heading', { name: 'Build it. Set it up. Keep control.', exact: true }).waitFor({ state: 'visible' });
        item.interaction = 'Keyboard FAQ opened and closed; development action reached its real section.';
      } else if (sample.path === '/docs') {
        const link = page.locator('.document-prose a[href^="#"]').first();
        const target = await link.getAttribute('href');
        await link.click();
        await page.waitForURL((url) => url.hash === target);
        item.interaction = 'Generated documentation anchor navigated to its source-owned section.';
      }
      if (sample.path !== '/preview') {
        await page.locator('.skip-link').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.activeElement?.id === 'main-content');
        item.skipLink = 'Keyboard skip link focused the main content.';
      }
      await deadline(page.evaluate(() => window.scrollTo(0, 0)), 'Screenshot scroll');
      await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
      assert.deepEqual(unexpected, [], 'The isolated browser must not send external requests or writes.');
      assert.deepEqual(failures, [], 'Browser and asset failures must remain visible.');
      item.passed = true;
      console.log(`PASS ${name}`);
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
      if (page) await page.screenshot({ path: join(directory, `${name}-failed.png`), fullPage: true, timeout: 5_000 }).catch(() => {});
      throw error;
    } finally { await deadline(context.close(), 'Context cleanup', 5_000); }
  }
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('status', '--porcelain=v1'), '');
  assert.equal(interrupted, false);
  report.passed = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (!interrupted) process.exitCode = 1;
} finally {
  try { await owner.stop(); }
  catch (error) { report.cleanup.error = String(error); report.passed = false; process.exitCode = 1; }
  await writeFile(join(directory, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, error: report.error,
    cleanup: report.cleanup, receipt: join(directory, 'receipt.json') }));
}
