// Re-renders the launch diagrams from their Slopcamera sources.
//
//   bun run diagrams            # every source in design/diagrams
//   bun run diagrams d1-flow    # only sources whose name starts with d1-flow
//
// Slopcamera owns layout, text measurement and the Paper-token theme
// (design/diagrams/slopcamera.config.json). This script then applies the few
// styling conventions Slopcamera's schema cannot express (see
// design/diagrams/README.md), writes light and dark SVGs to public/diagrams,
// and rasterizes each one at 2x in Chrome so emoji and the embedded Nebula
// Sans faces render exactly as they do on the site.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const siteRoot = resolve(import.meta.dir, '..');
const sourceDir = join(siteRoot, 'design', 'diagrams');
const outDir = join(siteRoot, 'public', 'diagrams');
const slopcamera = process.env.SLOPCAMERA_BIN ?? 'slopcamera';
const expectedVersion = /^3\.3\./;
const browserExecutable =
  process.env.TEXTBUTLER_BROWSER_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const filters = process.argv.slice(2);

type Meta = { readonly title: string; readonly desc: string };
const meta = JSON.parse(await readFile(join(sourceDir, 'diagrams.meta.json'), 'utf8')) as Record<string, Meta>;

function run(args: readonly string[]): string {
  const result = Bun.spawnSync([slopcamera, ...args], { stdout: 'pipe', stderr: 'pipe' });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== 0) throw new Error(`slopcamera ${args.join(' ')} failed:\n${output}`);
  return output;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// Conventions carried by shape and edge ids (documented in design/diagrams/README.md):
//   shape id "dash-*"  -> dashed outline (boundaries and optional destinations)
//   shape id "ghost-*" -> no outline (icon or text holders)
//   edge id "thin-*"   -> 1.25px hairline branch; other edges 1.75px
//   edge id "dash-*"   -> dashed hairline
//   shape id "under-*" -> drawn beneath the connectors (lane and band fills)
function finish(svg: string, name: string): string {
  const entry = meta[name];
  if (entry === undefined) throw new Error(`design/diagrams/diagrams.meta.json has no entry for ${name}`);
  let out = svg.replace(
    /<title id="diagram-title">[^<]*<\/title>/,
    `<title id="diagram-title">${escapeXml(entry.title)}</title><desc id="diagram-desc">${escapeXml(entry.desc)}</desc>`,
  );
  out = out.replace('aria-labelledby="diagram-title"', 'aria-labelledby="diagram-title diagram-desc"');
  out = out.replace(/(<g data-shape-id="dash-[^"]*"[^>]*><(?:rect|ellipse)\b)/g, '$1 stroke-dasharray="5 6"');
  out = out.replace(/(<g data-shape-id="ghost-[^"]*"[^>]*><(?:rect|ellipse)\b[^>]*?)stroke-width="[^"]*"/g, '$1stroke-width="0"');
  out = out.replace(/(<g data-edge-id="([^"]*)"><path\b[^>]*?)stroke-width="[^"]*"/g, (_match, head: string, id: string) => {
    const width = id.startsWith('thin-') || id.startsWith('dash-') ? 1.25 : 1.75;
    const dash = id.startsWith('dash-') ? ' stroke-dasharray="4 5"' : '';
    return `${head}stroke-width="${width}"${dash}`;
  });
  const under = out.match(/<g data-shape-id="under-[^"]*"[^>]*>(?:(?!<g\b).)*?<\/g>/g) ?? [];
  for (const group of under) out = out.replace(group, '');
  const firstLayer = out.search(/<g data-(?:edge|shape)-id=|<(?:text|line)\b[^>]*data-shape-id=|<text\b/);
  if (under.length > 0 && firstLayer >= 0) out = `${out.slice(0, firstLayer)}${under.join('')}${out.slice(firstLayer)}`;
  return out;
}

const version = run(['--version']).trim();
if (!expectedVersion.test(version) && process.env.SLOPCAMERA_ANY_VERSION !== '1') {
  throw new Error(`Expected Slopcamera 3.3.x, found ${version}. Set SLOPCAMERA_ANY_VERSION=1 to override.`);
}

const sources = (await readdir(sourceDir))
  .filter((file) => file.endsWith('.diagram.json'))
  .filter((file) => filters.length === 0 || filters.some((filter) => file.startsWith(filter)))
  .sort();
if (sources.length === 0) throw new Error('No matching .diagram.json sources.');

await mkdir(outDir, { recursive: true });
const work = await mkdtemp(join(tmpdir(), 'textbutler-diagrams-'));
const browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
try {
  for (const file of sources) {
    const source = join(sourceDir, file);
    const spec = JSON.parse(await readFile(source, 'utf8')) as { name: string; canvas: { width: number; height: number } };
    const check = run(['diagram', 'check', source]).trim();
    const findings = check.split('\n').filter((line) => line.trim().startsWith('['));
    run(['diagram', 'render', source, '--out-dir', work]);
    for (const mode of ['light', 'dark'] as const) {
      const svg = finish(await readFile(join(work, `${spec.name}.${mode}.svg`), 'utf8'), spec.name);
      const svgPath = join(outDir, `${spec.name}.${mode}.svg`);
      await writeFile(svgPath, svg);
      const context = await browser.newContext({
        viewport: { width: spec.canvas.width, height: spec.canvas.height },
        deviceScaleFactor: 2,
        colorScheme: mode,
      });
      const page = await context.newPage();
      await page.goto(pathToFileURL(svgPath).href);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: join(outDir, `${spec.name}.${mode}@2x.png`),
        clip: { x: 0, y: 0, width: spec.canvas.width, height: spec.canvas.height },
      });
      await context.close();
    }
    const note = findings.length === 0 ? '' : ` (${findings.length} lint note${findings.length === 1 ? '' : 's'}: ${[...new Set(findings.map((line) => line.trim().split(']')[0] + ']'))].join(' ')})`;
    console.log(`${spec.name}: light/dark SVG + PNG@2x${note}`);
  }
} finally {
  await browser.close();
  await rm(work, { recursive: true, force: true });
}
