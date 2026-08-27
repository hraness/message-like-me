# Message Like Me

**A local-first CLI and Agent Skill for studying private messaging history and
drafting messages that sound like you.**

Message Like Me turns private local messaging history into deterministic
conversation metrics, bounded study packets, and reusable style profiles. It
reads native iMessage history, caller-owned X data archives, and strict local
source bundles, including multi-account Beeper exports produced through
Wrench. Its Agent Skill teaches Codex, Claude, and other coding agents how to
interpret those local artifacts and draft unsent replies in your voice.

The CLI does not call an AI service, authenticate with a product account, send
messages, or operate Messages. The agent already running the skill supplies the
semantic analysis and drafting judgment.

This is an evidence layer for relationship-aware drafting, not a digital clone.
It does not train a model, represent your identity, infer your beliefs, or claim
that a draft is what you would have written. Your current meaning, facts, and
intent outrank historical style.

## Install

Message Like Me requires Bun 1.3.14 or newer. Install the immutable public
release from GitHub, then install the Agent Skill:

```sh
bun add --global github:hraness/message-like-me#v0.5.0
messagelikeme skill install
```

Start a new agent session after installing the skill. The default target is
Codex at user scope. Other supported targets and project-local installation are
available explicitly:

```sh
messagelikeme skill install --target claude
messagelikeme skill install --target agents --scope project
messagelikeme skill path
```

Message Like Me is distributed directly through GitHub and is not published to
npm.

## Start with private local history

Initialize the private data store and inspect its location:

```sh
messagelikeme init
messagelikeme doctor --json
```

On macOS, the default store is:

```text
~/Library/Application Support/Message Like Me/
```

The directory is private to the current user. It contains a local SQLite
database, stored profiles, and a private installation key used to derive
stable pseudonymous IDs. Study packets are written only to the explicit path
you choose. You can put the store elsewhere by placing
`--data-dir /absolute/private/path` before the command.

Import the current user's iMessage database:

```sh
messagelikeme ingest imessage --json
```

The default source is the current user's Messages `chat.db`. Use `--database`
only to name another caller-owned physical database:

```sh
messagelikeme ingest imessage --database /absolute/path/to/chat.db --json
```

Ingestion validates the source schema and ownership, makes a stable private
copy of the database and its transactional sidecars, and opens only that copy
with SQLite. It does not change Messages, `chat.db`, or its sidecars. macOS may
require permission for the terminal or agent host to read Messages data.

Import direct messages from a caller-owned X data archive ZIP:

```sh
messagelikeme ingest x-archive \
  --input /absolute/private/path/x-data-archive.zip \
  --json
```

The importer requires a normalized absolute path to an owner-only physical ZIP
and reads only the supported archive entries. It does not extract the archive,
evaluate its JavaScript wrappers, access X or another network, or download
linked media. It stores exact archive and account provenance with the normalized
source so a later audit can identify which local export supplied the evidence.
The supported source is the archive's direct-message history. X Chat history is
not included. Bounded reply and mention identity metadata from selected tweet
entries may help associate provider user IDs with X handles or display names;
tweet bodies never become messaging-style evidence.

X data archives do not expose whether a direct message used an explicit reply
link. Those messages still contribute body, direction, ordering, tempo, and
response-shape evidence, but reply observability is marked unavailable. They do
not enter the explicit-reply ratio and are not treated as observed non-replies.

When the same X account is already present through a Beeper bundle, first find
that source in the redacted inventory, then name it explicitly:

```sh
messagelikeme sources list --json
messagelikeme ingest x-archive \
  --input /absolute/private/path/x-data-archive.zip \
  --overlap-source <beeper-x-source-id> \
  --json
```

`--overlap-source` is not a fuzzy merge switch. Reconciliation proceeds only
for one-to-one direct conversations whose account identity, peer handle, and
overlapping message evidence match exactly. Both source provenances remain
inspectable, ambiguity or contradiction fails closed, and exact messages appear
once in analysis. Group DMs remain separate because the legacy archive does not
supply enough cross-provider sender proof for safe equivalence. Reimporting the
same or a later archive preserves proven deduplication; archive absence does not
delete retained history.

To study accounts connected through Beeper, install or update to a compatible
[Wrench release](https://github.com/hraness/wrench/releases), then ask it to
create a new private Message Like Me bundle:

```sh
wrench beeper export-message-like-me \
  --auth <beeper-auth-id> \
  --output /absolute/private/path/beeper-bundle \
  --json
```

The optional `--limit-chats`, `--limit-messages`, and `--max-participants`
flags lower the export bounds. The output path must be a normalized absolute
path to a directory that does not already exist. Wrench calls the pinned
[official Beeper CLI](https://github.com/beeper/cli) directly. It enumerates
the connected account realm, invokes `export --no-attachments` once per
account in deterministic order, and reports the account ordinal, elapsed-time
heartbeats, and cumulative validated chat and message counts on stderr. It
retains each private raw shard until it can atomically publish the complete
mode-`0700` seven-file bundle with mode-`0600` files.

The export does not use the separate
[Beeper Desktop API MCP project](https://github.com/beeper/desktop-api-mcp).
The CLI path supplies the bounded account snapshots and local files needed for
hash validation, deterministic conversion, crash recovery, and atomic
publication. Provider URLs and credentials are excluded. Message Like Me does
not receive the Beeper credential and does not call Beeper or Wrench itself.

Ingest the finished directory, then inspect its redacted source health:

```sh
messagelikeme ingest bundle --input /absolute/private/path/beeper-bundle --json
messagelikeme sources list --json
messagelikeme sources show <source-id> --json
```

The importer verifies the fixed version-one inventory, canonical UTF-8 NDJSON,
record and byte bounds, owner-only permissions, artifact digests, and manifest
digest before changing the store. One bundle may contain several connected
accounts and networks; each becomes a separate source namespace. Native
iMessage and prior bundle sources remain alongside it.

The complete interchange, integrity, identity, and reimport laws are in the
[version-one local message bundle contract](docs/local-message-bundle-v1.md).
Message Like Me accepts the `beeper-local` source transform `1.1.0`, introduced
in Wrench 0.13.0 and emitted throughout Wrench 0.13.x. Later Wrench releases are
compatible only while they preserve that explicit manifest coordinate.

Beeper exports describe bounded local observations. A later bounded export
that omits an older record does not delete retained history. Explicit deletion,
removal, replacement, and tombstone records suppress their target, and a later
reappearance restores it. Older snapshots cannot overwrite newer state. Use
`sources show <source-id> --private --json` only when you deliberately need the
private provider account and source metadata.

Optionally enrich and join direct conversations with private identities from
macOS Contacts:

```sh
messagelikeme ingest contacts --json
```

The default source is the current user's AddressBook directory. An explicit
absolute AddressBook root, `Sources` directory, store directory, or
`AddressBook-vN.abcddb` file can be selected with `--addressbook`:

```sh
messagelikeme ingest contacts \
  --addressbook /absolute/path/to/AddressBook \
  --json
```

Contacts ingest may run before or after any message source. It reads only
bounded name, email, and phone fields from a stable private copy. Exact
normalized email or E.164 phone handles can join several one-to-one threads
for the same AddressBook person into one analysis scope. An imported
conversation is eligible only when its source positively establishes a
complete direct participant roster. Existing conversation IDs remain aliases
for that person scope. Shared handles remain ambiguous, local phone numbers
never gain a guessed country code, unmatched threads stay separate, and groups
are never collapsed to one person. Contact labels have their own revision, so
a rename does not stale a messaging-style profile. `messagelikeme doctor`
reports local aggregate state without asking for an account or credential.

## Inspect behavior without exposing prose

Contact listings and aggregate views omit private labels, handles, and message
bodies by default:

```sh
messagelikeme contacts list --min-outgoing 20 --json
messagelikeme contacts show <contact-id> --json
messagelikeme inspect tempo <contact-id> --session-gap 28800 --burst-gap 300 --json
messagelikeme inspect sessions <contact-id> --limit 20 --json
```

The metrics cover conversation start and end, message counts, incoming and
outgoing turns, within-session response latency, single-message versus
multi-message replies, surface prose features, multi-point response contexts,
reactions, and explicit reply use. Incoming messages establish what you were
responding to; they are never counted as examples of your writing style.
Sessions, bursts, and response episodes never cross a source conversation
boundary. Person scopes spanning several apps expose a sorted `services`
breakdown instead of hiding the mixed-channel evidence behind a null service.
Reactions with no provider timestamp still contribute to reaction counts and
direction, but never to temporal metrics. Raw provider reaction values remain
private; ordinary metrics and drafting context expose only fixed-size counts,
direction, datedness, and the outgoing reaction ratio. Session and burst gaps
are configurable seconds and are recorded with each result. They are
segmentation choices, not universal facts about conversation.

Explicit-reply metrics also report how many outgoing text messages were
eligible for reply measurement and how many came from a source where reply
links were unavailable. The ratio uses only eligible messages. Do not compare
an X archive's unavailable reply metadata with an observed no-reply decision
from iMessage or a compatible bundle.

Pass `--private` to `contacts list` or `contacts show` only when you need to
resolve a pseudonymous contact to its local private label or participants.

When you already know the complete Contacts label, resolve only that exact
private name instead of listing every label:

```sh
messagelikeme contacts resolve "Exact Contact Name" --private --json
```

Resolution is normalized for case and Unicode representation, but it does not
perform prefix, substring, phonetic, or fuzzy matching. It returns only direct
person scopes and labels, never handles or message bodies.

## Prepare an exact private agent handoff

Message Like Me can bind an ordered unsent draft to one exact local
source-conversation candidate and one current opaque Wrench context. It still
does not invoke Wrench, authenticate, launch a provider command, access a
network, or send a message.

Start with the redacted candidate inventory:

```sh
messagelikeme routes list <contact-id> \
  --output /absolute/private/routes.json --json
```

A contact or person scope is never itself a destination. Each candidate names
one pseudonymous source and conversation inside that mode-`0600` output.
Ordinary stdout reports only its digest, counts, and selection state.
`--private` additionally reveals only
the exact account, source, and tagged conversation coordinate already observed
in that imported source: `beeperConversation` for a Beeper bundle or
`imessageChat` for Messages. It never emits names, handles, participants, or a
locator derived from them. Wrench rejects a coordinate whose tag does not match
the selected provider adapter.

An X archive candidate is always `evidence-only` with reason
`archive-source`. Handoff v1 also keeps group candidates evidence-only as an
explicit direct-conversation product limit. This does not claim that Wrench or
a provider cannot address an exact group. It prevents Message Like Me from
authorizing one through this first handoff contract. Several eligible direct
candidates produce an `ambiguous` selection state; no route is chosen from a
name, title, participant list, or merged person scope.

After Wrench has written its exact current context and the agent has written an
ordered one-to-eight-bubble draft, prepare one private handoff:

```sh
messagelikeme handoff prepare <contact-id> \
  --request /absolute/private/handoff-request.json \
  --wrench-context /absolute/private/wrench-context.json \
  --draft /absolute/private/draft.json \
  --output /absolute/private/handoff.json \
  --json
```

The request contains the exact selected source-conversation candidate from the
private route inventory. The request, context, and draft must be owner-only,
singly linked physical files. The context must carry the pinned
`wrench.messaging-context-binding.v1` contract identity,
an unexpired opaque route and context reference, and exact SHA-256 data and
latest-message revisions. The output is a mode-`0600` file whose canonical
digest binds those values, the selected source revision, corpus and profile
evidence, bubble order, text, and optional reply references. Raw opaque Wrench
references and draft bodies appear only in the explicit private inputs and
handoff file.

Verification and audit commands emit hashes, counts, timestamps, and
pseudonymous IDs without bodies or raw Wrench references:

```sh
messagelikeme handoff verify /absolute/private/handoff.json --json
messagelikeme handoff record <handoff-id> \
  --wrench-receipt /absolute/private/wrench-receipt.json --json
messagelikeme handoffs show <handoff-id> --json
```

Recording requires Wrench's pinned body-free receipt binding. It carries the
provider-neutral client-intent digest, set to this exact Message Like Me
handoff digest, along with route-reference, context-reference, exact-turn, and
private-preview digests. It also carries the proven prefix and a canonical
receipt digest. It contains no raw route or context reference. Message Like Me
stores only those hashes, counts, timestamps, states, and pseudonymous run and
handoff IDs. It never
inserts a sent message into the corpus. A later independent source ingestion
must observe that message before it can affect
style, tempo, reply, or interaction evidence. The pure contract is exported as
`@hraness/message-like-me/agentic-messaging-v1` for checked local consumers.

## Build a style profile

Aggregate metrics cannot explain why a short burst works in one context or why
a longer single message appears in another. For that semantic work, prepare a
small, diverse study packet at an explicit private path:

```sh
messagelikeme study prepare <contact-id> \
  --output /absolute/private/path/study.json \
  --before 2026-08-01T00:00:00.000Z \
  --limit 24 \
  --json
```

`study prepare`, `evaluate prepare`, and `handoff prepare` are the only commands
that write bounded message bodies outside the private database. Their outputs
are mode `0600`.
A study packet contains incoming context and outgoing responses selected across
different response shapes; it is not a full transcript export. By default,
each body is capped at 4 KiB, each example keeps at most 12 text messages per
direction, and the entire packet keeps at most 256 KiB of body text. Packet
coverage fields report every truncation or omission explicitly.

Keep the JSON receipt with the analysis. Its `packetSha256` binds the finished
profile to these exact packet bytes; the packet does not contain its own digest.

`--after` is inclusive and `--before` is exclusive. Temporal bounds let you
reserve later conversations for evaluation. Invoke `$message-like-me` in your
agent and ask it to analyze that contact. The skill separates measured facts
from inferred patterns, covers prose and tempo, studies how several inbound
points are handled, and treats reply links and tapbacks separately from written
text.

The agent writes a schema-version-two profile and asks the CLI to validate and
store it:

```sh
messagelikeme profile apply /absolute/private/path/profile.json --json
messagelikeme profile show <contact-id> --json
```

A version-two profile records the global corpus revision for provenance, a
person-and-window-specific evidence revision for validity, the exact
study-packet SHA-256, and the packet's non-body evidence manifest. Measured and
inferred claims cite valid packet example IDs and record counterexamples,
support counts, confidence, and drafting consequences. Messages for someone
else or outside the studied time window do not stale it; changes inside its
actual evidence do.

Export a profile only when you need an explicit private copy:

```sh
messagelikeme profile export <contact-id> --output /absolute/private/path/profile.json
```

Version-one profiles remain readable for migration, but new analyses should use
[`schema/style-profile-v2.schema.json`](schema/style-profile-v2.schema.json).

## Audit against later conversations

Prepare a separate prompt and reference set from conversations after the study
cutoff:

```sh
messagelikeme evaluate prepare <contact-id> \
  --after 2026-08-01T00:00:00.000Z \
  --prompt-output /absolute/private/path/evaluation-prompts.json \
  --reference-output /absolute/private/path/evaluation-references.json \
  --json
```

Give the agent only the prompt file and fix one candidate bubble sequence per
case before opening the reference file. Then compare intent coverage, factual
meaning, prose, bubble shape, explicit replies, privacy leakage, and
calibration. The files support a blind workflow but do not enforce one, and the
historical response is one observation rather than a unique correct answer.
The CLI deliberately does not collapse these dimensions into a universal
fidelity score. See [the methodology](docs/methodology.md).

## Draft an unsent reply

Ask an agent with the installed `$message-like-me` skill to draft for a
pseudonymous contact. The compact deterministic context is available through:

```sh
messagelikeme context <contact-id> --json
```

The skill preserves your intended meaning, selects the applicable profile,
and can express the result as one message or a realistic sequence of separate
bubbles. It uses explicit replies only when your evidence and the current
context support them.

Drafting ends with text in the agent task. Message Like Me has no send, react,
schedule, or messaging-application command.

## Command reference

Run `messagelikeme --help` for the checked grammar. The public surfaces are:

```text
messagelikeme init [--json]
messagelikeme ingest imessage [--database PATH] [--json]
messagelikeme ingest x-archive --input ABS_PATH
  [--overlap-source SOURCE_ID] [--json]
messagelikeme ingest contacts [--addressbook PATH] [--json]
messagelikeme ingest bundle --input ABS_PATH [--json]
messagelikeme sources list [--private] [--json]
messagelikeme sources show SOURCE_ID [--private] [--json]
messagelikeme contacts list [--min-outgoing N] [--limit N] [--private] [--json]
messagelikeme contacts show CONTACT_ID [--private] [--json]
messagelikeme contacts resolve QUERY --private [--limit N] [--json]
messagelikeme inspect tempo CONTACT_ID [--session-gap N] [--burst-gap N] [--json]
messagelikeme inspect sessions CONTACT_ID [--limit N] [--session-gap N] [--burst-gap N] [--json]
messagelikeme study prepare CONTACT_ID --output FILE [--limit N]
  [--after ISO_TIMESTAMP] [--before ISO_TIMESTAMP]
  [--session-gap N] [--burst-gap N] [--json]
messagelikeme evaluate prepare CONTACT_ID --after ISO_TIMESTAMP
  --prompt-output FILE --reference-output FILE [--before ISO_TIMESTAMP]
  [--limit N] [--session-gap N] [--burst-gap N] [--json]
messagelikeme profile apply FILE [--json]
messagelikeme profile show CONTACT_ID [--json]
messagelikeme profile export CONTACT_ID --output FILE [--json]
messagelikeme context CONTACT_ID [--json]
messagelikeme skill path [--json]
messagelikeme skill install [--target codex|claude|agents]
  [--scope user|project] [--project PATH] [--force] [--json]
messagelikeme doctor [--json]
```

Place global `--data-dir PATH` before the command.

## Privacy model

- The original `chat.db` and AddressBook databases remain authoritative.
  SQLite opens only stable private copies, never the source files or sidecars.
- X data archives remain private caller-owned inputs. Import reads supported
  entries directly from the ZIP without extraction, evaluation, network access,
  or media download, and retains exact archive provenance.
- Source bundles remain private caller-owned inputs. Import verifies their
  fixed inventory, canonical bytes, digests, bounds, and owner-only modes.
- The normalized corpus, profiles, and installation key stay in a private local
  store with owner-only permissions.
- Stable source, contact, participant, conversation, message, and reaction IDs
  are derived with a private per-install HMAC key. Pseudonymous IDs are not
  encryption.
- Aggregate commands omit bodies and private labels. Study and evaluation
  packets are bounded, explicit body-bearing exports.
- Message text never goes to a Message Like Me server. There is no service,
  account, auth flow, analytics client, or network-backed model call.
- Opening a study packet makes its bounded excerpts visible to the agent
  environment already running the skill. Use an agent environment whose data
  handling you accept; the CLI cannot make a hosted agent local.
- Public fixtures are synthetic. Private corpora, profiles, packets, and drafts
  do not belong in Git, issues, logs, packages, or examples.
- A draft is never sent.

Read [SECURITY.md](SECURITY.md) before integrating the library into another
tool or handling a private packet outside the CLI. The
[methodology](docs/methodology.md) defines every unit and evidence boundary;
the [research review](docs/research.md) documents papers, neighboring OSS, and
the claims this project does not make.

## TypeScript library

The package exports the versioned corpus, metrics, study-packet, and profile
types plus deterministic canonical JSON and SHA-256 helpers:

```ts
import type { ContactMetrics, StyleProfileV2 } from "@hraness/message-like-me"
import { canonicalJson, sha256 } from "@hraness/message-like-me"
```

The immutable version-one local message bundle contract has a separate,
dependency-free producer and consumer surface:

```ts
import {
  LOCAL_MESSAGE_BUNDLE_V1_ARTIFACTS,
  LOCAL_MESSAGE_BUNDLE_V1_SOURCE_TRANSFORM_VERSION,
  parseLocalMessageBundleV1Manifest,
  parseLocalMessageBundleV1Record,
} from "@hraness/message-like-me/message-bundle-v1"
```

That subpath owns the exact readonly wire types, compatibility constants,
safety bounds, digest helpers, and pure strict parsers. Importing it performs no
filesystem or network work.

The library does not start the CLI, inspect Messages, Contacts, or an X archive,
connect to a network, or send a draft merely because it is imported.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Tests use synthetic Messages and AddressBook databases, synthetic X archive
ZIPs, and synthetic source bundles and conversations. Never add a real message,
handle, group title, attachment, contact record, private path, or derived
profile to a fixture.

The canonical repository is
[`hraness/message-like-me`](https://github.com/hraness/message-like-me).
The informational project page is
[`messagelikeme.com`](https://messagelikeme.com). The CLI does not connect to
the site, and the site never receives message or contact data.

## License

MIT.
