import { resolve } from 'node:path';
import { renderReadmeHtml } from './readme-html.ts';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');
const readmePath = resolve(repositoryRoot, 'README.md');
const outputPath = resolve(siteRoot, 'app/readme.generated.ts');

const source = await Bun.file(readmePath).text();
const html = renderReadmeHtml(source);

await Bun.write(
  outputPath,
  `// Generated from ../README.md by scripts/sync-readme.ts.\nexport const readmeHtml = ${JSON.stringify(html)};\n`,
);
