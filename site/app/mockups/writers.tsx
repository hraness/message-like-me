'use client';

import { TerminalFrame } from '@hraness/design-kit/mockups';
import { StepThrough } from '@hraness/design-kit/mockups/client';

import { WRITERS, type WriterId } from './samples';

/** The three reply writers as a step-through: the commands for each, and where your words go. */
export function WritersShowcase({ initial = 'local' }: Readonly<{ initial?: WriterId }>) {
  return (
    <StepThrough
      fit="fill"
      initial={initial}
      label="Reply writers"
      steps={WRITERS.map((writer) => ({
        id: writer.id,
        label: writer.label,
        hint: writer.hint,
        render: () => (
          <TerminalFrame
            density="presentation"
            describe={`Illustration: setting up ${writer.label.toLowerCase()} as the reply writer. ${writer.where}`}
            lines={[
              ...writer.commands.map((text) => ({ kind: 'input' as const, text })),
              { kind: 'comment' as const, text: writer.where },
            ]}
            title="Terminal"
          />
        ),
      }))}
    />
  );
}
