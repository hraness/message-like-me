import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { importedCss, moduleCss } from './css-modules';
import { filmTimeline, type FilmCopy } from './timeline';
import { launchFilmCopy } from './facts';
import { launchFacts } from '../site/app/launch/facts';

test('the film includes the same scoped renderer stylesheet as the site', async () => {
  await import('./mockups');
  expect(importedCss()).toContain('.tm-phone');
  expect(importedCss()).toContain('.tm-fit');
  expect(moduleCss()).toContain('.tbf-root');
});

test('the film timeline matches the published duration fact', () => {
  const config = JSON.parse(readFileSync(new URL('./film.json', import.meta.url), 'utf8')) as { copy: FilmCopy };
  const timeline = filmTimeline(launchFilmCopy(config.copy));
  expect(timeline.duration).toBeCloseTo(Number(launchFacts.filmSeconds.value), 8);
  expect(timeline.act('step-1').start).toBeLessThan(10);
  expect(timeline.act('step-1').end).toBeGreaterThan(10);
});
