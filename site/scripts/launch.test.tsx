import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { launchBeats, socialKit, LAUNCH_POST_PATH } from '../app/launch/beats.ts';
import { launchFacts, LAUNCH_STATUS } from '../app/launch/facts.ts';
import { LaunchPostBeats } from '../app/launch/launch-post.tsx';
import { SURFACE_COMPONENTS, WRITERS } from '../app/mockups/index.ts';
import { AGENT_SETUP_PROMPT, SITE_STATUS_LABEL } from '../app/_lib/site.ts';
import { LAUNCH_FILM_SECONDS } from '../app/_components/landing/public-assets.ts';
import { launchFactTokens } from './blog-html.ts';

const repo = resolve(import.meta.dir, '../..');
const source = (path: string) => readFile(resolve(repo, path), 'utf8');

// Facts are pinned to the records they come from, not to prose.
test('launch facts match the product source', async () => {
  const config = await source('packages/textbutler/src/config.ts');
  expect(config).toContain('humanCooldownMs: 300_000');
  expect(launchFacts.cooldown.value).toBe('5 minutes');
  expect(config).toContain('debounceMs: 8_000');
  expect(launchFacts.debounce.value).toBe('8 seconds');
  expect(config).toContain(`maxRepliesPerHour: ${launchFacts.hourlyCap.value}`);
  expect(await source('packages/textbutler/src/owner-replies.ts')).toContain('DRAFT_TTL_MS = 15 * 60_000');
  expect(launchFacts.draftExpiry.value).toBe('15 minutes');
  expect(await source('packages/textbutler/src/default-reply-model.ts')).toContain('dailyBudgetUsd: 1 ');
  expect(launchFacts.gatewayBudget.value).toBe('$1');
  expect(await source('docs/textbutler/getting-started.md')).toContain(launchFacts.localModelSize.value);
  expect(await source('packages/textbutler/src/contact-habitat.ts')).toContain(`memoryEntries: ${launchFacts.memoryEntries.value},`);
  expect(WRITERS).toHaveLength(3);
  expect(launchFacts.replyWriters.value).toBe('three');
});

test('launch status is the one development-status label', () => {
  expect(LAUNCH_STATUS).toBe(SITE_STATUS_LABEL);
  expect(launchFacts.status.value).toBe(SITE_STATUS_LABEL);
});

test('every beat visual names a mockup or an exported diagram', async () => {
  const { existsSync } = await import('node:fs');
  for (const beat of launchBeats) {
    if (beat.visual.kind === 'mockup') expect(Object.keys(SURFACE_COMPONENTS)).toContain(beat.visual.id);
    else if (beat.visual.kind === 'diagram') expect(existsSync(resolve(import.meta.dir, `../public/diagrams/${beat.visual.src}.light@2x.png`)) || existsSync(resolve(import.meta.dir, `../public/diagrams/${beat.visual.src}-wide.light@2x.png`))).toBe(true);
    else throw new Error(`unexpected visual for ${beat.id}`);
  }
});

test('mockup commands are ones the product documents', async () => {
  const readme = await source('README.md');
  const guide = await source('docs/textbutler/getting-started.md');
  for (const writer of WRITERS) for (const command of writer.commands) {
    const head = command.split(' --')[0]!.replace(/^.*textbutler /, '');
    expect(readme.includes(head) || guide.includes(head)).toBe(true);
  }
  expect(AGENT_SETUP_PROMPT).toContain('textbutler doctor');
});

test('the retained launch kit renders every beat and links to its introduction', () => {
  const html = renderToStaticMarkup(<LaunchPostBeats />);
  for (const beat of launchBeats) expect(html).toContain(beat.id);
  expect(JSON.stringify(socialKit)).toContain(LAUNCH_POST_PATH);
  expect(JSON.stringify(socialKit)).not.toMatch(/mastodon/i);
});

test('the film length is the launch fact, in whole seconds of the real mp4', async () => {
  const { statSync } = await import('node:fs');
  expect(LAUNCH_FILM_SECONDS).toBe(30);
  expect(String(LAUNCH_FILM_SECONDS)).toBe(launchFacts.filmSeconds.value);
  expect(statSync(resolve(import.meta.dir, '../public/launch/textbutler-launch.mp4')).size).toBeGreaterThan(0);
});

test('published launch media matches its shared-renderer source record', async () => {
  const record = JSON.parse(await source('video/published-film.json')) as {
    renderer: { name: string; version: string }; durationSeconds: number; width: number; height: number; fps: number;
    filmSha256: string; posterSha256: string; sharedPhoneSha256: string;
  };
  const consumer = JSON.parse(await source('site/package.json')) as { dependencies: Record<string, string> };
  expect(record.renderer.name).toBe('@hraness/textmockups');
  expect(consumer.dependencies[record.renderer.name]).toBe(`https://github.com/hraness/textmockups/releases/download/v${record.renderer.version}/hraness-textmockups-${record.renderer.version}.tgz`);
  expect(Math.ceil(record.durationSeconds)).toBe(Number(launchFacts.filmSeconds.value));
  expect([record.width, record.height]).toEqual([1920, 1080]);
  expect([30, 60]).toContain(record.fps);
  const phone = await readFile(resolve(repo, 'video/story/shared-phone.png'));
  const phoneSource = JSON.parse(await source('video/story/shared-phone.json')) as {
    renderer: { name: string; version: string }; pngSha256: string; phone: { platform: string; bubbles: number; styled: boolean };
  };
  expect(phoneSource.renderer).toEqual(record.renderer);
  expect(phoneSource.pngSha256).toBe(record.sharedPhoneSha256);
  expect(phoneSource.phone).toMatchObject({ platform: 'imessage', bubbles: 2, styled: true });
  expect(createHash('sha256').update(phone).digest('hex')).toBe(record.sharedPhoneSha256);
  for (const [name, digest] of [['textbutler-launch.mp4', record.filmSha256], ['textbutler-launch-poster.webp', record.posterSha256]] as const) {
    const bytes = await readFile(resolve(repo, 'site/public/launch', name));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  }
});

// Any numeric facts used by the evergreen article resolve from the same source.
// The article need not repeat every configuration limit.
test('the launch post body uses fact tokens, not typed numbers', async () => {
  const body = await source('site/content/blog/introducing-textbutler.md');
  const tokens = launchFactTokens();
  for (const [, token] of body.matchAll(/\{\{([A-Z_]+)\}\}/gu)) {
    expect(tokens[token!]).toBeDefined();
  }
  for (const typed of ['5 minutes', '8 seconds', '85%', '15 minutes', '$1 a day', '2.5 GB', '64 notes', 'under 12']) expect(body).not.toContain(typed);
});

test('social posts carry no caveats', () => {
  const text = JSON.stringify(socialKit);
  for (const caveat of ['in testing', 'in our testing', 'once testing', 'not yet tested', 'coming soon', '—']) expect(text.toLowerCase()).not.toContain(caveat);
});
