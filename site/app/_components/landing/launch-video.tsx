'use client';

import { useEffect, useRef, useState } from 'react';

import './launch-video.css';

type Sources = Readonly<{ poster: string; film: string }>;

/**
 * The launch film behind a still poster. Nothing moves until the reader
 * presses Play; then the real player takes focus so keyboard control carries on.
 */
export function LaunchVideo({ sources, title }: Readonly<{ sources: Sources; title: string }>) {
  const [playing, setPlaying] = useState(false);
  const film = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!playing) return;
    film.current?.focus();
    void film.current?.play().catch(() => undefined);
  }, [playing]);
  return (
    <div className="tb-video" data-playing={playing ? 'true' : 'false'}>
      {playing ? (
        <video aria-label={`Film: ${title}`} className="tb-video__media" controls playsInline poster={sources.poster} preload="auto" ref={film} src={sources.film} tabIndex={-1} />
      ) : (
        <button aria-label={`Play the film: ${title}`} className="tb-video__cover" onClick={() => setPlaying(true)} type="button">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" className="tb-video__media" decoding="async" loading="lazy" src={sources.poster} />
          <span className="tb-video__play">
            <svg aria-hidden="true" className="tb-video__play-glyph" height="14" viewBox="0 0 14 14" width="14"><path d="M3 1.8v10.4a.6.6 0 0 0 .9.5l8.4-5.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5Z" fill="currentColor" /></svg>
            <span>Play the film</span>
          </span>
        </button>
      )}
    </div>
  );
}
