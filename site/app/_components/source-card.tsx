import { SourceIcon } from './source-icon';
import type { SupportedSource } from '../_lib/sources';

export function SourceCard({ source }: { source: SupportedSource }) {
  return (
    <article className="source-card" id={source.id}>
      <div className="source-card-heading">
        <SourceIcon name={source.icon} />
        <div>
          <p className="source-kind">{source.kind}</p>
          <h3>{source.name}</h3>
        </div>
      </div>
      <div className="source-badges" aria-label={`${source.name} support status`}>
        <span>{source.status}</span>
        <span>{source.mode}</span>
      </div>
      <p className="source-summary">{source.summary}</p>
      <p className="source-boundary"><strong>Boundary:</strong> {source.boundary}</p>
      <code className="source-command">{source.command}</code>
    </article>
  );
}

