import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { SOCIAL_IMAGE_ALT } from './_lib/site';

export const alt = SOCIAL_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The card is drawn in code on /stills (the headline beside the same phone the
// home page shows) and captured to public/og.png by `bun run stills`. This
// route serves those bytes so every page's preview matches the site.
export default async function OpenGraphImage() {
  const png = await readFile(join(process.cwd(), 'public', 'og.png'));
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': contentType } });
}
