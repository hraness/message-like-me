# Local message bundle version 1

`message-like-me.local-message-bundle` is a private directory interchange for
moving a bounded local provider observation into Message Like Me. It separates
provider capture from analysis: a producer handles provider access and writes
the bundle, while `messagelikeme ingest bundle` verifies and normalizes it. The
importer never receives provider credentials and never calls the producer.

The current producer is Wrench's local Beeper export:

```sh
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
orders lexical `sortKey`, then `sentAt` and ID as deterministic tie-breakers.

`bodyTruncated: true` means the body cannot be prose evidence. The record still
becomes a text bubble for tempo, reply, and delivery-shape analysis. A message
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
reactions contribute to body and direction counts but never enter the message
timeline, sessions, bursts, response episodes, or latency metrics.

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
suppression.

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
