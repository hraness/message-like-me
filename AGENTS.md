# Contents

- `src/` – the deterministic local iMessage, X archive, Contacts, and private
  Beeper and native WhatsApp source-bundle readers, normalized corpus and
  metrics, private SQLite store, profile parser, Agent Skill installer, and
  `messagelikeme` CLI.
- `schema/` – public versioned JSON Schemas for deterministic artifacts and
  agent-authored profiles.
- `docs/` – public methodology, evidence limits, research review, and prior-art
  comparisons.
- `skills/message-like-me/` – the canonical Message Like Me Agent Skill and its
  progressive analysis, drafting, privacy, and profile references.
- `site/` – the informational public project page; it has no private-data or
  product-runtime connection.
- `scripts/` – skill, standalone-boundary, built-output, and packed-consumer
  verification.
- `dist/` – committed Bun-targeted JavaScript used by immutable GitHub installs.
- `.github/workflows/` – read-only CI and checks-gated immutable tag releases.
- `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `LICENSE` –
  standalone public documentation, release history, policy, and terms.
- `package.json`, `tsconfig.json`, and `bun.lock` – Bun package, build, and
  verification configuration.

# Guidelines

- Use Bun 1.3.14 and run `bun run check` before handing off a change. Do not add
  another package manager or lockfile.
- Keep the public description exact: “A local-first CLI and Agent Skill for
  studying private messaging history and drafting messages that sound like
  you.”
- Keep the public repository independently buildable. Do not reference another
  source repository, private packages, sibling paths, private fixtures, or
  publication mechanics.
- Keep `chat.db` authoritative and ingestion read-only, query-only,
  ownership-checked, schema-validated, and bounded. Never modify Messages,
  contacts, attachments, or SQLite sidecars.
- Treat an X data archive as an untrusted, private, owner-controlled ZIP. Parse
  bounded supported entries in memory without extracting files, evaluating
  JavaScript, accessing a network, or downloading media. Preserve exact archive
  provenance and reject ambiguous account or cross-source overlap claims.
- Treat a `message-like-me.local-message-bundle` as an untrusted, private,
  versioned directory boundary. Require its fixed inventory, canonical UTF-8,
  owner-only modes, bounded records, artifact digests, and manifest digest.
  Never let bundle absence erase retained history unless a future contract
  explicitly declares authoritative coverage; apply explicit deletions and
  tombstones separately.
- Preserve local message bundle v1 as the frozen Beeper contract. Treat bundle
  v2 as the exact one-account Wrench/Wacli WhatsApp seam: source
  `wacli-local@1.0.0`, provider `whatsapp@0.15.0`, network `whatsapp`, canonical
  supported JIDs, and E.164 handles only when the JID proves them. Never add
  Wacli process, authentication, synchronization, network, or send code to
  Message Like Me.
- Treat AddressBook databases as optional label-enrichment sources. Isolate
  every database plus WAL or journal before SQLite opens it, validate contact
  entities and property owners dynamically, read only names and exact
  email/phone handles, and never modify Contacts or its sidecars.
- Keep the normalized corpus, installation key, study packets, profiles, and
  drafting context local in owned physical paths with private permissions.
  Reject symlinks and foreign-owned sensitive files.
- Derive stable local identifiers with the per-install HMAC key. Ordinary
  aggregate views omit bodies, handles, contact names, and group titles. Only
  `study prepare`, `evaluate prepare`, and `handoff prepare` may write bounded
  body-bearing artifacts outside the private database, and they write mode
  `0600` to explicit paths.
- Count only outgoing user-authored messages as style evidence. Incoming
  messages supply response context. Preserve body provenance, explicit reply
  targets, and tapbacks as distinct data.
- Keep the CLI and library free of network access, AI-provider calls,
  authentication, accounts, telemetry, analytics, synchronization, and message
  sending. The installed Agent Skill supplies semantic analysis and unsent
  drafting through the agent already running it.
- Keep the command name `messagelikeme`, the repository and package name
  `message-like-me`, and the Agent Skill name `message-like-me`. Treat
  `messagelikeme.com` as an informational project page, never as a data plane.
- Keep CLI commands namespaced as `ingest imessage|x-archive|contacts|bundle`,
  `sources list|show`,
  `contacts list|show|resolve`,
  `inspect tempo|sessions`, `study prepare`, `profile apply|show|export`,
  `routes list`, `handoff prepare|verify|record`, `handoffs show`, plus `init`,
  `context`, `skill`, and `doctor`. Machine-readable commands support stable
  JSON stdout; diagnostics use stderr and typed exit codes.
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
