'use client';

import { useEffect, useRef, useState } from 'react';

type Sources = Readonly<{ poster: string; film: string; loopWebm?: string; loopMp4?: string }>;

/**
 * A muted, looping preview that becomes the full film on click. Under reduced
 * motion the preview never plays; the poster and the Play button stay.
 */
export function LaunchVideo({ sources, title }: Readonly<{ sources: Sources; title: string }>) {
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(true);
  const film = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (playing) void film.current?.play().catch(() => undefined);
  }, [playing]);
  const hasLoop = sources.loopWebm !== undefined || sources.loopMp4 !== undefined;
  return (
    <div className="tb-video" data-playing={playing ? 'true' : 'false'}>
      {playing ? (
        <video className="tb-video__media" controls playsInline poster={sources.poster} preload="auto" ref={film} src={sources.film} />
      ) : (
        <button aria-label={`Play the film: ${title}`} className="tb-video__cover" onClick={() => setPlaying(true)} type="button">
          {hasLoop && !reduced ? (
            <video aria-hidden="true" autoPlay className="tb-video__media" loop muted playsInline poster={sources.poster} preload="metadata" tabIndex={-1}>
              {sources.loopWebm === undefined ? null : <source src={sources.loopWebm} type="video/webm" />}
              {sources.loopMp4 === undefined ? null : <source src={sources.loopMp4} type="video/mp4" />}
            </video>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="tb-video__media" decoding="async" loading="lazy" src={sources.poster} />
          )}
          <span className="tb-video__play">
            <span aria-hidden="true" className="tb-video__play-glyph">▶</span>
            <span>Play the film</span>
          </span>
        </button>
      )}
    </div>
  );
}
