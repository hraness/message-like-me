# Local message bundle v2

Local message bundle v2 is the native WhatsApp evidence boundary between a
Wrench-owned Wacli adapter and Message Like Me. Wrench owns Wacli discovery,
authentication, local synchronization, provider interpretation, and export.
Message Like Me reads only the finished caller-owned directory. It never starts
Wrench or Wacli, receives a WhatsApp credential or session database, accesses a
network, or sends a message.

The intended producer flow is:

```sh
bun add --global @hraness/wrench@0.16.3
wrench whatsapp export-message-like-me \
  --auth <whatsapp-auth-id> \
  --output /absolute/private/path/whatsapp-bundle

messagelikeme ingest bundle \
  --input /absolute/private/path/whatsapp-bundle \
  --json
```

The checked compatibility coordinates are Wrench v0.16.3 and official Wacli
v0.15.0. Wrench owns that executable dependency and its authentication state;
neither enters Message Like Me.

That exact producer excludes every reaction-shaped Wacli row. Wacli v0.15.0
may retain an earlier emoji after a removal, so the local projection cannot
durably establish current active reaction state. A bundle that encountered any
such row carries the categorical `reaction-state-unproven` warning. This is an
observability limit, not evidence that no reactions occurred.

The normative object schema is
[`schema/local-message-bundle-v2.schema.json`](../schema/local-message-bundle-v2.schema.json).
The runtime parser is stricter than JSON Schema where byte length, canonical
timestamps, filesystem identity, exact JID semantics, account joins, digests,
and graph laws require executable checks.

## Immutable identity

Message Like Me accepts exactly:

- schema version `2`;
- format `message-like-me.local-message-bundle`;
- source ID `wacli-local`;
- source-transform version `1.0.0`;
- provider `whatsapp@0.15.0` (ID `whatsapp`, version `0.15.0`);
- network `whatsapp` on every record; and
- exactly one connected WhatsApp account.

The manifest's provider coordinate is the exact official Wacli v0.15.0 used by
the producer, not a compatibility wildcard. A semantic producer change
requires a new supported source-transform version or bundle schema.

Producers and consumers can import the dependency-free contract directly:

```ts
import {
  LOCAL_MESSAGE_BUNDLE_V2_ARTIFACTS,
  LOCAL_MESSAGE_BUNDLE_V2_SOURCE_TRANSFORM_VERSION,
  parseLocalMessageBundleV2Manifest,
  parseLocalMessageBundleV2Record,
  parseLocalMessageBundleV2WhatsAppJid,
} from "@hraness/message-like-me/message-bundle-v2"
```

Importing this module performs no filesystem, process, authentication, network,
or messaging work.

## Fixed private directory

The bundle directory must be a normalized absolute, current-user-owned,
physical mode-`0700` directory. It contains exactly:

```text
manifest.json
accounts.ndjson
participants.ndjson
conversations.ndjson
messages.ndjson
reactions.ndjson
tombstones.ndjson
```

Every file is a singly linked, current-user-owned, physical mode-`0600` file.
The importer rejects symbolic links, hard links, inventory drift, concurrent
changes, invalid UTF-8, blank or oversized records, noncanonical JSON, count or
byte disagreement, and SHA-256 disagreement. The same public bounds as v1
apply, except v2 admits exactly one account.

The v2 wire contract retains the fixed `reactions.ndjson` artifact and strict
reaction parser for proven records. The checked Wrench v0.16.3/Wacli v0.15.0
producer leaves that artifact empty because it cannot prove current reaction
state.

`manifest.json` is canonical JSON followed by one newline. Every NDJSON record
is one canonical JSON object followed by one newline. The manifest integrity
digest covers its canonical projection without the `integrity` member;
individual artifact digests cover their exact bytes.

## WhatsApp coordinates

The contract admits only canonical JIDs that establish a supported WhatsApp
realm:

- an E.164-backed user JID ending in `@s.whatsapp.net`;
- a numeric privacy-preserving LID ending in `@lid`; or
- a numeric group JID ending in `@g.us`.

Status, broadcast, newsletter, mixed-case, plus-prefixed JID local parts, and
unknown server forms are rejected. Accounts and participants use a user JID or
LID. Direct conversations use the exact non-self participant JID;
group conversations use a group JID. Complete direct rosters contain exactly
one self and one non-self participant.

A connected account or participant `handle` is the exact `+`-prefixed E.164
projection only when its JID is an E.164-backed user JID. LIDs and group
coordinates never mint a phone handle. This is the only v2 bridge to optional
macOS Contacts enrichment. Names,
titles, phone suffixes, timestamps, and LIDs are never used as fuzzy contact
matches.

Every message has a proven incoming or outgoing direction. Direct-message
senders are proven. A group or system row may retain a null sender when the
bounded local observation cannot prove one, and it cannot establish overlap.
Reply, edit, deletion, attachment, and tombstone fields retain the same strict
meanings as v1. The contract also defines reaction records, but the checked
producer emits none and reports `reaction-state-unproven` when it encounters a
reaction-shaped row. Attachment bytes, provider URLs, credentials, Wacli
session state, database paths, and unmodeled provider payloads are excluded.
Unsupported status, broadcast, and newsletter records are not represented as
ordinary conversations.

## Coverage and replay

A linked-device export is a bounded local observation. It does not prove that
all remote WhatsApp history exists locally. `bounded-local`, `truncated`, and
`unknown` completeness remain non-authoritative: omission in a later bundle
does not delete retained evidence. Only explicit deletion, replacement, or
tombstone records suppress evidence. A later explicit record reappearance
clears that suppression. Creation timestamps remain monotonic per source.

## Beeper WhatsApp overlap

A native Wacli source and an older Beeper WhatsApp source have separate stable
namespaces. If the same exact account is already present, the importer stops and
requires the caller to name that source:

```sh
messagelikeme ingest bundle \
  --input /absolute/private/path/whatsapp-bundle \
  --overlap-source <beeper-whatsapp-source-id> \
  --json
```

`--overlap-source` is not a fuzzy merge switch. Reconciliation requires the
same exact self E.164 account, complete one-to-one direct-peer E.164 identity,
and at least one unambiguous shared message with the same sender role,
timestamp, direction, text body, message kind, and attachment count. Bodyless
messages, groups, names, phone suffixes, approximate timestamps, and ambiguous
duplicates cannot prove equivalence.

Both source provenances and all source-unique history remain stored. Proven
message duplicates contribute once. A reaction can deduplicate only when a
conforming producer supplies a proven reaction record; Wrench v0.16.3 supplies
none, so this overlap path does not reconcile reaction state. The native Wacli
conversation is the preferred action route and carries the exact private
`whatsappJid` coordinate. Its proven Beeper duplicate remains evidence with
reason `superseded-route`. Reimport rechecks the named proof atomically and
fails closed on disagreement.

## Privacy and action boundary

Ordinary source, contact, metrics, and CLI receipts expose only pseudonymous
IDs, counts, digests, coverage, and categorical health. Exact JIDs, E.164
handles, account coordinates, message bodies, and source metadata stay in the
private store or explicit owner-only artifacts.

Message Like Me may write an exact `whatsappJid` route into an explicit
mode-`0600` route inventory. That coordinate is evidence for a separate Wrench
binding and preview. Message Like Me does not authenticate, synchronize,
preview, submit, or send through WhatsApp.
