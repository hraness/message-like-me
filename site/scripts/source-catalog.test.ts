import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import HomePage from '../app/page.tsx';
import SourcesPage from '../app/sources/page.tsx';
import {
  BEEPER_COMPATIBILITY,
  MESSAGING_HISTORY_SOURCES,
  SUPPORTED_SOURCES,
  WHATSAPP_COMPATIBILITY,
} from '../app/_lib/sources.ts';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');

async function source(path: string): Promise<string> {
  return Bun.file(resolve(repositoryRoot, path)).text();
}

describe('supported source presentation', () => {
  test('keeps one exact, source-aware catalog', () => {
    expect(SUPPORTED_SOURCES.map((entry) => entry.id)).toEqual([
      'apple-messages',
      'beeper-via-wrench',
      'whatsapp-via-wrench',
      'x-data-archive',
      'macos-contacts',
    ]);
    expect(new Set(SUPPORTED_SOURCES.map((entry) => entry.id)).size).toBe(
      SUPPORTED_SOURCES.length,
    );
    expect(SUPPORTED_SOURCES.every((entry) => entry.status === 'Supported')).toBe(true);
    expect(MESSAGING_HISTORY_SOURCES).toHaveLength(4);
    expect(SUPPORTED_SOURCES.find((entry) => entry.id === 'macos-contacts')?.kind).toBe(
      'Label enrichment',
    );
  });

  test('pins the native WhatsApp Wrench/Wacli contract exactly', () => {
    expect(WHATSAPP_COMPATIBILITY).toEqual({
      producer: 'Wrench',
      producerVersion: '0.16.3',
      providerCli: 'Wacli',
      providerCliVersion: '0.15.0',
      bundleSchemaVersion: '2',
      sourceId: 'wacli-local',
      sourceTransformVersion: '1.0.0',
      providerId: 'whatsapp',
      network: 'whatsapp',
    });
    const whatsapp = SUPPORTED_SOURCES.find((entry) => entry.id === 'whatsapp-via-wrench');
    expect(whatsapp?.name).toBe('WhatsApp via Wrench');
    expect(whatsapp?.boundary).toContain('Wrench alone owns Wacli');
    expect(whatsapp?.boundary).toContain('never sends');
  });

  test('pins the currently verified Beeper producer without widening the manifest contract', () => {
    expect(BEEPER_COMPATIBILITY).toEqual({
      producer: 'Wrench',
      producerVersion: '0.16.1',
      providerCliVersion: '0.6.2',
      bundleSchemaVersion: '1',
      sourceId: 'beeper-local',
      sourceTransformVersion: '1.1.0',
    });

    const beeper = SUPPORTED_SOURCES.find((entry) => entry.id === 'beeper-via-wrench');
    expect(beeper?.name).toBe('Beeper via Wrench');
    expect(beeper?.boundary).toContain('receives no Beeper credential');
    expect(beeper?.boundary).toContain('never sends');
  });

  test('publishes the catalog across human and machine discovery surfaces', async () => {
    const renderedHomePage = renderToStaticMarkup(HomePage());
    const renderedSourcesPage = renderToStaticMarkup(SourcesPage());
    const [home, sourcesPage, chrome, sitemap, llms, readme, bundleContract, whatsappContract] =
      await Promise.all([
        source('site/app/page.tsx'),
        source('site/app/sources/page.tsx'),
        source('site/app/_components/site-chrome.tsx'),
        source('site/app/sitemap.ts'),
        source('site/app/llms.txt/route.ts'),
        source('README.md'),
        source('docs/local-message-bundle-v1.md'),
        source('docs/local-message-bundle-v2.md'),
      ]);

    expect(home).toMatch(/native WhatsApp evidence exported through Wrench/u);
    expect(home).toContain('<SourceCard');
    expect(renderedHomePage).toContain('</span> wrench whatsapp export-message-like-me');
    expect(renderedHomePage).toContain('</span> messagelikeme ingest bundle');
    expect(sourcesPage).toContain('Beeper via Wrench');
    expect(sourcesPage).toMatch(/Message Like\s+Me invokes none of them/u);
    expect(renderedSourcesPage).toContain('Beeper CLI v0.6.2 and publishes');
    expect(renderedSourcesPage).toContain('Current support in v0.7.0');
    expect(renderedSourcesPage).toContain(
      'wrench beeper export-message-like-me --auth &lt;id&gt; --output /absolute/private/path/beeper-bundle',
    );
    expect(renderedSourcesPage).toContain(
      'https://github.com/hraness/message-like-me/blob/v0.7.0/docs/local-message-bundle-v1.md',
    );
    expect(renderedSourcesPage).toContain(
      'wrench whatsapp export-message-like-me --auth &lt;id&gt; --output /absolute/private/path/whatsapp-bundle',
    );
    expect(renderedSourcesPage).toContain(
      'https://github.com/hraness/message-like-me/blob/v0.7.0/docs/local-message-bundle-v2.md',
    );
    expect(chrome).toContain('href="/sources"');
    expect(sitemap).toContain("absoluteUrl('/sources')");
    expect(llms).toContain("absoluteUrl('/sources')");
    expect(readme).toContain('## Supported sources');
    const wrenchPackageUrl =
      `https://www.npmjs.com/package/@hraness/wrench/v/${BEEPER_COMPATIBILITY.producerVersion}`;
    const beeperCliReleaseUrl =
      'https://github.com/beeper/cli/releases/tag/v' +
      BEEPER_COMPATIBILITY.providerCliVersion.replaceAll('.', '%2E');
    for (const copy of [readme, bundleContract]) {
      expect(copy).toContain(`](${wrenchPackageUrl})`);
      expect(copy).toContain(
        `bun add --global @hraness/wrench@${BEEPER_COMPATIBILITY.producerVersion}`,
      );
    }
    expect(readme).toContain(`](${beeperCliReleaseUrl})`);
    const providerCliPattern = new RegExp(
      `Beeper CLI[^\\n]{0,80}${BEEPER_COMPATIBILITY.providerCliVersion.replaceAll('.', '\\.')}`,
      'u',
    );
    for (const copy of [readme, bundleContract]) {
      expect(copy).toContain(`Wrench v${BEEPER_COMPATIBILITY.producerVersion}`);
      expect(copy).toMatch(providerCliPattern);
      expect(copy).toContain(`source ID \`${BEEPER_COMPATIBILITY.sourceId}\``);
      expect(copy).toContain(
        `source-transform version \`${BEEPER_COMPATIBILITY.sourceTransformVersion}\``,
      );
    }
    expect(readme).toContain(
      `bundle schema \`${BEEPER_COMPATIBILITY.bundleSchemaVersion}\``,
    );
    expect(bundleContract).toContain(
      `schema version \`${BEEPER_COMPATIBILITY.bundleSchemaVersion}\``,
    );
    for (const coordinate of [
      `Wrench v${WHATSAPP_COMPATIBILITY.producerVersion}`,
      `Wacli v${WHATSAPP_COMPATIBILITY.providerCliVersion}`,
      `schema version \`${WHATSAPP_COMPATIBILITY.bundleSchemaVersion}\``,
      WHATSAPP_COMPATIBILITY.sourceId,
      WHATSAPP_COMPATIBILITY.sourceTransformVersion,
      `provider \`${WHATSAPP_COMPATIBILITY.providerId}@${WHATSAPP_COMPATIBILITY.providerCliVersion}\``,
    ]) {
      expect(whatsappContract).toContain(coordinate);
    }
    for (const coordinate of [
      `Wrench v${BEEPER_COMPATIBILITY.producerVersion}`,
      `Beeper CLI v${BEEPER_COMPATIBILITY.providerCliVersion}`,
      `bundle schema ${BEEPER_COMPATIBILITY.bundleSchemaVersion}`,
      BEEPER_COMPATIBILITY.sourceId,
      BEEPER_COMPATIBILITY.sourceTransformVersion,
    ]) {
      expect(renderedSourcesPage).toContain(coordinate);
    }
    for (const supportedSource of SUPPORTED_SOURCES) {
      expect(readme).toContain(`| ${supportedSource.name} |`);
      expect(llms).toContain(supportedSource.name);
    }
  });

  test('keeps icons decorative and rejects overclaiming copy', async () => {
    const [icons, home, sourcesPage, about, readme, llms, layout] = await Promise.all([
      source('site/app/_components/source-icon.tsx'),
      source('site/app/page.tsx'),
      source('site/app/sources/page.tsx'),
      source('site/app/about/page.tsx'),
      source('README.md'),
      source('site/app/llms.txt/route.ts'),
      source('site/app/layout.tsx'),
    ]);
    expect(icons).toContain('aria-hidden="true"');
    expect(icons).not.toContain('<svg');

    const catalogCopy = SUPPORTED_SOURCES.flatMap((entry) => [
      entry.name,
      entry.kind,
      entry.mode,
      entry.status,
      entry.summary,
      entry.boundary,
      entry.command,
    ]).join('\n');
    const publicCopy = [
      catalogCopy,
      home,
      sourcesPage,
      about,
      readme,
      llms,
      layout,
    ].join('\n').toLowerCase();
    for (const rejected of [
      'all connected accounts',
      'complete beeper history',
      'connect your beeper account',
      'message like me sends',
      'official beeper integration',
      'digital twin',
      'autonomous messaging',
      'local-only',
      'never leaves your device',
    ]) {
      expect(publicCopy).not.toContain(rejected);
    }
  });
});
