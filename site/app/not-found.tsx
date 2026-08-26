import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteFooter, SiteHeader } from './_components/site-chrome';

export const metadata: Metadata = {
  title: { absolute: 'Page not found | Message Like Me' },
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="not-found" id="main-content" tabIndex={-1}>
        <p className="eyebrow">404</p>
        <h1>That page is not here.</h1>
        <p>The checked documentation and project pages are still available.</p>
        <Link className="button button-primary" href="/">Return home →</Link>
      </main>
      <SiteFooter />
    </>
  );
}
