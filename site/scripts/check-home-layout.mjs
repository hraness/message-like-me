import assert from 'node:assert/strict';

export async function inspectHomeLayout(page, { enforceDesktopColumns = true } = {}) {
  const pause = page.locator('.tb-hero .tb-pause');
  if (await pause.getAttribute('aria-pressed') !== 'true') await pause.click();
  await page.locator('.tb-hero [data-phase="final"]').waitFor();
  const state = await page.evaluate(() => {
    const box = element => {
      const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
      return { x, y, width, height, right, bottom };
    };
    const hero = document.querySelector('.tb-hero');
    const crop = hero.querySelector('[data-phone-crop]');
    const pause = hero.querySelector('.tb-pause');
    return {
      width: innerWidth,
      hero: {
        copy: box(hero.querySelector('.hraness-marketing-hero__copy')),
        frame: box(hero.querySelector('.hraness-marketing-hero__frame')),
        crop: crop && box(crop), phone: crop && box(crop.querySelector('[role="img"]')),
        pause: pause && box(pause),
        pauseOutside: pause && !crop?.contains(pause),
      },
      providers: [...document.querySelectorAll('#supports .hraness-marketing-card')].map(card => {
        const icon = card.querySelector('.hraness-marketing-card__icon');
        const copy = card.querySelector('.hraness-marketing-card__copy');
        return { icon: icon && box(icon), copy: copy && box(copy),
          glyph: !!icon?.querySelector('svg'),
          fits: copy && copy.scrollWidth <= copy.clientWidth + 1 && copy.scrollHeight <= copy.clientHeight + 1 };
      }),
      features: [...document.querySelectorAll('.tb-feature')].map(section => ({
        copy: box(section.querySelector('.hraness-marketing-section__heading-group')),
        media: box(section.querySelector('.hraness-marketing-section__body')),
      })),
      crops: [...document.querySelectorAll('[data-phone-crop]')].map(viewport => {
        const frame = box(viewport);
        // The butler's replies are the marked 🤖{ } bubbles in the visible appearance.
        const replies = [...viewport.querySelectorAll('.tm-bubble')].filter(bubble => bubble.textContent.trimStart().startsWith('🤖{') && bubble.getClientRects().length > 0);
        return { frame, replies: replies.map(box) };
      }),
    };
  });
  const { hero } = state;
  assert.ok(hero.crop && hero.phone && hero.crop.height < hero.phone.height - 1, 'Hero: crop the device, retaining the complete phone proportions');
  assert.ok(hero.pauseOutside && hero.pause.y >= hero.crop.bottom - 1, 'Hero: animation control stays outside the faded viewport');
  assert.ok(state.crops.every(crop => crop.replies.every(reply => reply.bottom <= crop.frame.y + crop.frame.height * 0.88 + 1)), 'Phones: the butler’s complete replies remain above the bottom fade');
  if (state.width >= 1440 && enforceDesktopColumns) {
    assert.ok(hero.frame.x >= hero.copy.right - 1, 'Hero: phone sits beside the copy');
    assert.ok(hero.frame.y < hero.copy.bottom && hero.copy.y < hero.frame.bottom, 'Hero: phone and copy share the same row');
    assert.ok(state.features.every(feature => feature.copy.right <= feature.media.x + 1 || feature.media.right <= feature.copy.x + 1), 'Benefits: copy and proof occupy separate columns');
  } else if (state.width <= 390) {
    assert.ok(hero.frame.y >= hero.copy.bottom - 1, 'Hero: phone follows the copy on mobile');
  }
  assert.ok(state.features.every(feature => feature.copy.right <= feature.media.x + 1 || feature.media.right <= feature.copy.x + 1 || feature.copy.bottom <= feature.media.y + 1 || feature.media.bottom <= feature.copy.y + 1), 'Benefits: copy and proof never overlap, including when enlarged text reflows');
  assert.equal(state.providers.length, 3, 'Messaging apps: three integrations');
  assert.ok(state.providers.every(provider => provider.icon && provider.copy && provider.glyph && provider.fits && provider.icon.width >= 55 && (provider.icon.right <= provider.copy.x + 1 || provider.icon.bottom <= provider.copy.y + 1)), 'Messaging apps: large real marks beside or above complete text');
  return state;
}
