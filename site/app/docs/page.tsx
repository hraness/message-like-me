import { DocumentPage } from '../_components/document-page';
import { GITHUB_URL, pageMetadata } from '../_lib/site';
import { readmeHtml } from '../readme.generated';

const description =
  'Install and use the Message Like Me local-first CLI and Agent Skill, including private ingestion, evidence inspection, evaluation, and unsent drafting.';

export const metadata = pageMetadata({
  title: 'Documentation',
  description,
  path: '/docs',
});

export default function DocsPage() {
  return (
    <DocumentPage
      eyebrow="Documentation"
      title="Use Message Like Me"
      summary={description}
      path="/docs"
      html={readmeHtml}
      sourceUrl={`${GITHUB_URL}/blob/main/README.md`}
    />
  );
}
