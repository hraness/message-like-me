import { DocumentPage } from '../_components/document-page';
import { GITHUB_URL, pageMetadata } from '../_lib/site';
import { methodologyHtml } from '../methodology.generated';

const description =
  'Legacy evidence methodology: how Message Like Me measures local messaging behavior, bounds private evidence, separates deterministic metrics from judgment, and evaluates unsent drafts.';

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
      dateModified="2026-08-27"
      legacyNote="This is legacy Message Like Me research, retained as background for Textbutler’s contact memory. It describes history analysis and unsent drafts; it does not document the new daemon’s live messaging capabilities."
      sourceOwnsHeading
    />
  );
}
