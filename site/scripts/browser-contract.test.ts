import { expect, test } from 'bun:test';
import { assertPresentation, browserCases, browserEnvironment, browserOwner, deadline } from './browser-contract.mjs';

test('the native matrix covers four separate surfaces, both themes and touch', () => {
  const cases = browserCases();
  expect(cases).toHaveLength(16);
  expect(new Set(cases.map((item) => `${item.width}/${item.theme}${item.path}`)).size).toBe(16);
});

test('browser children receive no inherited credentials or personal home', () => {
  const env = browserEnvironment({ PATH: '/bin', HOME: '/personal', PROVIDER_TOKEN: 'synthetic',
    ANTHROPIC_API_KEY: 'synthetic', NODE_OPTIONS: '--max-old-space-size=2048', UV_THREADPOOL_SIZE: '3' }, '/fixture');
  expect(env).toEqual({ PATH: '/bin', HOME: '/fixture', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    NODE_OPTIONS: '--max-old-space-size=2048', UV_THREADPOOL_SIZE: '3' });
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
  const valid = { paper: 'paper', background: 'rgb(248, 247, 244)', bodyFont: '"Nebula Sans", sans-serif', coarse: false, overflow: 0,
    forms: 0, headers: 1, footers: 1, askAi: 1, preset: 'editorial',
    layers: ['components.hraness-ui.priority1', 'components.hraness-design-kit.priority1'],
    fontWeights: ['400', '500', '600', '700'], renderedFonts: [{ isCustomFont: true, glyphCount: 9, postScriptName: 'InstrumentSerif-Regular' }],
    headingSize: 64, headingLeading: 67.84, headingWeight: '400', headerMinHeight: '72px',
    actionHeights: [42, 42, 42, 42, 42], actionRadii: ['4px'], fieldBackground: 'linear-gradient(red, blue)' };
  expect(() => assertPresentation(valid, sample)).not.toThrow();
  for (const change of [{ layers: [] }, { renderedFonts: [] }, { fontWeights: [] }, { forms: 1 },
    { preset: null }, { headingSize: 68 }, { headerMinHeight: '56px' }, { actionRadii: ['10px'] }]) {
    expect(() => assertPresentation({ ...valid, ...change }, sample)).toThrow();
  }
});
