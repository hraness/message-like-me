import assert from 'node:assert/strict';

const maximumTiles = 100;
const imageDeadline = 10_000;

// A natural viewport pass loads only pictures that the later capture pass sees.
// Settle those assets before recording the geometry that captures must preserve.
export async function settleProductionImages(page, label) {
  const height = await page.evaluate(() => innerHeight);
  const step = Math.max(1, Math.floor(height * 0.8));
  const tiles = [];
  let reachedBottom = false;
  for (let index = 0; index < maximumTiles; index++) {
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(Math.ceil(pageHeight / step) <= maximumTiles, `${label}: bounded image-settlement count`);
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), index * step);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const images = await page.evaluate(async timeout => {
      const describe = image => {
        const { x, y, width, height } = image.getBoundingClientRect();
        return { currentSrc: image.currentSrc, complete: image.complete, naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight, rect: { x, y, width, height } };
      };
      const visible = [...document.images].filter(image => {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
          && rect.right > 0 && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
      });
      const records = visible.map(image => ({ before: describe(image) }));
      let timer;
      try {
        await Promise.race([
          Promise.all(visible.map(async image => {
            await image.decode();
            if (!image.complete || image.naturalWidth <= 0) throw new Error(`Image did not decode: ${image.currentSrc}`);
          })),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Visible image decode deadline exceeded')), timeout); }),
        ]);
      } finally { clearTimeout(timer); }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return records.map((record, index) => ({ ...record, after: describe(visible[index]) }));
    }, imageDeadline);
    const position = await page.evaluate(() => ({ y: scrollY, viewportHeight: innerHeight,
      pageHeight: document.documentElement.scrollHeight }));
    assert.ok(Math.ceil(position.pageHeight / step) <= maximumTiles, `${label}: bounded settled image count`);
    tiles.push({ ...position, images });
    if (position.y + position.viewportHeight >= position.pageHeight) { reachedBottom = true; break; }
  }
  assert.ok(reachedBottom, `${label}: image settlement reached the bottom within its bound`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(async () => { await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  return tiles;
}
