import { resolve } from 'node:path';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');
const readmePath = resolve(repositoryRoot, 'README.md');
const outputPath = resolve(siteRoot, 'app/readme.generated.ts');

const source = await Bun.file(readmePath).text();
const html = Bun.markdown
  .html(source)
  .replaceAll(
    'href="SECURITY.md"',
    'href="https://github.com/hraness/message-like-me/blob/main/SECURITY.md"',
  );

await Bun.write(
  outputPath,
  `// Generated from ../README.md by scripts/sync-readme.ts.\nexport const readmeHtml = ${JSON.stringify(html)};\n`,
);
