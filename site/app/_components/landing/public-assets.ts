import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

// Launch media and diagrams land in public/ from their own lanes. A slot shows
// its asset only when the file is really there, so the page never renders a
// broken image while an asset is still being made.
export function publicAssetExists(path: string): boolean {
  return existsSync(join(process.cwd(), 'public', path));
}

/**
 * Pixel size of a PNG under public/, read from its IHDR header, so an image
 * can reserve its box before it loads and the page never jumps.
 */
export function publicPngSize(path: string): Readonly<{ width: number; height: number }> {
  const header = Buffer.alloc(24);
  const fd = openSync(join(process.cwd(), 'public', path), 'r');
  try {
    readSync(fd, header, 0, 24, 0);
  } finally {
    closeSync(fd);
  }
  if (header.toString('latin1', 12, 16) !== 'IHDR') throw new Error(`${path} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** Expected launch files under public/. One place to rename them. */
export const LAUNCH_ASSETS = {
  poster: 'launch/textbutler-launch-poster.webp',
  film: 'launch/textbutler-launch.mp4',
} as const;

/** The film's length, said in reader terms beside it. */
export const LAUNCH_FILM_SECONDS = 42;

/**
 * Sources for <LaunchVideo>, or null while the poster or film is missing, so
 * the homepage and the launch post show the film only once it really exists.
 */
export function launchFilmSources(): Readonly<{ poster: string; film: string }> | null {
  if (!publicAssetExists(LAUNCH_ASSETS.poster) || !publicAssetExists(LAUNCH_ASSETS.film)) return null;
  return {
    poster: `/${LAUNCH_ASSETS.poster}`,
    film: `/${LAUNCH_ASSETS.film}`,
  };
}

/** Diagram base names under public/diagrams/ (see diagram-figure.tsx for the file pattern). */
export const DIAGRAMS = {
  oneMessage: 'd1-one-message',
  whereWordsGo: 'd2-words-local',
  whereWordsGoKey: 'd2-words-key',
  whereWordsGoSubscription: 'd2-words-subscription',
  whoDoesWhat: 'd3-who-does-what',
  fiveChecks: 'd4-five-checks',
} as const;
