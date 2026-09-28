// Captures the code-drawn phone scenes on /stills as transparent PNGs in
// public/launch/ (README hero, launch film) and the social card as
// public/og.png (1200 × 630, served at /opengraph-image too).
//
//   bun run dev            # in another terminal, or set STILLS_BASE_URL
//   bun run stills         # every scene at 2x and 3x
//
// The phone is drawn in code, so a still is only a screenshot of the same
// component the home page renders.
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const siteRoot = resolve(import.meta.dir, '..');
const outDir = join(siteRoot, 'public', 'launch');
const base = process.env.STILLS_BASE_URL ?? 'http://localhost:3217';
const executablePath =
  process.env.TEXTBUTLER_BROWSER_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scales = [2, 3] as const;

await mkdir(outDir, { recursive: true });
const sharp = (await import('sharp')).default;
const browser = await chromium.launch({ executablePath, headless: true });
try {
  for (const scale of scales) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: scale, reducedMotion: 'reduce', bypassCSP: true });
    const page = await context.newPage();
    await page.goto(`${base}/stills`, { waitUntil: 'networkidle' });
    // Transparent page so each still keeps only the phone and its shadow.
    await page.addStyleTag({ content: 'html, body, main { background: transparent !important; } body > :not(main) { display: none !important; }' });
    await page.evaluate(() => document.fonts.ready);
    const ids = await page.locator('[data-still]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-still') ?? ''));
    for (const id of ids) {
      const path = join(outDir, `phone-${id}@${scale}x.png`);
      await page.locator(`[data-still="${id}"]`).screenshot({ path, omitBackground: true });
      console.log(path);
    }
    if (scale === 2) {
      // Link previews are 1200 × 630 at 1x; render at 2x and downsample for crisp edges.
      const og = join(siteRoot, 'public', 'og@2x.png');
      await page.locator('[data-card="og"]').screenshot({ path: og });
      console.log(og);
      for (const theme of ['light', 'dark'] as const) {
        const path = join(outDir, `readme-hero-${theme}@2x.png`);
        await page.locator(`[data-card="readme-hero-${theme}"]`).screenshot({ path });
        console.log(path);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const og2x = join(siteRoot, 'public', 'og@2x.png');
await sharp(og2x).resize(1200, 630, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(join(siteRoot, 'public', 'og.png'));
await rm(og2x);
console.log(join(siteRoot, 'public', 'og.png'));
