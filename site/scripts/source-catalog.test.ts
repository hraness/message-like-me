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
      producerVersion: '0.16.3',
      adapterId: 'beeper-local',
      adapterVersion: '2.3.0',
      reviewedOperationCount: 32,
      pinnedCliOperationCount: 27,
      fixedDesktopReadOperationCount: 5,
      providerCliVersion: '0.6.2',
      providerCliSourcePackagePath: 'packages/cli/package.json',
      providerCliSourceDeclaredVersion: '0.6.1',
      bundleSchemaVersion: '1',
      sourceId: 'beeper-local',
      sourceTransformVersion: '1.1.0',
      exportBoundary: 'internal-bounded',
    });
    expect(
      BEEPER_COMPATIBILITY.pinnedCliOperationCount +
        BEEPER_COMPATIBILITY.fixedDesktopReadOperationCount,
    ).toBe(
      BEEPER_COMPATIBILITY.reviewedOperationCount,
    );

    const beeper = SUPPORTED_SOURCES.find((entry) => entry.id === 'beeper-via-wrench');
    expect(beeper?.name).toBe('Beeper via Wrench');
    expect(beeper?.boundary).toContain('owns zero Beeper operations');
    expect(beeper?.boundary).toContain('credentials, or live sessions');
    expect(beeper?.boundary).toContain('never sends');
    expect(beeper?.boundary).toContain('does not claim complete history');
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

    expect(home).toMatch(
      /native WhatsApp bundles exported through compatible Wrench releases/u,
    );
    expect(home).toContain('<ProductHero');
    expect(home).toContain("{ href: '#install', label: `Install v${SOFTWARE_VERSION}` }");
    expect(home).toContain('<SourceCard');
    expect(renderedHomePage).toContain('data-hraness-marketing="hero"');
    expect(renderedHomePage).toContain('messagelikeme ingest imessage --json');
    expect(renderedHomePage).toContain(
      'messagelikeme ingest bundle --input /absolute/private/whatsapp-bundle',
    );
    expect(sourcesPage).toContain('Beeper via Wrench');
    expect(sourcesPage).toContain('Message Like Me owns zero');
    expect(renderedSourcesPage).toContain(
      'Wrench v0.16.3 uses beeper-local adapter v2.3.0',
    );
    expect(renderedSourcesPage).toContain(
      'Wrench exports. Message Like Me verifies.',
    );
    expect(renderedSourcesPage).toContain(
      '32 reviewed Beeper operations comprise 27 through the pinned Beeper CLI and 5 fixed Desktop reads',
    );
    expect(renderedSourcesPage).toContain(
      'The pinned executable reports v0.6.2. At that tag, packages/cli/package.json declares v0.6.1',
    );
    expect(renderedSourcesPage).toContain(
      'that source value is provenance only and never overrides the executable runtime identity',
    );
    expect(renderedSourcesPage).toContain(
      'Message Like Me owns zero of Wrench’s 32 reviewed Beeper operations',
    );
    expect(renderedSourcesPage).toContain(
      'no Beeper credential, live session, provider call, or send capability crosses the handoff',
    );
    expect(renderedSourcesPage).toContain(
      'Wrench’s separate internal bounded export',
    );
    expect(renderedSourcesPage).toContain(
      'does not expose Beeper’s raw export arguments or establish complete-history coverage',
    );
    expect(renderedSourcesPage).toContain('Current support in v0.8.0');
    expect(renderedSourcesPage).toContain(
      'wrench beeper export-message-like-me --auth &lt;id&gt; --output /absolute/private/path/beeper-bundle',
    );
    expect(renderedSourcesPage).toContain(
      'https://github.com/hraness/message-like-me/blob/v0.8.0/docs/local-message-bundle-v1.md',
    );
    expect(renderedSourcesPage).toContain(
      'wrench whatsapp export-message-like-me --auth &lt;id&gt; --output /absolute/private/path/whatsapp-bundle',
    );
    expect(renderedSourcesPage).toContain(
      'https://github.com/hraness/message-like-me/blob/v0.8.0/docs/local-message-bundle-v2.md',
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
      expect(copy).toContain(`beeper-local@${BEEPER_COMPATIBILITY.adapterVersion}`);
      expect(copy).toContain(`${BEEPER_COMPATIBILITY.reviewedOperationCount} reviewed Beeper operations`);
      expect(copy).toMatch(
        new RegExp(
          `${BEEPER_COMPATIBILITY.pinnedCliOperationCount} use the pinned\\s+CLI`,
          'u',
        ),
      );
      expect(copy).toMatch(
        new RegExp(
          `${BEEPER_COMPATIBILITY.fixedDesktopReadOperationCount} use fixed Desktop`,
          'u',
        ),
      );
      expect(copy).toContain(BEEPER_COMPATIBILITY.providerCliSourcePackagePath);
      expect(copy).toContain(`declares \`${BEEPER_COMPATIBILITY.providerCliSourceDeclaredVersion}\``);
      expect(copy).toMatch(/provenance\s+only/u);
      expect(copy).toContain('executable runtime identity');
      expect(copy).toMatch(/internal bounded\s+export/u);
      expect(copy).toContain('Message Like Me owns');
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
      `executable reports v${BEEPER_COMPATIBILITY.providerCliVersion}`,
      `bundle schema ${BEEPER_COMPATIBILITY.bundleSchemaVersion}`,
      BEEPER_COMPATIBILITY.sourceId,
      BEEPER_COMPATIBILITY.sourceTransformVersion,
    ]) {
      expect(renderedSourcesPage).toContain(coordinate);
    }
    for (const coordinate of [
      `Wrench v${BEEPER_COMPATIBILITY.producerVersion}`,
      `adapter ${BEEPER_COMPATIBILITY.adapterId} v${BEEPER_COMPATIBILITY.adapterVersion}`,
      `${BEEPER_COMPATIBILITY.reviewedOperationCount} Beeper operations`,
      `${BEEPER_COMPATIBILITY.pinnedCliOperationCount} use its pinned CLI ${BEEPER_COMPATIBILITY.providerCliVersion} executable`,
      `${BEEPER_COMPATIBILITY.fixedDesktopReadOperationCount} use fixed Desktop reads`,
      `${BEEPER_COMPATIBILITY.providerCliSourcePackagePath} value ${BEEPER_COMPATIBILITY.providerCliSourceDeclaredVersion} is provenance only`,
      'Message Like Me owns zero Beeper operations, provider credentials, or live sessions',
      'does not claim complete history',
    ]) {
      expect(llms).toContain(coordinate);
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
