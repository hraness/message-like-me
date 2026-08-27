import type { SourceIconName } from '../_lib/sources';

export function SourceIcon({ name }: { name: SourceIconName }) {
  return (
    <span aria-hidden="true" className={`source-icon source-icon-${name}`}>
      <span />
    </span>
  );
}
