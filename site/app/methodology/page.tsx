import { DocumentPage } from '../_components/document-page';
import { GITHUB_URL, pageMetadata } from '../_lib/site';
import { methodologyHtml } from '../methodology.generated';

const description =
  'How Message Like Me measures local messaging behavior, bounds private evidence, separates deterministic metrics from judgment, and evaluates unsent drafts.';

export const metadata = pageMetadata({
  title: 'Methodology',
  description,
  path: '/methodology',
});

export default function MethodologyPage() {
  return (
    <DocumentPage
      eyebrow="Methodology"
      title="Methodology"
      summary={description}
      path="/methodology"
      html={methodologyHtml}
      sourceUrl={`${GITHUB_URL}/blob/main/docs/methodology.md`}
      sourceOwnsHeading
    />
  );
}
