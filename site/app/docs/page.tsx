import { DocumentPage } from '../_components/document-page';
import { GITHUB_URL, pageMetadata } from '../_lib/site';
import { readmeHtml } from '../readme.generated';

const description =
  'Explore the Textbutler development architecture and the retained Message Like Me history tools, with current capability limits and verification commands.';

export const metadata = pageMetadata({
  title: 'Documentation',
  description,
  path: '/docs',
});

export default function DocsPage() {
  return (
    <DocumentPage
      eyebrow="Documentation"
      title="Textbutler"
      summary={description}
      path="/docs"
      html={readmeHtml}
      sourceUrl={`${GITHUB_URL}/blob/main/README.md`}
      dateModified="2026-09-11"
      sourceOwnsHeading
    />
  );
}
