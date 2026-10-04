import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';
import { importedCss, moduleCss } from './css-modules';
import { conversationScene } from '../site/app/_components/phone/scene';
import { storyPhone } from './story/phone';
import palette from './story/palette.json';
import { ownedChromiumLaunchOptions, pinnedBrowserExecutable, pinnedChromiumDefinition, verifyOwnedChromium } from '../site/scripts/browser-contract.mjs';

const root = resolve(import.meta.dir, 'story');
const require = createRequire(resolve(import.meta.dir, '../site/package.json'));
const renderer = require('@hraness/textmockups/package.json');
const consumer = require('./package.json');
assert.equal(consumer.dependencies[renderer.name], `https://github.com/hraness/textmockups/releases/download/v${renderer.version}/hraness-textmockups-${renderer.version}.tgz`);
const { PhoneMock } = await import('../site/app/_components/phone/phone-mock');
const scene = conversationScene(storyPhone, { perspective: 'contact', theme: 'dark', screenHeight: 650 });
const markup = renderToStaticMarkup(createElement(PhoneMock, { conversation: storyPhone, perspective: 'contact', theme: 'dark', screenHeight: 650, maxWidth: 393 }));
const scopedCss = moduleCss(), rendererCss = importedCss();
assert.match(scopedCss, /\.tbf-root\b/u);
assert.match(rendererCss, /\.tm-phone\b/u);
const html = `<!doctype html><html data-theme="dark"><head><style>${scopedCss}\n${rendererCss}\nhtml,body{margin:0;width:489px;height:746px;background:${palette.palette.background};color-scheme:dark}body{display:grid;place-items:center}body>[data-tb-phone]{width:393px}</style></head><body>${markup}</body></html>`;
assert.ok(Buffer.byteLength(html) <= 262_144);
const executable = await pinnedBrowserExecutable(chromium.executablePath());
const { defaultArgs, expectedVersion } = pinnedChromiumDefinition();
const browser = await chromium.launch(ownedChromiumLaunchOptions(executable, defaultArgs));
try {
  const proof = await verifyOwnedChromium(browser, executable, expectedVersion);
  console.log(`Browser: ${proof.executable} (${proof.browserVersion})`);
  const context = await browser.newContext({ viewport: { width: 489, height: 746 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  try {
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => errors.push(request.failure()?.errorText ?? 'Unexpected resource request'));
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const phone = await page.locator('[data-textmock-phone]').evaluate(element => {
      const rect = element.getBoundingClientRect();
      const bubble = element.querySelector('.tm-bubble')!;
      const style = getComputedStyle(bubble);
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        platform: element.getAttribute('data-platform'), bubbles: element.querySelectorAll('.tm-bubble').length,
        styled: parseFloat(style.borderTopLeftRadius) > 0 && (style.backgroundImage !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)') };
    });
    assert.equal(phone.platform, 'imessage');
    assert.equal(phone.bubbles, 2);
    assert.equal(phone.styled, true);
    assert.ok(phone.left >= 30 && phone.top >= 30 && phone.right <= 459 && phone.bottom <= 716);
    assert.equal(errors.length, 0);
    const png = await page.screenshot({ path: resolve(root, 'shared-phone.png') });
    const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
    const metadata = { renderer: { name: renderer.name, version: renderer.version }, browserVersion: proof.browserVersion,
      width: 489, height: 746, phone, pngSha256: hash(png), sceneSha256: hash(JSON.stringify(scene)) };
    await writeFile(resolve(root, 'shared-phone.json'), JSON.stringify(metadata, null, 2) + '\n');
    assert.equal(hash(await readFile(resolve(root, 'shared-phone.png'))), metadata.pngSha256);
    console.log(JSON.stringify({ passed: true, renderer: metadata.renderer, pngSha256: metadata.pngSha256, phone }));
  } finally { await context.close(); }
} finally { await browser.close(); }
