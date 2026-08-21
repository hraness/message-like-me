# Contents

- `src/` – the deterministic local iMessage and Contacts readers, normalized
  corpus and metrics, private SQLite store, profile parser, Agent Skill
  installer, and `messagelikeme` CLI.
- `schema/` – public versioned JSON Schemas for deterministic artifacts and
  agent-authored profiles.
- `skills/message-like-me/` – the canonical Message Like Me Agent Skill and its
  progressive analysis, drafting, privacy, and profile references.
- `scripts/` – skill, standalone-boundary, built-output, and packed-consumer
  verification.
- `dist/` – committed Bun-targeted JavaScript used by immutable GitHub installs.
- `.github/workflows/` – read-only CI and checks-gated immutable tag releases.
- `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `LICENSE` – standalone
  public documentation, policy, and terms.
- `package.json`, `tsconfig.json`, and `bun.lock` – Bun package, build, and
  verification configuration.

# Guidelines

- Use Bun 1.3.14 and run `bun run check` before handing off a change. Do not add
  another package manager or lockfile.
- Keep the public description exact: “A local-first CLI and Agent Skill for
  studying your private iMessage history and drafting messages that sound like
  you.”
- Keep the public repository independently buildable. Do not reference another
  source repository, private packages, sibling paths, private fixtures, or
  publication mechanics.
- Keep `chat.db` authoritative and ingestion read-only, query-only,
  ownership-checked, schema-validated, and bounded. Never modify Messages,
  contacts, attachments, or SQLite sidecars.
- Treat AddressBook databases as optional label-enrichment sources. Isolate
  every database plus WAL or journal before SQLite opens it, validate contact
  entities and property owners dynamically, read only names and exact
  email/phone handles, and never modify Contacts or its sidecars.
- Keep the normalized corpus, installation key, study packets, profiles, and
  drafting context local in owned physical paths with private permissions.
  Reject symlinks and foreign-owned sensitive files.
- Derive stable local identifiers with the per-install HMAC key. Ordinary
  aggregate views omit bodies, handles, contact names, and group titles. Only
  `study prepare` may write a bounded body-bearing artifact outside the private
  database, and it writes mode `0600` to an explicit path.
- Count only outgoing user-authored messages as style evidence. Incoming
  messages supply response context. Preserve body provenance, explicit reply
  targets, and tapbacks as distinct data.
- Keep the CLI and library free of network access, AI-provider calls,
  authentication, accounts, telemetry, analytics, synchronization, and message
  sending. The installed Agent Skill supplies semantic analysis and unsent
  drafting through the agent already running it.
- Keep the command name `messagelikeme`, the repository and package name
  `message-like-me`, and the Agent Skill name `message-like-me`. Do not claim
  that `messagelikeme.com` is deployed or treat it as a data plane.
- Keep CLI commands namespaced as `ingest imessage|contacts`,
  `contacts list|show|resolve`,
  `inspect tempo|sessions`, `study prepare`, `profile apply|show|export`, plus
  `init`, `context`, `skill`, and `doctor`. Machine-readable commands support
  stable JSON stdout; diagnostics use stderr and typed exit codes.
- Parse every foreign value from `unknown`. Bound paths, source bytes, message
  counts, text bytes, lists, study examples, and profile fields before work
  escapes the boundary. Keep canonical timestamps and deterministic ordering.
- Version corpus, metrics, study-packet, and profile schemas explicitly.
  Preserve exact corpus-revision and packet-SHA provenance so stale profiles
  fail visibly.
- Use synthetic public fixtures only. Add focused examples for parser, SQL,
  path, CLI, and privacy boundaries, plus property tests for ordering,
  partitioning, conservation, identity, canonicalization, and round trips.
- Keep `skills/message-like-me/SKILL.md` concise and route conditional detail to
  its linked references. Keep the bundled skill installable for Codex, Claude,
  and generic Agent Skill targets at user or project scope.
- Treat a stable `v*` tag matching `package.json` on `main` as a release request.
  Publish only after the complete check and packed-consumer gate pass. Keep
  GitHub Releases immutable and distribute through GitHub rather than npm.
