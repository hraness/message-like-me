import { resolve } from 'node:path';
import { renderReadmeHtml } from './readme-html.ts';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');
const documents = [
  {
    source: 'README.md',
    output: 'app/readme.generated.ts',
    exportName: 'readmeHtml',
  },
  {
    source: 'docs/methodology.md',
    output: 'app/methodology.generated.ts',
    exportName: 'methodologyHtml',
  },
  {
    source: 'docs/research.md',
    output: 'app/research.generated.ts',
    exportName: 'researchHtml',
  },
] as const;

for (const document of documents) {
  const source = await Bun.file(resolve(repositoryRoot, document.source)).text();
  const html = renderReadmeHtml(source).replace(/^<h1>[\s\S]*?<\/h1>\n?/u, '');
  await Bun.write(
    resolve(siteRoot, document.output),
    `// Generated from ../${document.source} by scripts/sync-readme.ts.\nexport const ${document.exportName} = ${JSON.stringify(html)};\n`,
  );
}
