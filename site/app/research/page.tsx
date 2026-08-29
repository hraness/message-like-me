import { DocumentPage } from '../_components/document-page';
import { GITHUB_URL, pageMetadata } from '../_lib/site';
import { researchHtml } from '../research.generated';

const description =
  'Primary research and open-source prior art behind Message Like Me, with explicit limits on personalization, privacy, authorship, and digital-clone claims.';

export const metadata = pageMetadata({
  title: 'Research and prior art',
  description,
  path: '/research',
});

export default function ResearchPage() {
  return (
    <DocumentPage
      eyebrow="Research"
      title="Research and prior art"
      summary={description}
      path="/research"
      html={researchHtml}
      sourceUrl={`${GITHUB_URL}/blob/main/docs/research.md`}
      sourceOwnsHeading
    />
  );
}
