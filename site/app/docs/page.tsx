import { DocumentPage } from '../_components/document-page';
import { GITHUB_URL, pageMetadata } from '../_lib/site';
import { readmeHtml } from '../readme.generated';

const description =
  'Set up Textbutler with your coding agent, connect iMessage, WhatsApp, or Beeper, pick what writes replies, and turn the butler on for one person.';

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
      dateModified="2026-09-28"
      sourceOwnsHeading
    />
  );
}
