import { resolve } from 'node:path';
import { renderReadmeHtml } from './readme-html.ts';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');
export function siteDocumentSource(sourcePath: string, source: string): string {
  if (sourcePath === '') throw new Error('Site document source path must not be empty');
  return source;
}

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

if (import.meta.main) {
  for (const document of documents) {
    const source = await Bun.file(resolve(repositoryRoot, document.source)).text();
    const html = renderReadmeHtml(siteDocumentSource(document.source, source));
    await Bun.write(
      resolve(siteRoot, document.output),
      `// Generated from ../${document.source} by scripts/sync-readme.ts.\nexport const ${document.exportName} = ${JSON.stringify(html)};\n`,
    );
  }
}
