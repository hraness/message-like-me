'use client';

import { useId, useState, type ReactNode } from 'react';

export type DiagramOption = Readonly<{ label: string; caption: string; panel: ReactNode }>;

/**
 * Three pre-rendered diagram panels behind real toggle buttons. Hidden panels
 * keep their lazy images unloaded until chosen; without scripts the first
 * panel shows.
 */
export function DiagramSwitch({ options, label }: Readonly<{ options: readonly DiagramOption[]; label: string }>) {
  const [selected, setSelected] = useState(0);
  const captionId = useId();
  return (
    <div className="tb-switch">
      <div aria-label={label} className="tb-switch__buttons" role="group">
        {options.map((option, index) => (
          <button aria-controls={`${captionId}-${index}`} aria-pressed={index === selected} key={option.label} onClick={() => setSelected(index)} type="button">
            {option.label}
          </button>
        ))}
      </div>
      {options.map((option, index) => (
        <div hidden={index !== selected} id={`${captionId}-${index}`} key={option.label}>
          {option.panel}
        </div>
      ))}
      <p aria-live="polite" className="tb-switch__caption">{options[selected]?.caption}</p>
    </div>
  );
}
