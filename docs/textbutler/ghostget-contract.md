# GhostGet integration contract

This reference describes the protocol TextButler uses to talk to GhostGet.
TextButler decides reply policy and keeps contact memory. GhostGet handles
messaging accounts, native permissions, sync, event storage, and sending.
TextButler runs its own GhostGet process through
`ghostget messaging automation serve --stdio`; it doesn't share another GhostGet
process's private helper or open provider databases.

The automation protocol first shipped in
[GhostGet 0.18.2](https://github.com/hraness/ghostget/releases/tag/v0.18.2).
Native `TextButler.app` iMessage setup requires exactly GhostGet 0.18.71;
earlier releases lack the reviewed group-conversation extension. Install or
update GhostGet, check the configured executable with `--version`, and restart
or reconnect TextButler's GhostGet host so it negotiates capabilities again.
Testing against that exact release build and live conversations is still
pending. The required version keeps the native helper's resource bundle intact,
doesn't open unrelated protected folders while it checks its state, and reports
limited discovery diagnostics without message bodies. Native chat rows without
usable participant information are left out of partial discovery results, so
they can never become send targets. Follow the
[current setup guide](getting-started.md#give-textbutler-access-to-imessage).
Installation is a deliberate step and starts no provider. Older generic CLI
routes never become automation grants.

## Owner process

The private protocol is `ghostget.messaging-automation/1`. Every JSON request
has a size limit, an ID, a method, and parameters. Every response repeats its
protocol and ID and carries either a checked result or a typed error.
Initialization names up to two accounts, one per network, through stdin.
Contact memory and model tools cannot configure that process or call its
control API.

TextButler records that it owns the process before launching it, and limits its
streams and queue. It drops that record only after a successful close response
and a verified clean process exit. Cancellation and revocation can interrupt a
send in progress. After a malformed response, a crash, or uncertain cleanup,
TextButler keeps blocking the process until it is recovered, and restarting
TextButler doesn't clear that block.

## Contacts, events and grants

| Methods | What they do |
| --- | --- |
| `status`, `start` | Observe capabilities; explicitly start supported synchronization. |
| `conversations`, `enroll`, `enrollments` | Exact account generation and participant-bound direct or group enrollment. |
| `poll`, `pollSet`, `history`, `events` | Limited history, durable observation cursors, revisions, catch-up and gap detection; `pollSet` shares one provider session across a contact set and reports each enrollment separately. An enrollment busy with another operation reports its current stored row, which may not have synced on this poll. |
| `grant`, `grant.get`, `grant.by-intent`, `revoke` | Recipient, action, expiry and quota limits; idempotent issuance lookup and immediate revocation. |
| `asset`, `prepare` | Accept exact attachment bytes and bind the ordered action list to a context revision and expiry. |
| `submit`, `cancel`, `run` | Journal an action claim before dispatch and retain accepted, failed, partial or indeterminate results. |
| `close` | Wait for owned provider cleanup before acknowledging shutdown. |

Enrollment records contain the provider account incarnation, source generation,
implementation identity, exact conversation coordinate, and participants.
Display titles are only labels and grant nothing. Replacing the account or a
participant invalidates the binding. Existing TextButler version 1 read bindings remain readable;
automation requires explicit version 2 enrollment.

GhostGet's managed permissions must allow each requested operation. Advertising
a capability doesn't create a grant. When a contact is turned on, TextButler
issues a limited grant only after checking the selected agent account and
conversation. It renews standing enabled-contact grants within their limits,
and persists grant intent before issuance so a lost response can be resolved
without blindly creating another grant. Disabled and uncommitted grants are
reconciled through revocation.

Startup, re-enablement and recovery drain old events silently. An unresolved gap
pauses automation. TextButler waits for a new eligible inbound event and applies
debounce, owner cooldown, classification and rate limits. GhostGet rechecks
identity, permission, context and grant before dispatch, and observes intervening
conversation changes between actions. Neither component retries an uncertain
send automatically.

## Group-conversation extension

The `ghostget.messaging-automation/1` envelope and existing direct-conversation binding bytes stay unchanged. A read-only `features` request with `{}` returns exactly `{ "groupConversations": { "version": 1 } }` or `{ "groupConversations": null }`. An explicit `invalid-request` rejection of this method means no group extension was negotiated. Malformed responses and other failures remain capability-check errors. The owner's discovery view can still list independently verified direct conversations while reporting that group discovery is unavailable. It does not infer group support from a failed check.

After negotiating version 1, TextButler may pass `includeGroups: true` to `conversations` and `enrollments`. Without that field, both lists retain their direct-only behavior, including when groups have already been enrolled by a newer client. The extension permits `kind: "group"` with one to 500 unique, complete participant identities and canonical WhatsApp group JIDs. A WhatsApp group JID cannot be represented as a direct conversation or vice versa. Discovery is not enrollment or send authority: selection, validation, revision checks, recipient-bound plans and owner grants still apply. Older clients and legacy local binding version 1 remain direct-only.

Group enrollment establishes a silent provider cursor baseline. Historical bodies, historical backfill and edits to pre-enrollment messages never become group context. Group `history` and `history.window` read only messages recorded under that enrollment's post-baseline membership. Direct conversation history is unchanged.

TextButler also stores a trusted local `historyStart` ISO timestamp on each version 2 group binding, set immediately before enrollment. It suppresses group historical bootstrap and excludes earlier messages from prompts, observations, recent history, summaries and read tools. This local clock floor complements the provider cursor and message-ID boundary; it cannot establish membership provenance by itself.

A permanently invalidated enrollment retains its original digest and returns `ready: false` with reason `ghostget.binding-changed.v1`. TextButler cancels pending work, disables and revokes its grant, and persists `invalidated: true` on the group binding. Restoring the old membership never revives that binding. Re-enrollment requires a new upstream ID and a new empty workspace, even if the participant set matches an older invalidated group.

## Rich actions

Attachments, reactions, stickers, rich links and native polls are separate
capabilities. Each is available only when the installed provider, the current
account, and the managed permission all allow it. Message targets must belong to the
enrolled conversation. Attachment and sticker paths are resolved by TextButler's
contact file broker; GhostGet receives checked bytes, never arbitrary paths.

Every response starts with disclosed text while disclosure markers remain
configured. For a nontext response, TextButler inserts a companion such as
`🤖{ … }` before the rich actions; when the owner clears all three disclosure
fields no companion is added and butler authorship is carried by the accepted
message IDs the run's result returns to TextButler's journal instead of by
visible text. Execution stops when an earlier action fails or the conversation
changes. An accepted result doesn't mean the message was delivered.

Native iMessage exposes text and files through the pinned helper and its
currently usable rich methods for six standard tapbacks, stickers, links and
polls. Rich methods require the owner's separately configured native bridge.
App Clips and arbitrary mini-app experiences remain unavailable: no reviewed
native executor exists. Linq's hosted APIs are a design reference and cannot
silently substitute another sender for the owner's personal conversation.

## What the tests cover

Source tests with simulated accounts cover account changes, cursor restarts and
gaps, grant revocation and lost responses, exact attachment bytes, ordered
actions, cancellation, and uncertain results. They don't show live delivery. A
live test needs the owner's approval for the account, the recipient, and the
message, and must record the exact provider and runtime versions.
See [WhatsApp](whatsapp.md) and [the architecture](architecture.md).
