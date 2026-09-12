import assert from 'node:assert/strict';

export function browserCases() {
  return [1440, 390].flatMap((width) => ['light', 'dark'].flatMap((theme) =>
    ['/', '/docs', '/sources', '/preview'].map((path) => ({ width, theme, path }))));
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
  assert.equal(value.background, sample.theme === 'light' ? 'rgb(248, 247, 244)' : 'rgb(18, 16, 15)');
  assert.match(value.bodyFont, /Nebula Sans/u);
  assert.equal(value.coarse, sample.width < 500);
  assert.ok(value.overflow <= 1, `Horizontal overflow: ${value.overflow}px`);
  assert.equal(value.forms, 0, 'The informational site must not collect private data.');
  assert.equal(value.footers, sample.path === '/preview' ? 0 : 1);
  assert.equal(value.headers, sample.path === '/preview' ? 0 : 1);
  assert.equal(value.askAi, sample.path === '/preview' ? 0 : 1);
  for (const family of ['hraness-ui', 'hraness-design-kit']) {
    assert.ok(value.layers.some((name) => name.startsWith(`components.${family}.priority`)), `${family} compiled layers missing.`);
  }
  for (const weight of ['400', '500', '600', '700']) assert.ok(value.fontWeights.includes(weight), `Nebula Sans ${weight} missing.`);
  assert.equal(value.preset, sample.path === '/' ? 'editorial' : null);
  const expectedFont = sample.path === '/' ? /InstrumentSerif/iu : /Nebula/iu;
  assert.ok(value.renderedFonts.some((font) => font.isCustomFont && font.glyphCount > 0
    && expectedFont.test(font.postScriptName || font.familyName)), 'The heading rendered with a fallback font.');
  if (sample.path === '/') {
    const h1Size = Math.min(64, Math.max(44, sample.width * 0.051));
    assert.ok(Math.abs(value.headingSize - h1Size) < 0.1, `Editorial H1 size: ${value.headingSize}px`);
    assert.ok(Math.abs(value.headingLeading - h1Size * 1.06) < 0.1, `Editorial H1 leading: ${value.headingLeading}px`);
    assert.equal(value.headingWeight, '400');
    assert.equal(value.headerMinHeight, '72px');
    assert.ok(value.actionHeights.length >= 5, 'The header, hero and closing actions must all remain styled.');
    assert.ok(value.actionHeights.every((height) => height >= (sample.width < 500 ? 44 : 42)));
    assert.ok(value.actionRadii.every((radius) => radius === '4px'));
    assert.match(value.fieldBackground, /linear-gradient/);
  }
}
