import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Playwright has no public default-argv accessor. Bind this one-switch replacement
// to the installed, pinned version and verify its original literal before launch.
const defaultFeatures = [
  'AvoidUnnecessaryBeforeUnloadCheckSync', 'BoundaryEventDispatchTracksNodeRemoval',
  'DestroyProfileOnBrowserClose', 'DialMediaRouteProvider', 'GlobalMediaControls',
  'HttpsUpgrades', 'LensOverlay', 'MediaRouter', 'PaintHolding',
  'ThirdPartyStoragePartitioning', 'BlockOriginHeaderModificationOnRedirect',
  'Translate', 'AutoDeElevate', 'OptimizationHints', 'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
];
const originalSwitch = '--disable-features=' + defaultFeatures.join(',');
const mergedFeatures = [...new Set([...defaultFeatures, 'PaintHolding', 'MacAppCodeSignClone'])];
const mergedSwitch = '--disable-features=' + mergedFeatures.join(',');

export async function productionBrowserLaunchOptions() {
  const manifest = JSON.parse(await readFile(require.resolve('playwright-core/package.json'), 'utf8'));
  assert.equal(manifest.version, '1.62.0', 'Review browser default arguments when updating Playwright.');
  const source = await readFile(require.resolve('playwright-core/lib/coreBundle'), 'utf8');
  const section = source.split('// packages/playwright-core/src/server/chromium/chromiumSwitches.ts');
  assert.equal(section.length, 2, 'The pinned Chromium defaults must have one source section.');
  const literal = section[1].match(/disabledFeatures = (\[[\s\S]*?\])\.filter\(Boolean\);/u);
  assert.ok(literal, 'The pinned Chromium disabled features must retain their literal form.');
  const installedFeatures = JSON.parse(literal[1].replace(/\/\/[^\n]*/gu, ''));
  assert.deepEqual(installedFeatures, defaultFeatures, 'Preserve every pinned Playwright disabled feature.');
  // Required by Browser.getBrowserCommandLine for the post-launch argv receipt.
  return { ignoreDefaultArgs: [originalSwitch], args: ['--mute-audio', '--enable-automation', mergedSwitch] };
}

export async function verifyProductionBrowserLaunch(browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const { arguments: argv } = await session.send('Browser.getBrowserCommandLine');
    const switches = argv.filter(argument => argument.startsWith('--disable-features='));
    assert.deepEqual(switches, [mergedSwitch], 'The actual browser must receive one merged disabled-features switch.');
    assert.ok(argv.includes('--mute-audio'), 'The owned browser must remain muted.');
    return { disabledFeatures: mergedFeatures, disabledFeatureSwitches: switches.length, muteAudio: true };
  } finally { await session.detach(); }
}
