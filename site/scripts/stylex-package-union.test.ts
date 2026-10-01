import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { serializeStylexRuleUnionV1 } from '@hraness/ui/stylex-build';
import stylex from '../stylex.config.mjs';
import { auditPackageStyles, loadPackageUnion } from './stylex-package-union.mjs';
import packageUnion from './postcss-package-union.cjs';

const root = resolve(import.meta.dir, '..');
// Exercise the same PostCSS installation Next loads for the production build.
const nextRequire = createRequire(import.meta.resolve('next/package.json'));
const postcss = nextRequire('postcss') as typeof import('postcss').default;
const union = await loadPackageUnion(root, stylex.packages);
const entry = resolve(root, stylex.entry);
const css = await readFile(entry, 'utf8');

test('the real UI, Design Kit and footer share one order-independent recipe union', () => {
  expect(union.manifests.map(item => item.package.name)).toEqual(stylex.packages);
  const reversed = [...union.manifests].reverse();
  expect(serializeStylexRuleUnionV1(reversed.flatMap(item => [...item.rules]), reversed.map(item => item.standaloneSerializer)))
    .toBe(union.css);
  const shared = union.manifests[1]!.rules.find(rule => rule[1].ltr.includes('grid-template-columns:minmax(0,1fr)'))!;
  expect(union.manifests[2]!.rules.some(rule => rule[0] === shared[0])).toBeTrue();
  expect(union.css.split(`.${shared[0]} {`)).toHaveLength(2);
  expect(union.css).toContain('components.hraness-stylex.priority');
  expect(union.css).not.toMatch(/components\.hraness-(?:ui|design-kit|site-footer)\.priority/u);
});

test('the production PostCSS path appends one checked union after foundations', async () => {
  const result = await postcss([packageUnion({ ...stylex, root })]).process(css, { from: entry });
  const recipes = postcss.parse(union.css).nodes;
  expect(result.root.nodes.slice(-recipes.length).map(node => node.toString()))
    .toEqual(recipes.map(node => node.toString()));
  expect(result.messages.filter(message => message.type === 'dependency').length).toBe(union.dependencies.length);
  const local = '.local { display: grid; }';
  const component = await postcss([packageUnion({ ...stylex, root })]).process(local, { from: resolve(root, 'app/local.css') });
  expect(component.css).toBe(local);
});

test('missing foundations and standalone recipes stop compilation', async () => {
  const missing = css.replace("@import '@hraness/site-footer/compiler-foundation.css';", '');
  await expect(postcss([packageUnion({ ...stylex, root })]).process(missing, { from: entry }).async())
    .rejects.toThrow('exactly once');
  expect(() => auditPackageStyles(postcss.parse('@import "@hraness/ui/stylex.css";'), union.manifests, 'mixed route'))
    .toThrow('standalone recipe');
  const footer = union.manifests[2]!;
  expect(() => auditPackageStyles(postcss.parse(`@layer ${footer.standaloneSerializer.prefix}.priority4 { .unexpected { display: block; } }`), union.manifests, 'copied recipe'))
    .toThrow('independently serialized recipe');
  expect(() => auditPackageStyles(postcss.parse(union.css), union.manifests, 'second union')).toThrow('reserved');
});

test('the shared hero owns its responsive columns without a TextButler workaround', async () => {
  const landing = await readFile(resolve(root, 'app/_components/landing/landing.css'), 'utf8');
  expect(landing).not.toMatch(/\.tb-hero\[data-layout=["']split["']\]/u);
  expect(css).not.toContain('/palettes.css');
  expect(css).not.toMatch(/@hraness\/(?:ui|design-kit|site-footer)\/(?:styles|stylex)\.css/u);
});
