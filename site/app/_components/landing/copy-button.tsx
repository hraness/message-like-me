'use client';

import { useEffect, useState } from 'react';

/**
 * Copies one fixed string. It is a plain button: the page never collects or
 * submits anything, so there is no form, input, or textarea here.
 */
export function CopyButton({ text, label = 'Copy' }: Readonly<{ text: string; label?: string }>) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = window.setTimeout(() => setState('idle'), 2200);
    return () => window.clearTimeout(timer);
  }, [state]);
  return (
    <button
      className="tb-copy"
      data-state={state}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setState('copied'), () => setState('failed'));
      }}
      type="button"
    >
      <span aria-hidden="true" className="tb-copy__glyph">{state === 'copied' ? '✓' : '⧉'}</span>
      <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}</span>
      <span aria-live="polite" className="tb-visually-hidden">{state === 'copied' ? 'Prompt copied to the clipboard.' : ''}</span>
    </button>
  );
}
