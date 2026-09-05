# Contents

- `src/` – the deterministic local iMessage, X archive, Contacts, and private
  Beeper and native WhatsApp source-bundle readers, normalized corpus and
  metrics, private SQLite store, profile parser, Agent Skill installer, and
  `messagelikeme` CLI.
- `schema/` – public versioned JSON Schemas for deterministic artifacts and
  agent-authored profiles.
- `docs/` – public methodology, evidence limits, research review, prior-art
  comparisons, and the release-bound publication runbook.
- `skills/message-like-me/` – the canonical Message Like Me Agent Skill and its
  progressive analysis, drafting, privacy, and profile references.
- `.agents/skills/` – portable plan authoring, phased execution, implementation,
  and independent review workflows.
- `site/` – the informational public project page; it has no private-data or
  product-runtime connection.
- `scripts/` – skill, standalone-boundary, built-output, and packed-consumer
  verification.
- `dist/` – committed Bun-targeted JavaScript used by immutable GitHub installs.
- `.github/workflows/` – read-only CI, checks-gated immutable tag releases,
  and the separately admitted production-ref writer.
- `README.md`, `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `LICENSE` –
  standalone public documentation, release history, policy, and terms.
- `STYLE.md` – the public and reader-facing prose contract.
- `package.json`, `tsconfig.json`, and `bun.lock` – Bun package, build, and
  verification configuration.

# Guidelines

- Use Bun 1.3.14 and run `bun run check` before handing off a change. Do not add
  another package manager or lockfile.
- Keep the public description exact: “A local-first CLI and Agent Skill for
  studying private messaging history and drafting messages that sound like
  you.”
- Follow `STYLE.md` for public site, documentation, README, release, and
  Agent Skill prose.
- Follow the shared [Hraness README guidelines](https://github.com/hraness/.github/blob/main/README_GUIDELINES.md).
  Keep the durable definition, mechanism-backed rationale, shortest verified
  first task, observable behavior, boundaries, verification, and task-oriented
  documentation path current.
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
  `study prepare`, `ensoul prepare`, `evaluate prepare`, and `handoff prepare`
  may write bounded body-bearing artifacts outside the private database, and
  they write mode `0600` to explicit paths.
- Count only outgoing user-authored messages as owner-style evidence. Incoming
  messages supply response context. A contact-subject Ensoul packet is the
  narrow exception: require an exact direct AddressBook `person_` scope, rebase
  direction before selection, and mark owner prose as counterpart context.
  Preserve body provenance, explicit reply targets, and tapbacks as distinct
  data.
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
  `inspect tempo|sessions`, `study prepare`, `ensoul prepare`,
  `profile apply|show|export`,
  `routes list`, `handoff prepare|verify|record`, `handoffs show`, plus `init`,
  `context`, `skill`, and `doctor`. Machine-readable commands support stable
  JSON stdout; diagnostics use stderr and typed exit codes.
- Parse every foreign value from `unknown`. Bound paths, source bytes, message
  counts, text bytes, lists, study examples, and profile fields before work
  escapes the boundary. Keep canonical timestamps and deterministic ordering.
- Version corpus, metrics, study-packet, and profile schemas explicitly.
  Preserve exact corpus-revision and packet-SHA provenance so stale profiles
  fail visibly.
- Keep `ensoul.source-packet.v1` and the stricter
  `ensoul.messages-source.v1` payload explicit. Record and packet identities,
  RFC 8785 content, record, and packet digests, subject-relative authorship,
  content role, source-owner transport status, revisions, bounds, omissions,
  and limitations must remain deterministic and body-bearing packets must never
  appear on stdout.
- Use synthetic public fixtures only. Add focused examples for parser, SQL,
  path, CLI, and privacy boundaries, plus property tests for ordering,
  partitioning, conservation, identity, canonicalization, and round trips.
- Keep `skills/message-like-me/SKILL.md` and the copied `skills/ensoul/SKILL.md`
  concise and route conditional detail to their linked references. The copied
  Ensoul skill is vendored source, never a runtime dependency. Preflight and
  install both complete skills for Codex, Claude, and generic Agent Skill
  targets at user or project scope without leaving a partial pair.
- Follow `docs/publishing.md` for the one-time production controls, stable
  release, and reviewed-`main` recovery procedure. Treat an immutable annotated
  stable `v*` tag matching every checked version identity at a reviewed commit
  in current `main` history as a
  release request. Publish only after the complete root, site, packed-consumer,
  synthetic macOS gate, and exact-tarball macOS/Linux gates pass. Build the
  package once, publish the immutable Latest GitHub Release with that tarball
  plus `SHA256SUMS` first, then publish the same tarball through npm trusted
  publishing before the separate current-`main` promotion workflow
  fast-forwards the established `website-production` ref with an exact
  expected-old lease. Keep the tag workflow's write scope split: only the
  GitHub publication job gets `contents: write`, only the npm publication job
  gets `id-token: write`, and a separate read-only job admits exact bytes and
  provenance. Treat every SHA-pinned setup and artifact action in those jobs as
  part of the privileged release TCB. Keep the GitHub token scoped to the
  dependency-free publisher step. Keep the dedicated status-signing App's
  private key inside the main-only `production-ref-writer-key` environment and
  expose it only to a fresh dependency-free, hash-pinned promotion job. Before
  environment admission, and again in that job before reading the key, require
  complete non-shallow history and prove that every commit newly reachable from
  the expected-old production SHA preserves its `.github/workflows` tree OID.
  Mint only the numeric one-repository `statuses:write` plus `metadata:read`
  App token. Require that App to be the pinned source of one exact-SHA success
  status, prove its readback, and revoke that token. Let only the same job's
  scoped `GITHUB_TOKEN` perform the leased ref move, then mint a separate
  status-only token to replace the success with a proven terminal non-success
  status before revoking the second token. The status App must have neither `contents:write` nor
  `workflows:write`, and it must not be a ref-ruleset bypass actor. A reviewed
  workflow-control epoch requires the separately approved out-of-band bootstrap
  in the runbook, followed by App downgrade, key rotation, and already-exact
  recovery. Require the bounded read-only provider outcome gate to finish.
  Already-exact recovery must not enter the key environment. Recovery may
  revalidate only an existing immutable, artifact-complete Latest Release and
  exact npm version and must never create either one. A later positive attempt
  may finish the same exact tag, commit, and tarball only when Sigstore binds
  the actual run ID and an allowed positive attempt. Keep Vercel Production
  Branch on `website-production`; `main` and pull requests are preview sources.
  If a runner interruption may leave a success status, disable both routine
  promotion workflows and use only the target-bound terminal-authority cleanup
  in the publishing runbook after its 36-day complete attempt inventory and
  65-minute token-expiry quarantine. A hard cancellation can prevent token
  revocation and receipt persistence, so absent evidence starts a fresh
  quarantine rather than authorizing a retry. Cleanup may append only a distinct
  App-authored terminal `error`; it never moves a ref or creates restart
  authority. Require owner-admin before/after proof of empty ruleset bypasses,
  and treat every incomplete cleanup receipt as continued quarantine.

<!-- hra-local-efficiency:start -->
- Treat the user's request to change this repository as standing authorization for routine task-owned commits, pushes, pull requests, merges, releases, deployments, and production verification after the repository's required validation, review, identity, and rollout gates pass. Do not ask for another confirmation at each delivery step.
- Use the repository's documented delivery workflow and preserve every runtime-enforced approval, branch protection, environment rule, safety policy, and final gate. Ask for user input only when delivery needs a material product decision, missing credentials or authority, an irreversibly destructive action outside task scope, or resolution of a release failure that cannot be handled safely and autonomously.
- Prefer short-lived repository workload identities such as OIDC trusted publishing, GitHub Apps, and narrowly scoped machine identities. Do not add long-lived personal tokens, weaken two-factor authentication, or bypass provider controls to eliminate an interactive prompt. Batch unavoidable human-gated production promotions into intentional stable releases while agents publish validated prerelease or beta channels through workload identities when the repository supports them.
- Preserve useful reasoning fan-out, but avoid unnecessary checkout fan-out. Prefer subagents in the current task for bounded research, review, diagnosis, and focused checks when they can safely share one working tree; create a separate task or worktree only for independently deliverable divergent edits, an isolated verification tree, or a different execution environment.
- Give each expensive focused validation command and external wait one owner. The integration owner reviews that evidence and runs the repository-required aggregate or final gate once after convergence. Reuse evidence only for the exact Git tree, command, lockfiles, toolchain, relevant environment, and validity period, and never to skip a required final integration, merge, release, deployment, or production-verification gate.
- On Hraness development machines, use `$hra-local-efficiency` and the installed host scheduler for heavyweight top-level commands when available. Keep ordinary work in the compute lane; give authenticated browser/dev-server/Chromium work one `browser-auth` owner and Mac-only validation one `mac-native` owner.
- When a CI or policy gate scans complete Git history, check out the exact governed SHA and fetch only the fully qualified governed refs before scanning. Preserve the complete-history gate and reject unexpected refs instead of importing unrelated concurrent heads.
- At closeout, record applicable branch, PR, check, merge, release, deployment, and production evidence. Archive only conclusively finished tasks, never from silence alone, and reclaim only freshly revalidated clean merged worktrees through the guarded exact-path flow.
<!-- hra-local-efficiency:end -->
