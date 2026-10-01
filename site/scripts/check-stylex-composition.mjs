// Focused real-page regression. Start the already-built site on loopback in a
// compute lane; run this browser-only command in the browser lane.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import stylex from '../stylex.config.mjs';
import { loadPackageUnion } from './stylex-package-union.mjs';
import { inspectHomeLayout } from './check-home-layout.mjs';
import { browserLaunchArgs, ownedChromiumLaunchOptions, pinnedBrowserExecutable, pinnedChromiumDefinition, verifyOwnedChromium } from './browser-contract.mjs';

const [origin, output] = process.argv.slice(2);
assert.equal(new URL(origin).hostname, '127.0.0.1', 'Use an owned loopback preview.');
assert.ok(output && resolve(output) === output, 'Choose an absolute evidence directory.');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const postcss = createRequire(require.resolve('next/package.json'))('postcss');
const union = await loadPackageUnion(root, stylex.packages);
const standalone = (await Promise.all(stylex.packages.map(name => readFile(require.resolve(`${name}/stylex.css`), 'utf8')))).join('\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const buildId = (await readFile(join(root, '.next/BUILD_ID'), 'utf8')).trim();
const executable = await pinnedBrowserExecutable(chromium.executablePath());
const { defaultArgs, expectedVersion } = pinnedChromiumDefinition();
await mkdir(output, { recursive: true });
const report = { kind: 'precompiled-package-composition-browser', buildId, unionSha256: digest(union.css),
  packages: union.manifests.map(item => item.package), cases: [], counterfactual: [], passed: false };
const browser = await chromium.launch(ownedChromiumLaunchOptions(executable, defaultArgs, browserLaunchArgs));
try {
  report.browser = await verifyOwnedChromium(browser, executable, expectedVersion);
  for (const variant of ['standalone-counterfactual', 'union']) {
    const cases = variant === 'union'
      ? [320, 390, 1023, 1024, 1440].flatMap(width => [100, 200].flatMap(textSize => ['light', 'dark'].map(theme => ({ width, textSize, theme }))))
      : [100, 200].map(textSize => ({ width: 1440, textSize, theme: 'light' }));
    for (const sample of cases) {
      const context = await browser.newContext({ viewport: { width: sample.width, height: 1000 }, colorScheme: sample.theme, reducedMotion: 'reduce' });
      const errors = [];
      let replacements = 0;
      try {
        await context.route('**/*', async route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin !== origin) {
            if (url.href === 'https://account.hraness.com/api/consent/region') {
              await route.fulfill({ status: 200, contentType: 'application/json', body: '{"required":true}' });
            } else await route.abort();
            return;
          }
          assert.equal(request.method(), 'GET', 'The fixture only reads the preview.');
          if (variant !== 'standalone-counterfactual' || request.resourceType() !== 'stylesheet') return route.continue();
          const response = await route.fetch();
          const css = await response.text();
          if (!css.includes('components.hraness-stylex')) return route.fulfill({ response });
          const sheet = postcss.parse(css);
          sheet.walkAtRules('layer', rule => {
            if (rule.params.includes('components.hraness-stylex')) rule.remove();
          });
          // Only the test's CSS response changes. This recreates the old package
          // ordering against the same real page, fonts and responsive recipes.
          replacements += 1;
          await route.fulfill({ response, body: `${sheet.toString()}\n${standalone}` });
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin, { waitUntil: 'networkidle' });
        await page.locator('.tb-hero').waitFor();
        await page.locator('.hraness-site-footer').waitFor();
        await page.evaluate(async textSize => {
          document.documentElement.style.fontSize = `${textSize}%`;
          await document.fonts.ready;
          for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(resolve));
        }, sample.textSize);
        const state = await page.evaluate(() => {
          const hero = document.querySelector('.tb-hero');
          const bounds = selector => {
            const { x, y, right, bottom, width, height } = hero.querySelector(selector).getBoundingClientRect();
            return { x, y, right, bottom, width, height };
          };
          return { columns: getComputedStyle(hero).gridTemplateColumns,
            wide: matchMedia('(min-width: 64rem)').matches,
            copy: bounds('.hraness-marketing-hero__copy'), frame: bounds('.hraness-marketing-hero__frame') };
        });
        const sideBySide = state.frame.x >= state.copy.right - 1 && state.frame.y < state.copy.bottom && state.copy.y < state.frame.bottom;
        assert.deepEqual(errors, [], 'The actual homepage must render without uncaught errors.');
        if (variant === 'standalone-counterfactual') {
          assert.equal(replacements, 1, 'Replace exactly the delivered union stylesheet.');
          assert.equal(sideBySide, false, 'Old package-sheet layering must reproduce the desktop failure.');
          report.counterfactual.push({ ...sample, ...state, replacements });
        } else {
          assert.ok(state.copy.width > 0 && state.frame.width > 0, 'Both hero columns have usable width.');
          if (state.wide) assert.equal(sideBySide, true, 'The shared breakpoint places the phone beside the copy.');
          else assert.ok(state.frame.y >= state.copy.bottom - 1, 'The phone follows the copy below the shared breakpoint.');
          assert.ok(state.copy.x >= -1 && state.copy.right <= sample.width + 1 && state.frame.x >= -1 && state.frame.right <= sample.width + 1, 'Hero tracks stay within the viewport.');
          const homeLayout = await inspectHomeLayout(page, { enforceDesktopColumns: sample.textSize === 100 });
          report.cases.push({ ...sample, ...state, homeLayout });
        }
        if ([390, 1440].includes(sample.width)) {
          await page.screenshot({ path: join(output, `${variant}-${sample.width}-${sample.textSize}-${sample.theme}.png`), fullPage: false });
        }
      } finally { await context.close(); }
    }
  }
  assert.equal((await readFile(join(root, '.next/BUILD_ID'), 'utf8')).trim(), buildId, 'The inspected build must not change.');
  report.passed = true;
} finally {
  await browser.close();
  await writeFile(join(output, 'composition.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, cases: report.cases.length, counterfactual: report.counterfactual.length, evidence: join(output, 'composition.json') }));
