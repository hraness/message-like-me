'use client';

import './pause.css';

import { useEffect, useMemo, useRef, useState } from 'react';

import { PhoneMock, type PhoneMockProps, type PlaybackPhase } from './phone-mock';
import { schedule } from './scene';

export interface PhoneMockPlayerProps extends Omit<PhoneMockProps, 'time' | 'phase' | 'ref'> {
  /** Milliseconds the finished conversation holds before the loop restarts. */
  readonly holdMs?: number;
  /** Play once and stay on the final frame instead of looping. */
  readonly once?: boolean;
  /** Render a Pause/Play button under the phone (WCAG 2.2.2). */
  readonly controls?: boolean;
}

interface PlaybackState {
  readonly phase: PlaybackPhase;
  readonly time?: number;
}

const FADE_MS = 450;
/** Seconds the history takes to undim after the last message (matches scene.ts). */
const SETTLE_S = 0.7;

/**
 * The phone mockup with scripted playback. It first renders the finished
 * conversation (identical to the static mock, so there is no flash and no layout
 * shift), and only when scrolled into view does it hold, crossfade to the start,
 * and play the scene's Textmock timeline. Under `prefers-reduced-motion` it
 * never plays and shows the final frame. The phone's size never changes.
 */
export function PhoneMockPlayer({ holdMs = 2500, once = false, controls = false, ...props }: PhoneMockPlayerProps) {
  const { conversation, perspective = 'owner' } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlaybackState>({ phase: 'final' });
  const [paused, setPaused] = useState(false);
  const end = useMemo(() => schedule(conversation, perspective).end, [conversation, perspective]);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    let running = false;
    let visible = false;

    const clear = () => {
      if (timer) clearTimeout(timer);
      if (frame !== undefined) cancelAnimationFrame(frame);
      timer = undefined;
      frame = undefined;
    };
    const stop = () => {
      running = false;
      clear();
      setState({ phase: 'final' });
    };
    const later = (ms: number, next: () => void) => {
      timer = setTimeout(() => {
        if (running) next();
      }, ms);
    };
    const play = () => {
      const started = performance.now();
      const tick = (now: number) => {
        if (!running) return;
        const seconds = (now - started) / 1000;
        if (seconds >= end + SETTLE_S) {
          setState({ phase: 'hold' });
          if (once) {
            running = false;
            return;
          }
          later(holdMs, cycle);
          return;
        }
        setState({ phase: seconds >= end ? 'hold' : 'playing', time: seconds });
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    };
    function cycle() {
      setState((current) => ({ ...current, phase: 'fading' }));
      later(FADE_MS, () => {
        setState({ phase: 'playing', time: 0 });
        play();
      });
    }
    const start = () => {
      if (running || paused || motion.matches || !visible || document.hidden) return;
      running = true;
      // The finished conversation is already on screen: hold it briefly, then loop.
      later(Math.min(holdMs, 1600), cycle);
    };
    const sync = () => {
      if (paused || motion.matches || !visible || document.hidden) {
        if (running) stop();
      } else start();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        sync();
      },
      { threshold: 0.45 },
    );
    observer.observe(node);
    if (paused) stop();
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      running = false;
      clear();
    };
  }, [end, holdMs, once, paused]);

  const phone = <PhoneMock {...props} ref={ref} time={state.time} phase={state.phase} />;
  if (!controls) return phone;
  return (
    <>
      {phone}
      <button aria-pressed={paused} className="tb-pause" onClick={() => setPaused((value) => !value)} type="button">
        Pause animation
      </button>
    </>
  );
}
