import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Launch media and diagrams land in public/ from their own lanes. A slot shows
// its asset only when the file is really there, so the page never renders a
// broken image while an asset is still being made.
export function publicAssetExists(path: string): boolean {
  return existsSync(join(process.cwd(), 'public', path));
}

/** Expected launch files under public/. One place to rename them. */
export const LAUNCH_ASSETS = {
  poster: 'launch/textbutler-launch-poster.png',
  film: 'launch/textbutler-launch.mp4',
  loopWebm: 'launch/textbutler-hero-loop.webm',
  loopMp4: 'launch/textbutler-hero-loop.mp4',
} as const;

/** Diagram base names under public/diagrams/ (see diagram-figure.tsx for the file pattern). */
export const DIAGRAMS = {
  oneMessage: 'd1-one-message',
  whereWordsGo: 'd2-words-local',
  whoDoesWhat: 'd3-who-does-what',
  fiveChecks: 'd4-five-checks',
} as const;
