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

## Install

Message Like Me requires Bun 1.3.14 or newer. Install the immutable public
release from GitHub, then install the Agent Skill:

```sh
bun add --global github:hraness/message-like-me#v0.1.0
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

Ingestion opens the source read-only, validates its schema and ownership, and
does not change Messages or the source database. macOS may require permission
for the terminal or agent host to read Messages data. `messagelikeme doctor`
reports the local state without asking for an account or credential.

## Inspect behavior without exposing prose

Contact listings and aggregate views omit private labels, handles, and message
bodies by default:

```sh
messagelikeme contacts list --min-outgoing 20 --json
messagelikeme contacts show <contact-id> --json
messagelikeme inspect tempo <contact-id> --json
messagelikeme inspect sessions <contact-id> --limit 20 --json
```

The metrics cover conversation start and end, message counts, incoming and
outgoing turns, response latency, single-message versus multi-message replies,
surface prose features, multi-point response contexts, and explicit reply use.
Incoming messages establish what you were responding to; they are never
counted as examples of your writing style.

Pass `--private` to `contacts list` or `contacts show` only when you need to
resolve a pseudonymous contact to its local private label or participants.

## Build a style profile

Aggregate metrics cannot explain why a short burst works in one context or why
a longer single message appears in another. For that semantic work, prepare a
small, diverse study packet at an explicit private path:

```sh
messagelikeme study prepare <contact-id> \
  --output /absolute/private/path/study.json \
  --limit 24 \
  --json
```

This is the only command that writes bounded message bodies outside the private
database. The output is mode `0600`. It contains incoming context and outgoing
responses selected across different response shapes; it is not a full
transcript export. By default, each body is capped at 4 KiB, each example keeps
at most 12 text messages per direction, and the entire packet keeps at most
256 KiB of body text. Packet coverage fields report every truncation or
omission explicitly.

Keep the JSON receipt with the analysis. Its `packetSha256` binds the finished
profile to these exact packet bytes; the packet does not contain its own digest.

Invoke `$message-like-me` in your agent and ask it to analyze that contact. The
skill separates measured facts from inferred patterns, covers prose and tempo,
studies how several inbound points are handled, and treats reply links and
tapbacks separately from written text.

The agent writes a schema-version-one profile and asks the CLI to validate and
store it:

```sh
messagelikeme profile apply /absolute/private/path/profile.json --json
messagelikeme profile show <contact-id> --json
```

A profile is bound to the exact corpus revision and study-packet SHA-256. A new
ingest can therefore mark an earlier profile stale instead of silently applying
it to changed evidence.

Export a profile only when you need an explicit private copy:

```sh
messagelikeme profile export <contact-id> --output /absolute/private/path/profile.json
```

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
messagelikeme contacts list [--min-outgoing N] [--limit N] [--private] [--json]
messagelikeme contacts show CONTACT_ID [--private] [--json]
messagelikeme inspect tempo CONTACT_ID [--json]
messagelikeme inspect sessions CONTACT_ID [--limit N] [--json]
messagelikeme study prepare CONTACT_ID --output FILE [--limit N] [--json]
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

- The original `chat.db` remains authoritative and is opened read-only.
- The normalized corpus, profiles, and installation key stay in a private local
  store with owner-only permissions.
- Stable contact, conversation, and message IDs are derived with a private
  per-install HMAC key. Pseudonymous IDs are not encryption.
- Aggregate commands omit bodies and private labels. Study packets are bounded,
  explicit body-bearing exports.
- Message text never goes to a Message Like Me server. There is no service,
  account, auth flow, analytics client, or network-backed model call.
- Opening a study packet makes its bounded excerpts visible to the agent
  environment already running the skill. Use an agent environment whose data
  handling you accept; the CLI cannot make a hosted agent local.
- Public fixtures are synthetic. Private corpora, profiles, packets, and drafts
  do not belong in Git, issues, logs, packages, or examples.
- A draft is never sent.

Read [SECURITY.md](SECURITY.md) before integrating the library into another
tool or handling a private study packet outside the CLI.

## TypeScript library

The package exports the versioned corpus, metrics, study-packet, and profile
types plus deterministic canonical JSON and SHA-256 helpers:

```ts
import type { ContactMetrics, StyleProfileV1 } from "@hraness/message-like-me"
import { canonicalJson, sha256 } from "@hraness/message-like-me"
```

The library does not start the CLI, inspect Messages, connect to a network, or
send a draft merely because it is imported.

## Development

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

Tests use synthetic Messages databases and synthetic conversations. Never add
a real message, handle, group title, attachment, contact record, private path,
or derived profile to a fixture.

The canonical repository is
[`hraness/message-like-me`](https://github.com/hraness/message-like-me).
`messagelikeme.com` is reserved for the project, but the CLI does not connect
to it and this repository does not claim that a site is deployed.

## License

MIT.
