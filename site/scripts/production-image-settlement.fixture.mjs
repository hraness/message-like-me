import assert from 'node:assert/strict';
import process from 'node:process';
import { chromium } from 'playwright-core';
import { settleProductionConsent, settleProductionImages } from './production-image-settlement.mjs';
import { productionBrowserLaunchOptions, verifyProductionBrowserLaunch } from './production-browser-launch.mjs';

assert.ok(process.env.PRODUCTION_BROWSER_EXECUTABLE, 'Use the pinned temporary-profile Chromium fixture.');
const browser = await chromium.launch({ executablePath: process.env.PRODUCTION_BROWSER_EXECUTABLE,
  headless: true, timeout: 20_000, ...await productionBrowserLaunchOptions() });
try {
  const launch = await verifyProductionBrowserLaunch(browser);
  assert.equal(launch.disabledFeatureSwitches, 1);
  const context = await browser.newContext({ viewport: { width: 360, height: 300 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    await context.route('https://image-fixture.invalid/**', async route => {
      if (route.request().url().endsWith('/broken.svg')) return route.fulfill({ status: 404, body: 'missing fixture image' });
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2020"><rect width="800" height="2020" fill="blue"/></svg>' });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(20_000);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1056"></svg>';
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}img{width:300px;height:auto}header,footer{height:40px}.spacer{height:5500px}</style><header>fixture</header><main><div class="spacer"></div><picture><source media="(max-width:500px)" srcset="https://image-fixture.invalid/narrow.svg"><img loading="lazy" width="2400" height="1056" src="data:image/svg+xml,${encodeURIComponent(svg)}"></picture></main><footer>fixture</footer>`);
    const unloaded = await page.locator('img').evaluate(image => ({ complete: image.complete,
      naturalWidth: image.naturalWidth, height: image.getBoundingClientRect().height }));
    assert.equal(unloaded.naturalWidth, 0, 'The below-fold art-directed picture must be lazy at the first baseline.');
    const settlement = await settleProductionImages(page, 'lazy-ratio-regression');
    const loaded = await page.locator('img').evaluate(image => ({ complete: image.complete,
      naturalWidth: image.naturalWidth, height: image.getBoundingClientRect().height }));
    assert.equal(loaded.complete, true);
    assert.equal(loaded.naturalWidth, 800);
    assert.ok(loaded.height > unloaded.height + 600, 'The fixture reproduces the pre-decode picture ratio shift.');
    assert.ok(settlement.some(tile => tile.images.some(image => image.after.currentSrc.endsWith('/narrow.svg'))));
    const measure = () => page.evaluate(() => ({ main: document.querySelector('main').getBoundingClientRect().toJSON(),
      footer: document.querySelector('footer').getBoundingClientRect().toJSON(),
      coarse: matchMedia('(pointer: coarse)').matches, width: innerWidth, height: innerHeight }));
    const before = await measure();
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let offset = 0; offset < pageHeight; offset += 240) {
      await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), offset);
      const capture = await page.screenshot({ animations: 'disabled' });
      assert.equal(capture.readUInt32BE(16), 360);
      assert.equal(capture.readUInt32BE(20), 300);
      assert.equal(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    assert.deepEqual(await measure(), before, 'Capture preserves the settled geometry and phone media.');
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><img width="100" height="100" src="https://image-fixture.invalid/broken.svg">');
    await assert.rejects(settleProductionImages(page, 'broken-image'), /decode|decoded/u,
      'A visible broken image cannot be admitted as settled.');
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><div style="height:50000px">bounded fixture</div>');
    await assert.rejects(settleProductionImages(page, 'oversize'), /bounded image-settlement count/u,
      'The existing finite capture bound also applies before the geometry baseline.');
    for (const state of ['required', 'clear', 'declined']) {
      await page.setContent('<style>[hidden]{display:none}footer{height:40px}footer:has([data-consent-state="required"]){height:90px}</style><footer><div data-slot="hraness-cookie-consent" hidden>notice</div></footer>');
      const beforeConsent = await page.locator('footer').evaluate(element => element.getBoundingClientRect().height);
      // Schedule hydration and its region result independently of the waiter.
      await page.evaluate(terminal => {
        const notice = document.querySelector('[data-slot="hraness-cookie-consent"]');
        setTimeout(() => notice.setAttribute('data-consent-state', 'checking'), 75);
        setTimeout(() => { notice.setAttribute('data-consent-state', terminal); notice.hidden = false; }, 200);
      }, state);
      const [settled] = await settleProductionConsent(page);
      assert.equal(settled.state, state);
      assert.equal(settled.hidden, false);
      const afterConsent = await page.locator('footer').evaluate(element => element.getBoundingClientRect().height);
      assert.equal(afterConsent - beforeConsent, state === 'required' ? 50 : 0);
      await page.screenshot({ animations: 'disabled' });
      assert.equal(await page.locator('footer').evaluate(element => element.getBoundingClientRect().height), afterConsent);
    }
    for (const markup of ['', '<div data-slot="hraness-cookie-consent" data-consent-state="checking"></div>', '<div data-slot="hraness-cookie-consent" data-consent-state="unknown"></div>']) {
      await page.setContent(markup);
      await assert.rejects(settleProductionConsent(page, { timeout: 150 }), /Timeout/u,
        'Missing, checking, or unrecognized consent cannot become a geometry baseline.');
    }
    console.log('production settlement: image and consent readiness, capture preservation, missing/broken/unknown state denial, and finite bounds passed');
  } finally { await context.close(); }
} finally { await browser.close(); }
