# Message Like Me

**A local-first CLI and Agent Skill for studying your private iMessage history
and drafting messages that sound like you.**

Message Like Me turns a local Messages database into deterministic conversation
metrics, bounded study packets, and reusable style profiles. Its Agent Skill
teaches Codex, Claude, and other coding agents how to interpret those local
artifacts and draft unsent replies in your voice.

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
bun add --global github:hraness/message-like-me#v0.2.0
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

## Start with your local history

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

Contacts ingest may run before or after iMessage ingest. It reads only bounded
name, email, and phone fields from a stable private copy. Exact normalized
email or phone handles can join several one-to-one iMessage, SMS, and email
threads for the same AddressBook person into one analysis scope. Existing
conversation IDs remain aliases for that person scope. Shared handles remain
ambiguous, local phone numbers never gain a guessed country code, unmatched
threads stay separate, and groups are never collapsed to one person. Contact
labels have their own revision, so a rename does not stale a messaging-style
profile. `messagelikeme doctor` reports local aggregate state without asking
for an account or credential.

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
Session and burst gaps are configurable seconds and are recorded with each
result. They are segmentation choices, not universal facts about conversation.

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

`study prepare` and `evaluate prepare` are the only commands that write bounded
message bodies outside the private database. Their outputs are mode `0600`.
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
messagelikeme ingest contacts [--addressbook PATH] [--json]
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
- The normalized corpus, profiles, and installation key stay in a private local
  store with owner-only permissions.
- Stable contact, conversation, and message IDs are derived with a private
  per-install HMAC key. Pseudonymous IDs are not encryption.
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

The library does not start the CLI, inspect Messages or Contacts, connect to a
network, or send a draft merely because it is imported.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Tests use synthetic Messages and AddressBook databases plus synthetic
conversations. Never add a real message, handle, group title, attachment,
contact record, private path, or derived profile to a fixture.

The canonical repository is
[`hraness/message-like-me`](https://github.com/hraness/message-like-me).
The informational project page is
[`messagelikeme.com`](https://messagelikeme.com). The CLI does not connect to
the site, and the site never receives message or contact data.

## License

MIT.
