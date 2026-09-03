# Local message bundle version 1

`message-like-me.local-message-bundle` is a private directory interchange for
moving a bounded local provider observation into Message Like Me. It separates
provider capture from analysis: a producer handles provider access and writes
the bundle, while `messagelikeme ingest bundle` verifies and normalizes it. The
importer never receives provider credentials, starts Wrench, invokes a Beeper
operation, or sends a message.

The currently verified producer is the local Beeper export in the
[`@hraness/wrench@0.16.4`](https://www.npmjs.com/package/@hraness/wrench/v/0.16.4)
npm package:

```sh
bun add --global @hraness/wrench@0.16.4
wrench beeper export-message-like-me \
  --auth <beeper-auth-id> \
  --output <normalized-absolute-new-directory> \
  [--limit-chats <n>] \
  [--limit-messages <n>] \
  [--max-participants <n>] \
  [--json]
```

The JSON shape is published as
[`schema/local-message-bundle-v1.schema.json`](../schema/local-message-bundle-v1.schema.json).
Runtime validation also enforces UTF-8 byte bounds, canonical encoding,
filesystem identity, graph joins, and digest laws that JSON Schema cannot
express.

## Compatibility coordinates

Message Like Me accepts schema version `1` with source ID `beeper-local` and
source-transform version `1.1.0`. Wrench v0.16.4 emits those coordinates through
adapter `beeper-local@2.3.0`. That adapter has 32 reviewed Beeper operations:
27 use the pinned CLI and 5 use fixed Desktop loopback reads. The Message
Like Me bundle is made by Wrench's separate internal bounded export, not by a
Message Like Me provider operation. It fixes the raw export arguments, excludes
attachments, and preserves incomplete-coverage evidence. It does not claim a
complete Beeper history.

The pinned Beeper CLI executable reports version `0.6.2`. At the corresponding
source tag, `packages/cli/package.json` declares `0.6.1`; that source value is
provenance only and never overrides executable runtime identity. A later Wrench
package release remains compatible only while its manifest still declares the
same bundle schema, source ID, and `source.version: "1.1.0"`. Package age,
adapter version, or a permissive package range never overrides those manifest
coordinates. The provider version records the pinned Beeper CLI used for
capture and may change without changing the bundle contract.

Message Like Me owns zero Beeper operations, credentials, or live sessions. It
does not start Wrench, call the provider, or support sending. Its authority
begins at strict verification of the already finished private directory.

The dependency-free package subpath is the executable contract authority for
producers and consumers:

```ts
import {
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
  parseLocalMessageBundleV1Manifest,
  parseLocalMessageBundleV1Record,
} from "@hraness/message-like-me/message-bundle-v1"
```

It exports the exact readonly record and manifest types, fixed artifact
inventory, safety bounds, compatibility constants, canonical bundle-digest
helpers, and strict pure parsers. Those parsers operate on already decoded
unknown values and perform no filesystem, credential, provider, network, AI,
analytics, or message-sending work. The CLI adds private filesystem and graph
validation around the same parsers.

## Directory inventory

The input is a normalized absolute path to a current-user-owned physical
directory with mode `0700`. It contains exactly these mode-`0600`, singly
linked physical files:

```text
manifest.json
accounts.ndjson
participants.ndjson
conversations.ndjson
messages.ndjson
reactions.ndjson
tombstones.ndjson
```

The six artifacts always exist, including when they are empty. Every artifact
uses canonical JSON, one object per line, and one final newline per record.
Empty artifacts contain zero bytes. `manifest.json` is canonical JSON followed
by one newline and is written last by the producer.

The importer rejects symbolic links, extra files, ownership or mode changes,
files that change while read, invalid UTF-8, noncanonical JSON, blank records,
missing final newlines, count or byte mismatches, and digest mismatches.

## Bounds

Version one has these hard importer and producer ceilings:

- 128 connected accounts;
- 500,000 records across all six artifacts;
- 512 MiB across all six artifacts;
- 2 MiB for one encoded NDJSON record, including its final newline;
- 1 MiB of UTF-8 for one message body;
- 1,024 UTF-8 bytes for an identifier, sort key, or provider revision;
- 8 KiB of UTF-8 for a display name, handle, title, reaction body, or
  attachment filename;
- 256 UTF-8 bytes for an attachment MIME type;
- 10,000 known participants in one conversation;
- 256 attachment metadata items in one message; and
- 128 unique categorical warning codes.

Custom producer limits may only lower the total record, byte, and line bounds.
All timestamps are canonical millisecond UTC strings equal to
`Date#toISOString()` output. Identifiers are nonempty and contain no ASCII
control characters. Network and warning values are bounded lowercase tokens.

## Manifest integrity

The manifest declares source and provider versions, collection timestamps,
completeness, privacy guarantees, per-kind counts, and each artifact's exact
record count, byte length, and lowercase SHA-256.

Artifact SHA-256 covers the file's exact bytes, including every final newline.
Artifacts appear in the fixed directory order shown above. The bundle digest
is:

```text
SHA256(UTF8(canonicalJson(manifest with the entire integrity property omitted)))
```

The manifest file's own SHA-256 covers its exact canonical bytes plus final
newline. It is returned by the producer and recorded by Message Like Me, but is
not embedded in the manifest.

The privacy declaration is fixed to `private-local`, `metadata-only`
attachments, excluded provider URLs, and excluded credentials. This is an
interchange constraint, not anonymization. Bodies, timestamps, handles,
account coordinates, and relationship graphs remain private.

## Account realms and provenance

Every line has `schemaVersion`, `kind`, a bundle-local `id`, `accountId`,
`network`, and provenance:

- `providerId` is the stable provider coordinate for that entity;
- `providerRevision` preserves a provider revision when one exists;
- `observedAt` records when the producer observed this record; and
- `connectedAccountProviderId` is the stable connected-account coordinate.

An account line has `id === accountId` and
`provenance.providerId === provenance.connectedAccountProviderId`. Every other
record must match one account line on `accountId`, `network`, and connected
account coordinate. Bundle-local IDs exist only for joins inside this one
bundle. Message Like Me derives its stored source and entity IDs from stable
provider, connected-account, and self-participant coordinates with a private
per-install HMAC key. The mutable network label is source metadata and never
part of that identity namespace.

Provider IDs must be unique within one entity kind and account. Validation
errors name the record kind and ordinal, never the foreign coordinate. Message
and reaction provider IDs are independent domains and may contain the same
value. Message Like Me assigns a separate internal timeline coordinate when a
dated reaction is represented in the normalized messages table; the raw
reaction coordinate remains in the reaction fact and private provenance.

## Identity and conversation rosters

Each account names one self participant. Participants carry optional display
names and handles plus `isSelf`. Conversations carry their known participant
IDs and `participantsComplete`:

- `true` is the only positive assertion that the roster is complete;
- `false` or `null` means the producer cannot assert completeness; and
- a complete direct roster must contain exactly the account's one self
  participant and one non-self participant.

Message senders and reaction actors must agree with direction and any complete
roster. Message Like Me may expose an exact email or E.164 handle from the one
non-self participant of a complete direct conversation to local Contacts
matching. It never uses an incomplete roster for that join.

## Messages, replies, and attachments

`sentAt` is the message's actual temporal coordinate. `sortKey` is an opaque
provider ordering key. Within one account and conversation, Message Like Me
orders lexical `sortKey`, then `sentAt` and stable provider ID as deterministic
tie-breakers.

`bodyTruncated: true` means the body cannot be prose evidence. The record still
becomes a text bubble for tempo, reply, and response-shape analysis. A message
with deletion state must have a null body. Attachment entries contain metadata
only; they never contain paths, URLs, or media bytes.

A reply target has a required provider ID and an optional bundle-local ID. When
the local ID is present, it must resolve to the same provider coordinate in the
same account and conversation. A null local ID preserves a reply to a message
outside the bounded artifact.

## Edits and deletion

Edits are discriminated:

- `in-place` records a terminal mutation under the same provider message ID and
  never suppresses that message; and
- `replacement` identifies a different provider message in the same account
  and conversation.

Replacement targets may be outside the bounded artifact. In-bundle targets
must agree on local and provider coordinates. Replacement graphs must be
non-self, single-terminal, and acyclic. A validated replacement suppresses the
older version as evidence.

Message deletion state is explicit and carries the observation time and
provider revision. Deleted bodies are null.

## Reactions and tombstones

A reaction has a required target provider message ID and an optional
bundle-local target. When present, the local target must resolve to the same
provider coordinate. `reactedAt` is nullable because the provider may not
expose a reaction time. Producers never synthesize one. Active undated
reactions contribute to fixed aggregate reaction counts, direction counts, and
timestamp-coverage counts but never enter the message timeline, sessions,
bursts, response episodes, or latency metrics.

Tombstones identify a conversation, message, or reaction kind, required
provider coordinate, optional bundle-local coordinate, deletion time, scope,
and provider revision. Account and participant tombstones are outside the
version-one contract. A nonnull local coordinate must resolve inside the same
account and agree with
the provider coordinate. A null coordinate preserves deletion knowledge for
an entity outside the bounded artifact.

## Reimport semantics

Version-one bundle completeness is `bounded-local`, `truncated`, or `unknown`.
None is authoritative for deletion by absence. Reimport therefore upserts
present records and retains prior records omitted by a later bundle. Explicit
message deletion, removed reaction state, replacement edges, and tombstones
are applied separately. A valid later reappearance clears the matching
suppression. Present and retained messages are reranked together by the provider
ordering coordinates, so a bounded backfill converges with a fresh import of
the same final records.

The manifest completeness kind and reason apply conservatively to every
account. Stored `observedFrom` and `observedTo` bounds are derived from the
dated message and reaction records for that account, so one account never
inherits another account's time range. An account with no dated timeline
records has null bounds.

`timestamps.createdAt` is monotonic within one stable connected-account source.
An older bundle is rejected. An equal-time replay is accepted only when its
manifest and input revision match exactly; an equal-time conflict is rejected.
Native iMessage replacement remains scoped to its own source and cannot remove
bundle history.
