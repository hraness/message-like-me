// The first screen of the guided terminal on a fresh install, copied from
// terminalDashboard(null) in packages/textbutler/src/tui.ts. A site test keeps
// every line equal to that source.
export const TERMINAL_FIRST_RUN = [
  'TEXTBUTLER',
  'Your conversations, with you in control.',
  '',
  'Service not connected',
  'Start with Setup & readiness.',
  '',
  '  1  Setup & readiness',
  '  2  Connect messaging apps',
  '  3  Add a conversation',
  '  4  Inbox & replies',
  '  5  Manage a contact',
  '  6  Pause automatic replies',
  '  7  Resume automatic replies',
  '  8  Give TextButler access',
  '  q  Quit terminal',
  '',
  'Quitting leaves the background service running.',
] as const;
