import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { HtmlSceneInputSchema } from '@hraness/slopcamera/local/html-overlay';
import { ownedChromiumLaunchOptions, pinnedBrowserExecutable, pinnedChromiumDefinition, verifyOwnedChromium } from '../site/scripts/browser-contract.mjs';

const root = resolve(import.meta.dir);
const out = resolve(root, 'out');
const stillsOnly = process.argv.includes('--stills-only');
const publish = process.argv.includes('--publish');
assert.ok(!stillsOnly || !publish);
const sceneBytes = await readFile(resolve(out, 'scene.json'));
assert.ok(sceneBytes.length <= 262_144);
const scene = HtmlSceneInputSchema.parse(JSON.parse(sceneBytes.toString()));
const { width, height } = scene.canvas;
const { fps, durationUs } = scene.timing;
const frames = Math.ceil(durationUs / 1_000_000 * fps);
assert.ok(width <= 1920 && height <= 1920 && width * height <= 2_073_600);
assert.ok(fps <= 30 && frames <= 1800);
assert.equal(scene.libraries.length, 0);
const contained = async (path: string) => {
  const file = resolve(root, path);
  assert.ok(file.startsWith(root + sep));
  assert.equal(await realpath(file), file);
  assert.ok((await stat(file)).size <= 1_048_576);
  return file;
};
assert.ok('path' in scene.document);
assert.equal(scene.document.path, 'out/film.html');
const documentPath = await contained(scene.document.path);
const files = new Map<string, { path: string; type: string }>([['/film.html', { path: documentPath, type: 'text/html; charset=utf-8' }]]);
const assets: Record<string, string> = {};
for (const resource of scene.resources) {
  assert.equal(resource.mediaType, 'font/woff2');
  assert.match(resource.urlPath, /^fonts\/[\w.-]+\.woff2$/u);
  const path = '/' + resource.urlPath;
  assert.ok(!files.has(path));
  files.set(path, { path: await contained(resource.path), type: resource.mediaType });
  assets[resource.name] = path;
}
await mkdir(resolve(out, 'stills'), { recursive: true });
const executable = await pinnedBrowserExecutable(chromium.executablePath());
const { defaultArgs, expectedVersion } = pinnedChromiumDefinition();
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let encoder: ReturnType<typeof spawn> | undefined;
let encoding: Promise<void> | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = { sourceSha256: createHash('sha256').update(await readFile(documentPath)).digest('hex'), frames, width, height, fps, durationSeconds: frames / fps, passed: false };
const run = (args: string[]) => {
  const result = Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' });
  assert.equal(result.exitCode, 0, result.stderr.toString().slice(-4000));
  return result.stdout.toString();
};
const server = Bun.serve({ hostname: '127.0.0.1', port: Number(process.env.PORT ?? 0), fetch(request) {
  const file = files.get(new URL(request.url).pathname);
  return file ? new Response(Bun.file(file.path), { headers: { 'content-type': file.type, 'cache-control': 'no-store' } }) : new Response('Not found', { status: 404 });
} });
try {
  browser = await chromium.launch(ownedChromiumLaunchOptions(executable, defaultArgs));
  const proof = await verifyOwnedChromium(browser, executable, expectedVersion);
  console.log(`Browser: ${proof.executable} (${proof.browserVersion})`);
  report.browser = proof;
  context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light' });
  await context.route('**/*', route => new URL(route.request().url()).origin === server.url.origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => errors.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await page.addInitScript(({ assets, fps }) => {
    const pending: Promise<unknown>[] = [];
    const callbacks: ((value: { timeMs: number; frame: number; fps: number }) => void)[] = [];
    const target = window as unknown as {
      SlopcameraOverlay: { asset(name: string): string; ready(promise: Promise<unknown>): void; onFrame(callback: (value: { timeMs: number; frame: number; fps: number }) => void): void };
      renderFilmFrame(timeMs: number): Promise<void>;
    };
    target.SlopcameraOverlay = {
      asset(name) { if (!assets[name]) throw new Error(`Unknown film asset ${name}`); return assets[name]!; },
      ready(promise) { pending.push(Promise.resolve(promise)); },
      onFrame(callback) { callbacks.push(callback); },
    };
    target.renderFilmFrame = async timeMs => {
      await Promise.all(pending);
      for (const callback of callbacks) callback({ timeMs, frame: Math.round(timeMs / 1000 * fps), fps });
      await document.fonts.ready;
    };
  }, { assets, fps });
  const response = await page.goto(new URL('/film.html', server.url).href, { waitUntil: 'networkidle' });
  assert.equal(response?.status(), 200);
  const draw = (seconds: number) => page.evaluate(async seconds => {
    await (window as unknown as { renderFilmFrame(timeMs: number): Promise<void> }).renderFilmFrame(seconds * 1000);
  }, seconds);
  for (const seconds of [2, 6, 10, 18.5, 27, 36, 41.5].filter(value => value < frames / fps)) {
    await draw(seconds);
    await page.screenshot({ path: resolve(out, `stills/frame-${seconds}.png`) });
  }
  await draw(10);
  const phone = await page.evaluate(() => {
    const visible = [...document.querySelectorAll('[data-film="phone"] [data-textmock-phone]')]
      .find(element => element.getBoundingClientRect().width > 0);
    if (!visible) throw new Error('The shared phone renderer is not visible.');
    const rect = visible.getBoundingClientRect();
    const window = document.getElementById('win')!.getBoundingClientRect();
    return { left: rect.left - window.left, top: rect.top - window.top, right: window.right - rect.right, bottom: window.bottom - rect.bottom,
      platform: visible.getAttribute('data-platform'), bubbles: visible.querySelectorAll('.tm-bubble').length };
  });
  assert.equal(phone.platform, 'imessage');
  assert.ok(phone.bubbles >= 3);
  for (const edge of ['left', 'top', 'right', 'bottom'] as const) assert.ok(phone[edge] >= -1, `The film clips the shared phone's ${edge} edge.`);
  report.phone = phone;
  assert.equal(errors.length, 0);
  if (!stillsOnly) {
    const movie = resolve(out, 'textbutler-launch.mp4');
    encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-vcodec', 'png', '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', movie], { stdio: ['pipe', 'ignore', 'pipe'] });
    let diagnostics = '';
    encoder.stderr!.on('data', data => { diagnostics = (diagnostics + data.toString()).slice(-4000); });
    encoder.stdin!.on('error', error => errors.push(`Encoder input: ${error.message}`));
    encoding = new Promise<void>((accept, reject) => {
      encoder!.once('error', reject);
      encoder!.once('close', code => code === 0 ? accept() : reject(new Error(`Film encoder exited ${code}: ${diagnostics}`)));
    });
    void encoding.catch(() => undefined);
    for (let frame = 0; frame < frames; frame++) {
      await draw(frame / fps);
      const bytes = await page.screenshot();
      if (encoder.stdin!.destroyed || encoder.exitCode !== null) throw new Error('The film encoder stopped before all frames were captured.');
      if (!encoder.stdin!.write(bytes)) await Promise.race([once(encoder.stdin!, 'drain'), encoding.then(() => { throw new Error('The film encoder stopped before input completed.'); })]);
      if (frame % 300 === 0) console.log(`Frame ${frame}/${frames}`);
    }
    encoder.stdin!.end();
    await encoding;
    assert.equal(errors.length, 0);
    const probe = JSON.parse(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_name', '-of', 'json', movie]));
    assert.equal(probe.streams[0]?.codec_name, 'h264');
    assert.equal(probe.streams[0]?.width, width);
    assert.equal(probe.streams[0]?.height, height);
    assert.ok(Math.abs(Number(probe.format.duration) - frames / fps) < 0.04);
    assert.ok((await stat(movie)).size <= 12_000_000);
    const poster = resolve(out, 'textbutler-launch-poster.webp');
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '10', '-i', movie, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '85', poster]);
    const require = createRequire(resolve(root, '../site/package.json'));
    const renderer = require('@hraness/textmockups/package.json');
    const metadata = { renderer: { name: renderer.name, version: renderer.version }, browserVersion: proof.browserVersion,
      sourceSha256: report.sourceSha256, durationSeconds: frames / fps, width, height, fps,
      filmSha256: createHash('sha256').update(await readFile(movie)).digest('hex'), posterSha256: createHash('sha256').update(await readFile(poster)).digest('hex') };
    report.media = metadata;
    if (publish) {
      const consumer = require('./package.json');
      assert.equal(consumer.dependencies[renderer.name], `https://github.com/hraness/textmockups/releases/download/v${renderer.version}/hraness-textmockups-${renderer.version}.tgz`);
      assert.equal(width, 1920);
      assert.equal(height, 1080);
      assert.equal(frames / fps, 42);
      await copyFile(movie, resolve(root, '../site/public/launch/textbutler-launch.mp4'));
      await copyFile(poster, resolve(root, '../site/public/launch/textbutler-launch-poster.webp'));
      await writeFile(resolve(root, 'published-film.json'), JSON.stringify(metadata, null, 2) + '\n');
    }
  }
  report.passed = true;
} finally {
  try { await context?.close(); }
  finally {
    try { await browser?.close(); }
    finally {
      if (encoder && encoder.exitCode === null) { encoder.stdin?.destroy(); encoder.kill('SIGTERM'); }
      await encoding?.catch(() => undefined);
      await server.stop(true);
      report.errors = errors;
      await writeFile(resolve(out, 'render-receipt.json'), JSON.stringify(report, null, 2) + '\n');
    }
  }
}
console.log(JSON.stringify({ passed: report.passed, frames, durationSeconds: frames / fps, mode: stillsOnly ? 'stills' : publish ? 'published' : 'rendered' }));
