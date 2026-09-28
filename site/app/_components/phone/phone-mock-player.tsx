'use client';

import { useEffect, useRef, useState } from 'react';

import type { Conversation, Perspective } from './conversations';
import { sideFor, type PlaybackPhase } from './messages-thread';
import { PhoneMock, type PhoneMockProps } from './phone-mock';

export interface PhoneMockPlayerProps extends Omit<PhoneMockProps, 'visibleCount' | 'typingId' | 'phase' | 'ref'> {
  /** Milliseconds the finished conversation holds before the loop restarts. */
  readonly holdMs?: number;
  /** Play once and stay on the final frame instead of looping. */
  readonly once?: boolean;
}

interface PlaybackState {
  readonly phase: PlaybackPhase;
  readonly visibleCount?: number;
  readonly typingId?: string;
}

const TYPING_MS = 1100;
const FADE_MS = 450;

type Step =
  | { readonly kind: 'wait'; readonly ms: number }
  | { readonly kind: 'typing'; readonly id: string }
  | { readonly kind: 'show'; readonly count: number };

/** Builds the playback timeline. Only people get typing dots; the butler never does. */
export function playbackSteps(conversation: Conversation, perspective: Perspective): Step[] {
  const steps: Step[] = [];
  const preset = conversation.preset ?? 0;
  conversation.items.forEach((item, index) => {
    if (index < preset) return;
    if (item.kind === 'header') {
      steps.push({ kind: 'wait', ms: 300 }, { kind: 'show', count: index + 1 });
      return;
    }
    steps.push({ kind: 'wait', ms: item.waitMs ?? 700 });
    const typedByAPerson = item.from !== 'butler' && sideFor(item.from, perspective) === 'in';
    if (typedByAPerson) steps.push({ kind: 'typing', id: item.id }, { kind: 'wait', ms: TYPING_MS });
    steps.push({ kind: 'show', count: index + 1 });
  });
  return steps;
}

/**
 * The phone mockup with scripted playback. It first renders the finished
 * conversation (identical to the static mock, so there is no flash and no layout
 * shift), and only when scrolled into view does it hold, crossfade to the start,
 * and play the messages in with iOS-like timing. Under `prefers-reduced-motion`
 * it never plays and shows the final frame. The phone's size never changes.
 */
export function PhoneMockPlayer({ holdMs = 2500, once = false, ...props }: PhoneMockPlayerProps) {
  const { conversation, perspective = 'owner' } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PlaybackState>({ phase: 'final' });

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const steps = playbackSteps(conversation, perspective);
    const preset = conversation.preset ?? 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let visible = false;

    const stop = () => {
      running = false;
      if (timer) clearTimeout(timer);
      timer = undefined;
      setState({ phase: 'final' });
    };
    const later = (ms: number, next: () => void) => {
      timer = setTimeout(() => {
        if (running) next();
      }, ms);
    };
    const run = (index: number, count: number) => {
      const step = steps[index];
      if (!step) {
        setState({ phase: 'hold', visibleCount: count });
        if (once) {
          running = false;
          return;
        }
        later(holdMs, cycle);
        return;
      }
      if (step.kind === 'wait') later(step.ms, () => run(index + 1, count));
      else if (step.kind === 'typing') {
        setState({ phase: 'playing', visibleCount: count, typingId: step.id });
        run(index + 1, count);
      } else {
        setState({ phase: 'playing', visibleCount: step.count });
        run(index + 1, step.count);
      }
    };
    function cycle() {
      setState((current) => ({ ...current, phase: 'fading' }));
      later(FADE_MS, () => {
        setState({ phase: 'playing', visibleCount: preset });
        run(0, preset);
      });
    }
    const start = () => {
      if (running || motion.matches || !visible || document.hidden) return;
      running = true;
      // The finished conversation is already on screen: hold it briefly, then loop.
      later(Math.min(holdMs, 1600), cycle);
    };
    const sync = () => {
      if (motion.matches || !visible || document.hidden) {
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
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      running = false;
      if (timer) clearTimeout(timer);
    };
  }, [conversation, perspective, holdMs, once]);

  return <PhoneMock {...props} ref={ref} visibleCount={state.visibleCount} typingId={state.typingId} phase={state.phase} />;
}
