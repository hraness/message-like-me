import { pageMetadata } from '../../_lib/site';
import { socialImageAltFor } from '../../_lib/social';
import { ComparisonPage } from '../_components/comparison-page';
import { comparisonBySlug, comparisonSocialImagePath } from '../_lib/comparisons';

const comparison = comparisonBySlug('poke');

export const metadata = pageMetadata({
  title: comparison.title,
  description: comparison.description,
  path: comparison.path,
  image: { path: comparisonSocialImagePath(comparison.path), alt: socialImageAltFor(comparison.card) },
});

export default function Page() {
  return <ComparisonPage comparison={comparison} />;
}
