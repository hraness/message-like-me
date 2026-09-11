# Textbutler transport

Typed boundaries between the Textbutler daemon and its messaging provider.
Import `src/index.ts` for `TextbutlerTransport`, rich `ActionIntent` values,
`createGhostgetTransport`, and the private-output-verifying CLI invoker.

The daemon owns this port. Its agent-facing broker must bind each operation to
one enabled contact, format the bot attribution, and reject foreign contacts or
files before invoking it. Contact-relative file paths express an intent; the
file broker must bind them to owned bytes before a future attachment executor
can read them. This package never reads `chat.db` or Contacts directly.

## Existing Ghostget support

The adapter negotiates `imessage-direct` local CLI contract version 1 from
`ghostget capabilities imessage-direct --json`. It uses the existing
`messaging routes`, `messaging resolve`, `messaging context`, `messaging preview`,
and `confirm` commands. These commands preserve Ghostget's own permission,
provider identity, context freshness, and at-most-once dispatch checks.

`createGhostgetCliInvoker` receives an exact trusted Ghostget CLI source path
and admitted Bun executable. It does not discover executables or import another
checkout. Private inputs travel over stdin. Outputs use owner-only temporary
files, bounded process streams, SHA-256 artifact receipts, and exact run/binding
checks. Ambient credential and runtime-hook environment variables are removed.
Process failure after confirmation produces an indeterminate result; callers
must retain the Ghostget journal and never automatically repeat that send.

Route discovery returns short-lived opaque list candidates. Resolving a
candidate deliberately mints a **new** route reference; `history()` returns
this as its `conversationId`. Use that value and its `contextId` for `prepare()`.
The references expire and are capabilities, not persistent contact identities.
A bounded history window is not authoritative coverage and has no pagination
cursor in the current provider contract.

The installed contract supports text previews and exact owner-confirmed sends.
Native Contacts discovery, durable event cursors, contact-scoped delegation,
attachments, tapbacks, stickers, rich links, App Clips, and experiences return
explicit `unsupported` errors. Receiving an arbitrary rich intent never silently
converts it to a plain text message. `text` capability means an installed
executor; it does not attest a current account grant or live device readiness.
There is no automatic reply loop until the required event and scoped delegation
contracts exist and are negotiated.

## Upstream extension contract

Ghostget should own stable account/conversation bindings, OS access, Contacts
selection, ordered resumable incoming and owner-outgoing events, attachment
materialization, and provider-specific rich execution. Textbutler should own
contact activation, history initialization, conversational timing, model choice,
memory, hooks, attribution, and its action journal. Delegate explicit capability
names with exact account/contact bounds and revocable grant revisions. Upstream
permission denial always wins. Events need cursor expiry and history-gap
recovery; ambiguous sends need reconciliation, never implied safe retry.

Ghostget's native control helper is presently app-lifetime and offers separate
administrative stdio and approval/web-only agent IPC. Textbutler must not reuse
its administrative channel, claim its socket is a message event daemon, or
change Ghostget permissions through an agent-facing tool.

Ghostget still consumes the frozen Message Like Me `message-bundle-v1/v2`
package exports. Preserve those immutable artifacts. A later extraction into
an independent contract package can remove that historical dependency without
making Ghostget depend on the Textbutler application.

Provider evidence: [Ghostget iMessage contract](https://github.com/hraness/ghostget/blob/main/docs/imessage-direct-provider.md),
[native control architecture](https://github.com/hraness/ghostget/blob/main/docs/control-panel.md).
Linq's separate [message API](https://docs.linqapp.com/channel/imessage/api/resources/chats/subresources/messages/)
provides rich features but is not implemented or provisioned by this package.
Its app-card and App Clip behavior cannot be inferred as available through
Ghostget's AppleScript transport.

## Verify

```sh
bun test packages/transport
bunx tsc --noEmit -p packages/transport/tsconfig.json
```

All fixtures are synthetic. Tests neither inspect personal data nor send
messages. Live OS permission, upstream rich capability, and unattended daemon
qualification remain separate acceptance requirements.
