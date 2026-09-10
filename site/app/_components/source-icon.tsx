import type { SupportedSourceId } from '../_lib/sources';

function GhostgetMark() {
  return (
    <g data-mark-tool="ghostget">
      <path d="M40 23a9 9 0 1 0 1 14v-7h-8" />
    </g>
  );
}

function assertNever(sourceId: never): never {
  throw new Error(`Unsupported source icon: ${sourceId}`);
}

function SourceArtwork({ sourceId }: { sourceId: SupportedSourceId }) {
  switch (sourceId) {
    case 'apple-messages':
      return (
        <>
          <path d="M9 11h30v21H24l-8 6v-6H9Z" />
          <circle cx="17" cy="21.5" r="1.25" />
          <circle cx="24" cy="21.5" r="1.25" />
          <circle cx="31" cy="21.5" r="1.25" />
        </>
      );
    case 'beeper-via-ghostget':
      return (
        <>
          <g data-mark-provider="beeper">
            <rect x="7" y="10" width="18" height="12" rx="4" />
            <path d="M12 22v4l5-4" />
            <rect x="10" y="25" width="15" height="9" rx="3" />
          </g>
          <GhostgetMark />
        </>
      );
    case 'whatsapp-via-ghostget':
      return (
        <>
          <g data-mark-provider="whatsapp">
            <circle cx="16" cy="18" r="10" />
            <path d="m9 29 2-6" />
            <path d="M12 13c1 5 4 8 9 9l2-3-3-2-2 2c-2-1-3-2-4-4l2-2-2-3Z" />
          </g>
          <GhostgetMark />
        </>
      );
    case 'x-data-archive':
      return (
        <>
          <path d="M8 14h32v25H8Z" />
          <path d="M6 9h36v6H6Z" />
          <path d="m17 22 14 12M31 22 17 34" />
        </>
      );
    case 'macos-contacts':
      return (
        <>
          <path d="M11 8h27v32H11Z" />
          <path d="M11 14H7m4 8H7m4 8H7m4 8H7" />
          <circle cx="21" cy="19" r="4" />
          <path d="M15 31c0-4 2-6 6-6s6 2 6 6" />
          <path d="M31 17h4m-4 6h4m-4 6h4" />
        </>
      );
    default:
      return assertNever(sourceId);
  }
}

export function SourceIcon({ sourceId }: { sourceId: SupportedSourceId }) {
  return (
    <svg
      aria-hidden="true"
      className={`source-icon source-icon-${sourceId}`}
      data-source-mark={sourceId}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 48 48"
    >
      <SourceArtwork sourceId={sourceId} />
    </svg>
  );
}
