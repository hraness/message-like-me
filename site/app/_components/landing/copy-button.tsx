'use client';

import { useEffect, useState } from 'react';

import { captureInstallCopied } from '../analytics';

/**
 * Copies one fixed string. It is a plain button: the page never collects or
 * submits anything, so there is no form, input, or textarea here.
 */
export function CopyButton({ text, label = 'Copy', analyticsTarget }: Readonly<{ text: string; label?: string; analyticsTarget?: string }>) {
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
        // Insecure pages and some in-app browsers have no clipboard API.
        if (typeof navigator.clipboard?.writeText !== 'function') {
          setState('failed');
          return;
        }
        void navigator.clipboard.writeText(text).then(() => {
          setState('copied');
          if (analyticsTarget !== undefined) captureInstallCopied(analyticsTarget);
        }, () => setState('failed'));
      }}
      type="button"
    >
      <svg aria-hidden="true" className="tb-copy__glyph" height="14" viewBox="0 0 14 14" width="14">{state === 'copied' ? <path d="m2.5 7.5 3 3 6-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /> : <><rect fill="none" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" width="8" x="4.5" y="4.5" /><path d="M9.5 2.5h-6a1 1 0 0 0-1 1v6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" /></>}</svg>
      <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Select and copy' : label}</span>
      <span aria-live="polite" className="tb-visually-hidden">{state === 'copied' ? 'Prompt copied to the clipboard.' : ''}</span>
    </button>
  );
}
