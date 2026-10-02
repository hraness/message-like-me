import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Browser } from 'playwright-core';
import { assertBuildJoin, assertPresentation, assertServerExit, browserCases, browserEnvironment, browserMediaFeatures, browserOwner,
  browserLaunchArgs, deadline, finishBrowserCase, isPreviewPolicyBlock, isSyntheticBadge, isSyntheticConsentRegion,
  ownedChromiumLaunchOptions, pinnedBrowserExecutable, routeTasks, verifyOwnedChromium } from './browser-contract.mjs';

test('browser selection admits only the provisioned version and rejects system Chrome through overrides or cache links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'textbutler-browser-selection-'));
  const pinned = join(root, 'chromium-1234', 'chrome');
  const other = join(root, 'chromium-5678', 'chrome');
  const system = join(root, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
  try {
    for (const executable of [pinned, other, system]) {
      await mkdir(dirname(executable), { recursive: true });
      await writeFile(executable, 'synthetic browser fixture', { mode: 0o755 });
    }
    const alias = join(root, 'pinned-browser');
    await symlink(pinned, alias);
    expect(await pinnedBrowserExecutable(pinned)).toBe(await realpath(pinned));
    expect(await pinnedBrowserExecutable(pinned, alias)).toBe(await realpath(pinned));
    await expect(pinnedBrowserExecutable(pinned, other)).rejects.toThrow('must resolve to this site’s pinned Chromium');
    await expect(pinnedBrowserExecutable(pinned, system)).rejects.toThrow('never use system Chrome');
    await expect(pinnedBrowserExecutable(pinned, 'chrome')).rejects.toThrow('absolute path');
    await rm(pinned);
    await symlink(other, pinned);
    await expect(pinnedBrowserExecutable(pinned)).rejects.toThrow('pinned revision');
    await rm(pinned);
    await symlink(system, pinned);
    await expect(pinnedBrowserExecutable(pinned)).rejects.toThrow('never use system Chrome');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('owned browser launch preserves pinned defaults and caller arguments with one merged feature switch', () => {
  const defaults = ['--no-first-run', '--disable-features=DefaultA,DefaultB', '--headless'];
  const featureSets = [[], ['Custom'], ['PaintHolding'], ['MacAppCodeSignClone', 'Custom'], ['Custom', 'Custom', 'PaintHolding']];
  for (const features of featureSets) for (const muted of [false, true]) {
    const args = [...browserLaunchArgs, ...features.map(feature => '--disable-features=' + feature),
      ...(muted ? ['--mute-audio'] : []), '--blink-settings=pointer'];
    const options = ownedChromiumLaunchOptions('/fixture', defaults, args);
    const physical = [...defaults.filter(arg => !options.ignoreDefaultArgs.includes(arg)), ...options.args];
    const disabled = physical.filter(arg => arg.startsWith('--disable-features='));
    expect(disabled).toHaveLength(1);
    expect(new Set(disabled[0]!.split('=')[1]!.split(','))).toEqual(new Set(['DefaultA', 'DefaultB', ...features, 'PaintHolding', 'MacAppCodeSignClone']));
    expect(physical.filter(arg => arg === '--mute-audio')).toHaveLength(1);
    expect(physical.filter(arg => arg === '--enable-automation')).toHaveLength(1);
    for (const preserved of ['--no-first-run', '--headless', '--blink-settings=pointer']) expect(physical).toContain(preserved);
  }
});

test('command-line verification capability is added only when the defaults and caller omit it', () => {
  for (const inDefaults of [false, true]) for (const inCaller of [false, true]) {
    const defaults = ['--disable-features=DefaultA', ...(inDefaults ? ['--enable-automation'] : [])];
    const options = ownedChromiumLaunchOptions('/fixture', defaults, inCaller ? ['--enable-automation'] : []);
    const physical = [...defaults.filter(arg => !options.ignoreDefaultArgs.includes(arg)), ...options.args];
    expect(physical.filter(arg => arg === '--enable-automation')).toHaveLength(inDefaults && inCaller ? 2 : 1);
    expect(options.args.filter(arg => arg === '--enable-automation')).toHaveLength(inDefaults && !inCaller ? 0 : 1);
  }
  const complete = ['--mute-audio', '--enable-automation', '--disable-features=DefaultA,PaintHolding,MacAppCodeSignClone'];
  expect(ownedChromiumLaunchOptions('/fixture', complete, ['--mute-audio']).ignoreDefaultArgs).toEqual([]);
  expect(ownedChromiumLaunchOptions('/fixture', complete, ['--mute-audio']).args).toEqual([]);
});

test('ambiguous pinned or bare caller feature switches fail before browser launch', () => {
  expect(() => ownedChromiumLaunchOptions('/fixture', [])).toThrow('disable-features');
  expect(() => ownedChromiumLaunchOptions('/fixture', ['--disable-features=A', '--disable-features=B'])).toThrow('disable-features');
  expect(() => ownedChromiumLaunchOptions('/fixture', ['--disable-features=A'], ['--disable-features', 'Custom'])).toThrow('value');
});

test('runtime verification records physical browser identity and argv and rejects missing safeguards', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'textbutler-browser-proof-')));
  const pinned = join(root, 'chrome');
  const other = join(root, 'other-chrome');
  await writeFile(pinned, 'synthetic browser fixture');
  await writeFile(other, 'other synthetic browser fixture');
  const flags = ['--enable-automation', '--mute-audio', '--disable-features=PaintHolding,MacAppCodeSignClone'];
  let detached = 0;
  const verify = async (args: string[], version = '123.0', executable = pinned) => {
    const browser = { version: () => version, newBrowserCDPSession: async () => ({
      send: async (command: string) => {
        expect(command).toBe('Browser.getBrowserCommandLine');
        if (!args.includes('--enable-automation')) throw new Error('Browser.getBrowserCommandLine requires --enable-automation.');
        return { arguments: [executable, ...args] };
      },
      detach: async () => { detached++; },
    }) } as unknown as Pick<Browser, 'version' | 'newBrowserCDPSession'>;
    return verifyOwnedChromium(browser, pinned, '123.0');
  };
  try {
    expect(await verify(flags)).toEqual({ executable: pinned, browserVersion: '123.0', args: [pinned, ...flags] });
    await expect(verify(flags, '456.0')).rejects.toThrow('version');
    await expect(verify(flags, '123.0', other)).rejects.toThrow('resolved pinned executable');
    await expect(verify(flags.filter(arg => arg !== '--enable-automation'))).rejects.toThrow('--enable-automation');
    await expect(verify(['--enable-automation', '--mute-audio', '--disable-features=PaintHolding', '--disable-features=MacAppCodeSignClone'])).rejects.toThrow('one merged');
    await expect(verify(['--enable-automation', '--mute-audio', '--disable-features=PaintHolding'])).rejects.toThrow('missing required');
    await expect(verify(flags.filter(arg => arg !== '--mute-audio'))).rejects.toThrow('mute audio');
    await expect(verify([...flags, '--mute-audio'])).rejects.toThrow('one switch');
    expect(detached).toBe(7);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the native matrix covers six separate surfaces, both themes and touch', () => {
  const cases = browserCases();
  expect(cases).toHaveLength(24);
  expect(new Set(cases.map((item) => `${item.width}/${item.theme}${item.path}`)).size).toBe(24);
});

test('media fixtures isolate host transparency while preserving theme and reduced motion', () => {
  for (const theme of ['light', 'dark']) {
    const baseline = browserMediaFeatures(theme);
    expect(baseline).toEqual([
      { name: 'prefers-color-scheme', value: theme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'forced-colors', value: 'none' },
      { name: 'prefers-reduced-transparency', value: 'no-preference' },
    ]);
    expect(browserMediaFeatures(theme, 'reduce')).toEqual([
      ...baseline.slice(0, -1), { name: 'prefers-reduced-transparency', value: 'reduce' },
    ]);
  }
  expect(() => browserMediaFeatures('unknown')).toThrow();
  expect(() => browserMediaFeatures('light', 'unknown')).toThrow();
});

test('browser children receive no inherited credentials or personal home', () => {
  const env = browserEnvironment({ PATH: '/bin', HOME: '/personal', PROVIDER_TOKEN: 'synthetic',
    ANTHROPIC_API_KEY: 'synthetic', NODE_OPTIONS: '--max-old-space-size=2048', UV_THREADPOOL_SIZE: '3' }, '/fixture');
  expect(env).toEqual({ PATH: '/bin', HOME: '/fixture', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--max-old-space-size=2048', UV_THREADPOOL_SIZE: '3' });
});

test('only the exact external README image receives a recorded synthetic fixture', () => {
  const valid = { url: 'https://skills.sh/b/hraness/message-like-me', method: 'GET', resourceType: 'image' };
  expect(isSyntheticBadge(valid)).toBe(true);
  for (const change of [{ method: 'POST' }, { method: 'HEAD' }, { resourceType: 'document' },
    { resourceType: 'fetch' }, { url: valid.url + '?other=1' }, { url: valid.url + '/other' },
    { url: valid.url.replace('skills.sh', 'example.com') }]) {
    expect(isSyntheticBadge({ ...valid, ...change })).toBe(false);
  }
});

test('only the credential-free public consent GET receives a synthetic response', () => {
  const valid = { url: 'https://account.hraness.com/api/consent/region', method: 'GET', resourceType: 'fetch',
    cookie: undefined, authorization: undefined, body: null };
  expect(isSyntheticConsentRegion(valid)).toBe(true);
  for (const change of [{ method: 'POST' }, { method: 'HEAD' }, { resourceType: 'document' },
    { resourceType: 'image' }, { cookie: 'synthetic' }, { authorization: 'synthetic' }, { body: '' },
    { url: valid.url + '?other=1' }, { url: valid.url + '/other' },
    { url: valid.url.replace('account.hraness.com', 'example.com') }]) {
    expect(isSyntheticConsentRegion({ ...valid, ...change })).toBe(false);
  }
});

test('only preview script and manifest blocks from the verified restrictive CSP are expected', () => {
  const origin = 'http://127.0.0.1:3210';
  const policy = { path: '/preview', origin, verifiedCsp: true,
    authoredAssets: [origin + '/_next/static/chunks/app/page-123.js', origin + '/manifest.webmanifest', origin + '/theme-bootstrap.js'] };
  const valid = { url: policy.authoredAssets[0]!, method: 'GET', resourceType: 'script', error: 'csp', mainFrame: true };
  expect(isPreviewPolicyBlock(valid, policy)).toBe(true);
  expect(isPreviewPolicyBlock({ ...valid, url: origin + '/theme-bootstrap.js' }, policy)).toBe(true);
  expect(isPreviewPolicyBlock({ ...valid, resourceType: 'manifest', url: policy.origin + '/manifest.webmanifest' }, policy)).toBe(true);
  expect(isPreviewPolicyBlock({ ...valid, resourceType: 'other', url: policy.origin + '/manifest.webmanifest' }, policy)).toBe(true);
  for (const change of [{ method: 'POST' }, { error: 'net::ERR_ABORTED' }, { error: 'net::ERR_FAILED' }, { mainFrame: false },
    { resourceType: 'stylesheet' }, { resourceType: 'fetch' }, { resourceType: 'document' }, { resourceType: 'other' },
    { url: valid.url + '?other=1' }, { url: origin + '/_next/static/chunks/unknown.js' },
    { url: policy.origin + '/script.js' }, { url: 'https://example.com/_next/static/chunks/a.js' },
    { resourceType: 'image', url: policy.origin + '/icon.png' }]) {
    expect(isPreviewPolicyBlock({ ...valid, ...change }, policy)).toBe(false);
  }
  expect(isPreviewPolicyBlock(valid, { ...policy, verifiedCsp: false })).toBe(false);
  expect(isPreviewPolicyBlock(valid, { ...policy, path: '/' })).toBe(false);
});

test('a successful browser build must join the exact clean source and lockfile', () => {
  const source = { head: 'a', tree: 'b', status: '', lock: 'c', manifest: 'd' };
  expect(() => assertBuildJoin(source, { ...source }, 0)).not.toThrow();
  for (const change of [{ head: 'old' }, { tree: 'old' }, { status: ' M app/page.tsx' }, { lock: 'old' }, { manifest: 'old' }]) {
    expect(() => assertBuildJoin(source, { ...source, ...change }, 0)).toThrow();
  }
  expect(() => assertBuildJoin(source, source, 1)).toThrow();
  expect(() => assertBuildJoin({ ...source, status: 'dirty' }, { ...source, status: 'dirty' }, 0)).toThrow();
});

test('server cleanup rejects spontaneous, failing and forced exits', () => {
  const valid = { code: 0, signal: null, stopRequested: true, forced: false };
  expect(() => assertServerExit(valid)).not.toThrow();
  expect(() => assertServerExit({ ...valid, code: 143 })).not.toThrow();
  expect(() => assertServerExit({ ...valid, code: null, signal: 'SIGTERM' })).not.toThrow();
  for (const change of [{ stopRequested: false }, { stopRequested: false, code: 143 }, { code: 1 }, { forced: true }, { code: null, signal: 'SIGKILL' }]) {
    expect(() => assertServerExit({ ...valid, ...change })).toThrow();
  }
});

test('late route failures are joined after close and cannot mark a case passed', async () => {
  const failures: string[] = [];
  const tasks = routeTasks(failures);
  let reject!: (reason: Error) => void;
  const pending = new Promise<void>((_, fail) => { reject = fail; });
  void tasks.run(() => pending);
  const events: string[] = [];
  await expect(finishBrowserCase({ primary: undefined, settle: async () => { events.push('settle'); },
    close: async () => { events.push('close'); reject(new Error('late failure')); },
    drain: () => tasks.drain(), check: () => {
      events.push('check');
      if (failures.length) throw new Error(failures.join('\n'));
    } })).rejects.toThrow('late failure');
  expect(tasks.size).toBe(0);
  expect(events).toEqual(['settle', 'close', 'check']);
});

test('case failure preserves primary, settlement, teardown and late errors together', async () => {
  const fail = (message: string) => async () => { throw new Error(message); };
  try {
    await finishBrowserCase({ primary: new Error('primary'), settle: fail('settlement'), close: fail('cleanup'),
      drain: fail('route drain'), check: fail('late request') });
    throw new Error('Expected case rejection.');
  } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(5);
    expect((error as Error).message).toBe('primary\nsettlement\ncleanup\nroute drain\nlate request');
  }
});

test('the owner joins a late acquisition during interruption and closes once', async () => {
  const events: string[] = [];
  let resolve!: (value: object) => void;
  const pending = new Promise<object>((done) => { resolve = done; });
  const owner = browserOwner({ launch: () => pending, close: async () => { events.push('browser'); },
    stopServer: async () => { events.push('server'); } });
  const started = owner.start();
  const stopped = owner.stop();
  resolve({});
  await expect(started).rejects.toThrow('interrupted');
  await stopped;
  await owner.stop();
  expect(events).toEqual(['browser', 'server']);
  await expect(owner.start()).rejects.toThrow('interrupted');
});

test('failed browser cleanup still closes the server and stays failed', async () => {
  let closed = false;
  const owner = browserOwner({ launch: async () => ({}), close: async () => { throw new Error('close failed'); },
    stopServer: async () => { closed = true; } });
  await owner.start();
  await expect(owner.stop()).rejects.toThrow('close failed');
  expect(closed).toBe(true);
  await expect(owner.stop()).rejects.toThrow('close failed');
});

test('browser waits have a bounded deadline', async () => {
  await expect(deadline(new Promise(() => {}), 'fixture', 1)).rejects.toThrow('fixture exceeded 1ms');
});

test('presentation admission rejects missing atoms, fallback fonts, collection and preset leaks', () => {
  const sample = { width: 1440, theme: 'light', path: '/' };
  const valid = { paper: 'paper', background: 'rgb(251, 241, 199)', bodyFont: '"Nebula Sans", sans-serif', coarse: false, overflow: 0,
    forms: 8, appearanceControls: [...['catppuccin','gruvbox','rose-pine','tokyo-night','paper'].map(value => ({name:'fixture-palette',value,legend:'Theme'})), ...['light','dark','system'].map(value => ({name:'fixture-mode',value,legend:'Appearance'}))], headers: 1, footers: 1, askAi: 1, preset: 'editorial', material: 'lantern', headerBackdrop: 'none',
    layers: ['components.hraness-stylex.priority1'],
    fontWeights: ['400', '500', '600', '700'], renderedFonts: [{ isCustomFont: true, glyphCount: 9, postScriptName: 'NebulaSans-Medium' }],
    headingFont: '"Nebula Sans", sans-serif', headingSize: 64, headingLeading: 67.84, headingTracking: -1.92, headingWeight: '550', headerMinHeight: '52px',
    headerWidth: 1216, gutter: '32px',
    sections: Array.from({ length: 12 }, () => ({ font: '"Nebula Sans", sans-serif', weight: '550', size: 40, leading: 44.8, tracking: -0.8 })),
    workspaceInk: 'rgb(28, 25, 23)', bodyInk: 'rgb(28, 25, 23)',
    workspaceBackground: 'rgb(255, 253, 249)', terminalBackground: 'rgb(255, 253, 249)',
    actionHeights: [42, 42, 42, 42], wall: false, bodyBackgroundImage: 'none' };
  expect(() => assertPresentation(valid, sample)).not.toThrow();
  for (const family of ['ui', 'design-kit', 'site-footer']) {
    const standalone = `components.hraness-${family}.priority1`;
    expect(() => assertPresentation({ ...valid, layers: [standalone] }, sample)).toThrow('Shared compiled recipe union missing');
    expect(() => assertPresentation({ ...valid, layers: [...valid.layers, standalone] }, sample)).toThrow('Standalone package recipes');
  }
  for (const path of ['/docs', '/about', '/preview', '/blog', '/blog/introducing-textbutler']) {
    const preview = path === '/preview';
    const document = { ...valid, preset: null, renderedFonts: [{ isCustomFont: true, glyphCount: 9, postScriptName: 'NebulaSans-Medium' }],
      forms: preview ? 0 : 8, appearanceControls: preview ? [] : valid.appearanceControls, headers: preview ? 0 : 1, footers: preview ? 0 : 1, askAi: preview ? 0 : 1 };
    expect(() => assertPresentation(document, { ...sample, path })).not.toThrow();
    expect(() => assertPresentation({ ...document, material: null }, { ...sample, path })).toThrow();
  }
  for (const change of [{ layers: [] }, { renderedFonts: [] }, { fontWeights: [] }, { forms: 9 }, { appearanceControls: [] }, { appearanceControls: valid.appearanceControls.map((control, index) => index === 0 ? {...control, value: 'email'} : control) },
    { appearanceControls: valid.appearanceControls.map((control, index) => index === 0 ? {...control, name: 'contact'} : control) },
    { appearanceControls: valid.appearanceControls.map((control, index) => index === 0 ? {...control, legend: 'Private data'} : control) },
    { material: null }, { headerBackdrop: 'blur(20px) saturate(1.1)' }, { wall: true }, { bodyBackgroundImage: 'url("/grain.svg")' },
    { renderedFonts: [{ isCustomFont: true, glyphCount: 9, postScriptName: 'InstrumentSerif-Regular' }] },
    { headingWeight: '400' }, { headingFont: '"Instrument Serif", serif' }, { terminalBackground: 'rgba(0, 0, 0, 0)' },
    { preset: null }, { headingSize: 68 }, { headerMinHeight: '56px' }, { actionHeights: [32, 42, 42, 42] }, { actionHeights: [42, 42, 42] },
    { sections: [] }, { workspaceInk: 'rgb(248, 247, 244)' }, { gutter: '20px' }, { headerWidth: 1120 }]) {
    expect(() => assertPresentation({ ...valid, ...change }, sample)).toThrow();
  }
});
