export const BEEPER_COMPATIBILITY = Object.freeze({
  producer: 'Ghostget',
  producerVersion: '0.17.1',
  adapterId: 'beeper-local',
  adapterVersion: '2.4.0',
  reviewedOperationCount: 32,
  pinnedCliOperationCount: 26,
  fixedDesktopReadOperationCount: 6,
  providerCliVersion: '0.6.2',
  providerCliSourcePackagePath: 'packages/cli/package.json',
  providerCliSourceDeclaredVersion: '0.6.1',
  bundleSchemaVersion: '1',
  sourceId: 'beeper-local',
  sourceTransformVersion: '1.1.0',
  exportBoundary: 'internal-bounded',
} as const);

export const WHATSAPP_COMPATIBILITY = Object.freeze({
  producer: 'Ghostget',
  producerVersion: '0.17.1',
  providerCli: 'Wacli',
  providerCliVersion: '0.15.0',
  bundleSchemaVersion: '2',
  sourceId: 'wacli-local',
  sourceTransformVersion: '1.0.0',
  providerId: 'whatsapp',
  network: 'whatsapp',
  reactionState: 'unproven-omitted',
  reactionWarning: 'reaction-state-unproven',
} as const);

export type SourceKind = 'Messaging history' | 'Label enrichment';
export type SupportedSourceId =
  | 'apple-messages'
  | 'beeper-via-ghostget'
  | 'whatsapp-via-ghostget'
  | 'x-data-archive'
  | 'macos-contacts';

export type SupportedSource = Readonly<{
  id: SupportedSourceId;
  name: string;
  kind: SourceKind;
  mode: string;
  status: 'Supported';
  summary: string;
  boundary: string;
  command: string;
}>;

export const SUPPORTED_SOURCES = Object.freeze([
  {
    id: 'apple-messages',
    name: 'Apple Messages',
    kind: 'Messaging history',
    mode: 'Native · read-only',
    status: 'Supported',
    summary:
      'Reads a stable private copy of the current macOS user’s iMessage database.',
    boundary:
      'Message Like Me never modifies Messages, chat.db, or its transactional sidecars.',
    command: 'messagelikeme ingest imessage',
  },
  {
    id: 'beeper-via-ghostget',
    name: 'Beeper via Ghostget',
    kind: 'Messaging history',
    mode: 'Bounded local bundle',
    status: 'Supported',
    summary:
      'Adds a finished Beeper bundle from Ghostget v0.17.1 and adapter 2.4.0 to the private local evidence corpus.',
    boundary:
      'All 32 reviewed operations stay in Ghostget: 26 through one pinned Beeper CLI 0.6.2 executable, including supported actions and writes, plus six fixed Desktop loopback reads. Message Like Me receives no provider credentials, calls no Ghostget or Beeper operation, never sends, and does not claim complete history.',
    command: 'messagelikeme ingest bundle --input /absolute/private/bundle',
  },
  {
    id: 'whatsapp-via-ghostget',
    name: 'WhatsApp via Ghostget',
    kind: 'Messaging history',
    mode: 'Native · bounded local bundle',
    status: 'Supported',
    summary:
      'Ingests one native WhatsApp linked-device observation exported by Ghostget through official Wacli.',
    boundary:
      'Ghostget omits reaction-shaped rows when Wacli cannot prove current state; Message Like Me verifies the finished bundle and never operates WhatsApp.',
    command: 'messagelikeme ingest bundle --input /absolute/private/whatsapp-bundle',
  },
  {
    id: 'x-data-archive',
    name: 'X data archive',
    kind: 'Messaging history',
    mode: 'Caller-owned archive',
    status: 'Supported',
    summary:
      'Reads supported direct-message entries from a private X archive ZIP without extracting it.',
    boundary:
      'This path covers archive DMs, not X Chat, and never accesses X or downloads media.',
    command: 'messagelikeme ingest x-archive --input /absolute/private/archive.zip',
  },
  {
    id: 'macos-contacts',
    name: 'macOS Contacts',
    kind: 'Label enrichment',
    mode: 'Optional · read-only',
    status: 'Supported',
    summary:
      'Adds private local names to exact email and phone matches across direct conversations.',
    boundary:
      'Contacts supplies labels only; it is not messaging history and ambiguous matches stay separate.',
    command: 'messagelikeme ingest contacts',
  },
] as const satisfies readonly SupportedSource[]);

export const MESSAGING_HISTORY_SOURCES = Object.freeze(
  SUPPORTED_SOURCES.filter((source) => source.kind === 'Messaging history'),
);
