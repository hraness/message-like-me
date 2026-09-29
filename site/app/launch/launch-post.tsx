import type { LaunchBeat } from '@hraness/design-kit/launch';
import { SocialKitPanel } from '@hraness/design-kit/react';
import { LaunchBeats } from '@hraness/design-kit/react/server';

import { DiagramFigure } from '../_components/landing/diagram-figure';
import { SURFACE_COMPONENTS, type SurfaceId, type ThreadApp } from '../mockups';
import { launchBeats, socialKit } from './beats';

/** One beat's one visual: a code-built mockup, or an exported diagram. */
function BeatVisual({ beat }: Readonly<{ beat: LaunchBeat }>) {
  const visual = beat.visual;
  switch (visual.kind) {
    case 'mockup': {
      const id = visual.id as SurfaceId;
      if (id === 'thread') {
        const Thread = SURFACE_COMPONENTS.thread;
        const app = (visual.state['app'] ?? 'messages') as ThreadApp;
        return <Thread app={app} play={app === 'messages'} />;
      }
      const Surface = SURFACE_COMPONENTS[id];
      if (Surface === undefined) throw new Error(`Beat ${beat.id} names an unknown mockup ${visual.id}.`);
      return <Surface />;
    }
    case 'diagram':
      return <DiagramFigure alt={beat.alt} name={visual.src} />;
    case 'clip':
      throw new Error(`Beat ${beat.id} names a clip; this post shows mockups and diagrams.`);
  }
}

/** The beats of "Introducing TextButler", each a short standalone section with one visual. */
export function LaunchPostBeats() {
  return <LaunchBeats beats={launchBeats} className="tb-launch-beats" renderVisual={(beat) => <BeatVisual beat={beat} />} />;
}

/** The copy-ready social posts cut from the beats. */
export function LaunchSocialKit() {
  return <SocialKitPanel kit={socialKit} summary="Social posts for this launch (X, Bluesky, Threads, LinkedIn, Product Hunt)" />;
}
