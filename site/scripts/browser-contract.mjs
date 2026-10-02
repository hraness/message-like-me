import assert from 'node:assert/strict';
import { constants, readFileSync } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';

const require = createRequire(import.meta.url);
const requiredDisabledFeatures = ['PaintHolding', 'MacAppCodeSignClone'];

function rejectInstalledChrome(path) {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  assert.ok(!/\/google chrome(?: beta| dev| canary)?\.app\//u.test(normalized)
    && !/\/opt\/google\/chrome(?:-beta|-unstable)?\//u.test(normalized)
    && !/\/google\/chrome(?: beta| dev| sxs)?\/application\//u.test(normalized),
  'Owned browser verification must never use system Chrome.');
}

// Browser overrides may name only the browser provisioned by this Playwright
// version. Resolve links before launch so a cache symlink cannot select Chrome.
export async function pinnedBrowserExecutable(pinned, override = pinned) {
  assert.ok(typeof pinned === 'string' && isAbsolute(pinned), 'Playwright must name an absolute browser executable.');
  assert.ok(typeof override === 'string' && isAbsolute(override), 'Browser executable must be an absolute path.');
  rejectInstalledChrome(pinned);
  rejectInstalledChrome(override);
  const revisionPath = /[/\\]((?:chromium|chromium_headless_shell|chrome-headless-shell)-\d+)[/\\]/u;
  const revision = pinned.match(revisionPath)?.[1];
  assert.ok(revision, 'Playwright must name its versioned Chromium installation.');
  const executable = await realpath(pinned);
  rejectInstalledChrome(executable);
  assert.match(executable, revisionPath,
    'Use the Chromium provisioned for this site’s pinned Playwright version, never system Chrome.');
  assert.equal(executable.match(revisionPath)?.[1], revision, 'The provisioned browser must retain Playwright’s pinned revision.');
  const resolvedOverride = await realpath(override);
  rejectInstalledChrome(resolvedOverride);
  assert.equal(resolvedOverride, executable, 'Browser override must resolve to this site’s pinned Chromium.');
  assert.ok((await stat(executable)).isFile(), 'The pinned browser must be a regular file.');
  await access(executable, constants.X_OK);
  return executable;
}

// These are caller requests; launch options merge them with the exact pinned
// Playwright defaults before the browser starts.
export const browserLaunchArgs = ['--mute-audio', '--disable-features=PaintHolding,MacAppCodeSignClone'];

function pinnedChromiumMetadata() {
  const coreRoot = dirname(require.resolve('playwright-core/package.json'));
  const installedVersion = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')).version;
  const consumer = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pinnedVersion = consumer.devDependencies?.['playwright-core'] ?? consumer.dependencies?.['playwright-core'];
  assert.equal(installedVersion, pinnedVersion, 'Install this site’s exact pinned Playwright version before browser verification.');
  const browser = JSON.parse(readFileSync(join(coreRoot, 'browsers.json'), 'utf8')).browsers.find(entry => entry.name === 'chromium');
  assert.equal(typeof browser?.browserVersion, 'string', 'Cannot reconcile pinned Chromium version.');
  return { coreRoot, installedVersion, expectedVersion: browser.browserVersion };
}

export function pinnedChromiumVersion() { return pinnedChromiumMetadata().expectedVersion; }

export function pinnedChromiumDefinition() {
  const { coreRoot, installedVersion, expectedVersion } = pinnedChromiumMetadata();
  assert.equal(installedVersion, '1.62.0', 'Reconcile the authored Playwright pin’s Chromium runtime before browser verification.');
  // Read this version’s own defaults; newer pins must reconcile their runtime.
  const { createPlaywright } = require(join(coreRoot, 'lib/coreBundle.js')).server;
  const formatter = createPlaywright?.({ sdkLanguage: 'javascript' }).chromium;
  assert.equal(typeof formatter?._innerDefaultArgs, 'function', 'Cannot reconcile pinned Playwright Chromium defaults.');
  const defaultArgs = formatter._innerDefaultArgs({ headless: true });
  assert.ok(Array.isArray(defaultArgs) && defaultArgs.every(arg => typeof arg === 'string'), 'Invalid pinned Chromium defaults.');
  return { defaultArgs, expectedVersion };
}

export function ownedChromiumLaunchOptions(executablePath, defaultArgs, args = []) {
  assert.ok(defaultArgs.every(arg => typeof arg === 'string') && args.every(arg => typeof arg === 'string'), 'Browser arguments must be strings.');
  const defaults = defaultArgs.filter(arg => arg.startsWith('--disable-features='));
  assert.equal(defaults.length, 1, 'Cannot reconcile pinned Playwright’s disable-features switch.');
  assert.ok(!args.includes('--disable-features'), 'Use --disable-features=value for Chromium features.');
  const supplied = args.filter(arg => arg.startsWith('--disable-features='));
  const features = [...new Set([...defaults, ...supplied]
    .flatMap(arg => arg.slice('--disable-features='.length).split(','))
    .map(feature => feature.trim()).filter(Boolean).concat(requiredDisabledFeatures))];
  const merged = '--disable-features=' + features.join(',');
  const unchanged = merged === defaults[0];
  return { executablePath, headless: true,
    ignoreDefaultArgs: unchanged ? [] : defaults,
    args: [...args.filter(arg => !arg.startsWith('--disable-features=') && arg !== '--mute-audio'),
      ...(defaultArgs.includes('--mute-audio') ? [] : ['--mute-audio']),
      // Browser.getBrowserCommandLine needs this verification capability.
      ...(defaultArgs.includes('--enable-automation') || args.includes('--enable-automation') ? [] : ['--enable-automation']),
      ...(unchanged ? [] : [merged])] };
}

export async function verifyOwnedChromium(browser, executablePath, expectedVersion) {
  const browserVersion = browser.version();
  assert.equal(browserVersion, expectedVersion, 'Provisioned Chromium version differs from pinned Playwright.');
  const session = await browser.newBrowserCDPSession();
  let args;
  try {
    ({ arguments: args } = await session.send('Browser.getBrowserCommandLine'));
    assert.equal(await realpath(args[0]), executablePath, 'Chromium did not launch the resolved pinned executable.');
    const disabled = args.filter(arg => arg.startsWith('--disable-features='));
    assert.equal(disabled.length, 1, 'Owned Chromium must have one merged disable-features switch.');
    assert.ok(requiredDisabledFeatures.every(feature => disabled[0].slice('--disable-features='.length).split(',').includes(feature)),
      'Owned Chromium is missing required disabled features.');
    assert.equal(args.filter(arg => arg === '--mute-audio').length, 1, 'Owned Chromium must mute audio with one switch.');
  } finally { await session.detach(); }
  return { executable: executablePath, browserVersion, args };
}

export function browserCases() {
  return [1440, 390].flatMap((width) => ['light', 'dark'].flatMap((theme) =>
    ['/', '/docs', '/about', '/preview', '/blog', '/blog/introducing-textbutler'].map((path) => ({ width, theme, path }))));
}

// Pin the synthetic presentation state instead of inheriting host accessibility
// preferences. The browser gate separately exercises the reduced fallback.
export function browserMediaFeatures(theme, transparency = 'no-preference') {
  assert.ok(['light', 'dark'].includes(theme));
  assert.ok(['no-preference', 'reduce'].includes(transparency));
  return [
    { name: 'prefers-color-scheme', value: theme },
    { name: 'prefers-reduced-motion', value: 'reduce' },
    { name: 'forced-colors', value: 'none' },
    { name: 'prefers-reduced-transparency', value: transparency },
  ];
}

// The source-owned README badge is external; this offline gate substitutes only
// its exact image request, never a document, API, script, or another asset.
export function isSyntheticBadge(request) {
  return request.url === 'https://skills.sh/b/hraness/message-like-me'
    && request.method === 'GET' && request.resourceType === 'image';
}

// The shared footer asks this public endpoint whether its consent control is
// required. Offline checks supply a declared response; no account call escapes.
export function isSyntheticConsentRegion(request) {
  return request.url === 'https://account.hraness.com/api/consent/region'
    && request.method === 'GET' && request.resourceType === 'fetch'
    && request.cookie === undefined && request.authorization === undefined
    && request.body === null;
}

export function isPreviewPolicyBlock(request, { path, origin, verifiedCsp, authoredAssets }) {
  if (path !== '/preview' || !verifiedCsp || !request.mainFrame || request.method !== 'GET' || request.error !== 'csp'
    || !authoredAssets.includes(request.url)) return false;
  const url = new URL(request.url);
  if (url.origin !== origin || url.search || url.hash) return false;
  return (request.resourceType === 'script' && (/^\/_next\/static\/chunks\/[\w./-]+\.js$/u.test(url.pathname) || url.pathname === '/theme-bootstrap.js'))
    || (['manifest', 'other'].includes(request.resourceType) && url.pathname === '/manifest.webmanifest');
}

export function assertBuildJoin(before, after, exitCode) {
  assert.equal(before.status, '', 'The browser build must start from a clean source.');
  assert.equal(exitCode, 0, 'The same-invocation browser build failed.');
  assert.deepEqual(after, before, 'Browser build inputs changed while compiling.');
}

export function assertServerExit(exit) {
  assert.equal(exit.stopRequested, true, 'Next exited before owned teardown.');
  assert.equal(exit.forced, false, 'Next required forced termination.');
  // Next 16.2.6 awaits its SIGTERM cleanup, then explicitly exits with 143.
  assert.ok(([0, 143].includes(exit.code) && exit.signal === null) || (exit.code === null && exit.signal === 'SIGTERM'),
    `Unexpected Next exit: ${exit.code}/${exit.signal}`);
}

export function routeTasks(errors) {
  const pending = new Set();
  return {
    get size() { return pending.size; },
    run(operation) {
      const task = Promise.resolve().then(operation).catch((error) => {
        errors.push(`Route handler failed: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => pending.delete(task));
      pending.add(task);
      return task;
    },
    drain() {
      return deadline((async () => {
        while (pending.size > 0) await Promise.all([...pending]);
      })(), 'Route handler settlement');
    },
  };
}

// Every phase runs even after a primary failure. In particular, teardown cannot
// erase an earlier assertion, and no case passes before late events are joined.
export async function finishBrowserCase({ primary, settle, close, drain, check }) {
  const errors = primary ? [primary] : [];
  for (const action of [settle, close, drain, check]) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  if (errors.length > 0) throw new AggregateError(errors,
    errors.map((error) => error instanceof Error ? error.message : String(error)).join('\n'));
}

/** @returns {Record<string, string>} */
export function browserEnvironment(source, home) {
  const keys = ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'NODE_OPTIONS',
    'CIRCLE_NODE_TOTAL', 'GOMAXPROCS', 'RAYON_NUM_THREADS', 'UV_THREADPOOL_SIZE', 'VIPS_CONCURRENCY'];
  return { ...Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])),
    HOME: home, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1' };
}

export function deadline(promise, label, milliseconds = 10_000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
  })]).finally(() => clearTimeout(timer));
}

// Stop closes even a browser acquired after interruption, then always joins Next.
export function browserOwner({ launch, close, stopServer }) {
  let stopped = false;
  let launching;
  let stopping;
  return {
    async start() {
      assert.equal(stopped, false, 'Browser acquisition was interrupted.');
      launching ??= Promise.resolve().then(launch);
      const browser = await launching;
      if (stopped) {
        await stopping;
        throw new Error('Browser acquisition was interrupted.');
      }
      return browser;
    },
    stop() {
      stopped = true;
      stopping ??= (async () => {
        try {
          const browser = await launching?.catch(() => undefined);
          if (browser) await close(browser);
        } finally { await stopServer(); }
      })();
      return stopping;
    },
  };
}

export function assertPresentation(value, sample) {
  assert.equal(value.paper, 'paper');
  assert.equal(value.background, sample.theme === 'light' ? 'rgb(251, 241, 199)' : 'rgb(40, 40, 40)');
  assert.match(value.bodyFont, /Nebula Sans/u);
  assert.equal(value.coarse, sample.width < 500);
  assert.ok(value.overflow <= 1, `Horizontal overflow: ${value.overflow}px`);
  const controls = value.appearanceControls;
  assert.ok(Array.isArray(controls));
  assert.equal(value.forms, controls.length, 'Only finite appearance radios may be present; no data collection fields.');
  assert.equal(controls.length, sample.path === '/preview' ? 0 : 8);
  if (controls.length) {
    const palettes = controls.filter(control => control.legend === 'Theme');
    const modes = controls.filter(control => control.legend === 'Appearance');
    assert.deepEqual(palettes.map(control => control.value).sort(), ['catppuccin', 'gruvbox', 'paper', 'rose-pine', 'tokyo-night']);
    assert.deepEqual(modes.map(control => control.value).sort(), ['dark', 'light', 'system']);
    assert.ok(palettes.every(control => control.name === palettes[0].name));
    assert.ok(modes.every(control => control.name === modes[0].name));
    assert.match(palettes[0].name, /^.+-palette$/u);
    assert.equal(modes[0].name, palettes[0].name.replace(/-palette$/u, '-mode'));
  }
  assert.equal(value.footers, sample.path === '/preview' ? 0 : 1);
  assert.equal(value.headers, sample.path === '/preview' ? 0 : 1);
  assert.equal(value.askAi, sample.path === '/preview' ? 0 : 1);
  assert.ok(value.layers.some((name) => name.startsWith('components.hraness-stylex.priority')), 'Shared compiled recipe union missing.');
  assert.ok(!value.layers.some((name) => /^components\.hraness-(?:ui|design-kit|site-footer)\.priority/u.test(name)), 'Standalone package recipes must not compete with the shared union.');
  for (const weight of ['400', '500', '600', '700']) assert.ok(value.fontWeights.includes(weight), `Nebula Sans ${weight} missing.`);
  assert.equal(value.preset, sample.path === '/' ? 'editorial' : null);
  assert.equal(value.material, 'lantern');
  // The Quiet direction sets every heading, landing included, in Nebula Sans.
  assert.ok(value.renderedFonts.some((font) => font.isCustomFont && font.glyphCount > 0
    && /Nebula/iu.test(font.postScriptName || font.familyName)), 'The heading rendered with a fallback font.');
  if (sample.path === '/') {
    const h1Size = Math.min(64, Math.max(38, 25.6 + sample.width * 0.032));
    assert.ok(Math.abs(value.headingSize - h1Size) < 0.1, `Landing H1 size: ${value.headingSize}px`);
    assert.ok(Math.abs(value.headingLeading - h1Size * 1.06) < 0.1, `Landing H1 leading: ${value.headingLeading}px`);
    assert.ok(Math.abs(value.headingTracking + h1Size * 0.03) < 0.01);
    assert.equal(value.headingWeight, '550');
    assert.match(value.headingFont, /Nebula Sans/u);
    assert.equal(value.headerMinHeight, '52px');
    assert.equal(value.headerWidth, Math.min(1216, sample.width));
    assert.equal(value.gutter, sample.width < 761 ? '20px' : '32px');
    const h2Size = Math.min(40, Math.max(28, 21.6 + sample.width * 0.016));
    assert.equal(value.sections.length, 12, 'All landing section headings, including the three split benefits, must be inspected.');
    for (const section of value.sections) {
      assert.match(section.font, /Nebula Sans/u);
      assert.equal(section.weight, '550');
      assert.ok(Math.abs(section.size - h2Size) < 0.1, `Landing H2 size: ${section.size}px`);
      assert.ok(Math.abs(section.leading - h2Size * 1.12) < 0.1);
      assert.ok(Math.abs(section.tracking + h2Size * 0.02) < 0.01);
    }
    assert.equal(value.workspaceInk, value.bodyInk, 'The Paper file tree must not inherit inverse-surface ink.');
    assert.notEqual(value.workspaceBackground, 'rgba(0, 0, 0, 0)');
    assert.notEqual(value.terminalBackground, 'rgba(0, 0, 0, 0)', 'The terminal proof sits on an opaque surface.');
    assert.ok(value.actionHeights.length >= 4, 'The header, hero and closing actions must all remain styled.');
    assert.ok(value.actionHeights.every((height) => height >= (sample.width < 500 ? 44 : 36)));
    // No backdrop, pattern, wall texture, or translucent header remains.
    assert.equal(value.headerBackdrop, 'none');
    assert.equal(value.wall, false);
    assert.equal(value.bodyBackgroundImage, 'none');
  }
}
