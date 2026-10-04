import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { importedCss, moduleCss } from './css-modules';
import { filmTimeline, type FilmCopy } from './timeline';
import { launchFilmCopy } from './facts';
import { launchFacts } from '../site/app/launch/facts';
import storyConfig from './story/story.config';
import { storyPhone } from './story/phone';
import { expectPhoneScene } from '../site/scripts/phone-scene-assertions';

test('the story phone uses shared scenes in both themes and perspectives', () => expectPhoneScene(storyPhone));

test('the film includes the same scoped renderer stylesheet as the site', async () => {
  await import('./mockups');
  expect(importedCss()).toContain('.tm-phone');
  expect(importedCss()).toContain('.tm-fit');
  expect(moduleCss()).toContain('.tbf-root');
});

test('the legacy draft timeline remains bounded and deterministic', () => {
  const config = JSON.parse(readFileSync(new URL('./film.json', import.meta.url), 'utf8')) as { copy: FilmCopy };
  const timeline = filmTimeline(launchFilmCopy(config.copy));
  expect(timeline.duration).toBeGreaterThan(0);
  expect(timeline.duration).toBeLessThanOrEqual(60);
  expect(timeline.act('step-1').start).toBeLessThan(10);
  expect(timeline.act('step-1').end).toBeGreaterThan(10);
});

test('the current dark story preserves its setup prompt and uses the canonical phone instead of a second iMessage mockup', () => {
  const story = storyConfig();
  expect(story.brand.palette.values?.background).toBe('#282828');
  expect(story.end.prompt).toBe('Set up TextButler from textbutler.app');
  expect(Number(launchFacts.filmSeconds.value)).toBe(30);
  expect(story.acts.some(act => act.kind === 'chat')).toBe(false);
  const proof = story.acts.find(act => act.kind === 'gallery');
  expect(proof?.kind).toBe('gallery');
  if (proof?.kind !== 'gallery') throw new Error('The film needs shared-renderer product proof.');
  expect(proof.items[0]?.image).toEndWith('/story/shared-phone.png');
  expect(proof.sample).toBe(true);
  expect(proof.seconds).toBeCloseTo(5.134, 8);
});
