import { resolve } from 'node:path';
import { renderReadmeHtml } from './readme-html.ts';

const siteRoot = resolve(import.meta.dir, '..');
const repositoryRoot = resolve(siteRoot, '..');
export const SKILLS_SH_README_BADGE =
  '[![skills.sh](https://skills.sh/b/hraness/message-like-me)](https://skills.sh/hraness/message-like-me)';

export function siteDocumentSource(sourcePath: string, source: string): string {
  if (sourcePath !== 'README.md') return source;
  const badgeBlock = `${SKILLS_SH_README_BADGE}\n\n`;
  if (!source.includes(badgeBlock)) {
    throw new Error('README.md must contain the official skills.sh repository badge');
  }
  return source.replace(badgeBlock, '');
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
    const html = renderReadmeHtml(siteDocumentSource(document.source, source))
      .replace(/^<h1>[\s\S]*?<\/h1>\n?/u, '');
    await Bun.write(
      resolve(siteRoot, document.output),
      `// Generated from ../${document.source} by scripts/sync-readme.ts.\nexport const ${document.exportName} = ${JSON.stringify(html)};\n`,
    );
  }
}
