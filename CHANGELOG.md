# Changelog

## 0.8.1

- Document that the Wrench v0.16.5 and official Wacli v0.15.0 WhatsApp
  producer omits reaction-shaped rows and reports `reaction-state-unproven`
  when current active or removed state cannot be established.
- Keep the v2 reaction artifact and strict parser for proven records while
  treating an empty artifact from this producer as unobservable reaction
  behavior, not evidence that no reactions occurred. Native WhatsApp overlap
  therefore cannot reconcile reaction state from this producer.
- Give each supported source a distinct decorative SVG mark, preserve those
  marks in forced-colors mode, and point the Beeper MCP note to Beeper's
  official built-in server documentation.

## 0.8.0

- Add `ensoul prepare` as an offline, bounded source adapter for the owner or
  one exact direct AddressBook person scope. Rebase direction onto the selected
  subject so only that person's messages carry `authorRole: subject` and all
  other prose remains counterpart context.
- Emit strict `ensoul.source-packet.v1` artifacts with the
  `ensoul.messages-source.v1` payload identity, scope and corpus revisions,
  inclusive/exclusive time bounds, explicit sample budgets and limitations,
  deterministic record identities, canonical record and packet digests, and no
  derived person claims.
- Preserve exact session/burst selection parameters, redacted direct-scope and
  service context, and pseudonymous response-context linkage. Reject groups and
  multi-participant owner scopes instead of flattening ambiguous counterpart
  authorship.
- Keep message bodies inside an explicit no-overwrite mode-`0600` export while
  stdout receives only a body-free receipt. Continue excluding retractions,
  system events, reactions, attachments, group-contact attribution, private
  labels, handles, and raw provider coordinates.
- Bundle the copied Ensoul skill alongside Message Like Me without a runtime
  dependency. Skill installation preflights and stages both complete skill
  directories before publishing either one, with rollback on failure.
- Publish the strict adapter schema, TypeScript subpath, package smoke coverage,
  synthetic attribution and privacy tests, and operator guidance for using
  private messages as revisable evidence rather than consent, identity proof,
  sensitive-trait inference, or impersonation authority.

## 0.7.0

- Add the strict dependency-free local message bundle v2 contract for native
  WhatsApp evidence: one Wrench/Wacli account, source `wacli-local@1.0.0`,
  provider `whatsapp@0.15.0`, network `whatsapp`, exact supported JIDs, and
  E.164 handles only when a user JID proves them.
- Dispatch bundle ingestion by manifest schema while preserving the frozen v1
  Beeper parser and fixture byte-for-byte. Keep both versions behind the same
  fixed private directory, canonical JSON, digest, bounds, and replay laws.
- Emit private `whatsappJid` route coordinates for native direct conversations.
  Groups remain evidence-only, and Message Like Me still contains no Wacli
  process, authentication, network, synchronization, preview, or send code.
- Reconcile a named Beeper WhatsApp source only after exact self-account,
  direct-peer, and shared text-message proof. Prefer native Wacli evidence,
  preserve unique history and both provenances, and mark the proven Beeper
  route `superseded-route`.
- Publish the v2 schema, producer documentation, package export, synthetic
  fixtures, CLI and privacy guidance, and informational site source entry.

## 0.6.0

- Add a dependency-free `agentic-messaging-v1` contract that binds one exact
  Wrench route and live context to local source, corpus, profile, and authored
  bubble evidence without giving Message Like Me provider, auth, network,
  subprocess, or send authority.
- Add strict private route inventories and handoff preparation, verification,
  receipt recording, and audit commands. Prose and opaque capability references
  stay in explicit owner-only files; ordinary output and the durable audit keep
  only pseudonymous IDs, hashes, counts, states, and timestamps.
- Mark every official X archive route and every v1 group route evidence-only.
  Emit tagged Beeper and iMessage coordinates only when the imported source
  observed them, and never derive a destination from names, handles,
  participants, titles, or merged person scopes.
- Freeze the Wrench context and receipt binding identities, canonical turn
  digest, and cross-package vectors. A recorded receipt cannot insert a sent
  message or claim delivery; later source ingestion remains the only way a sent
  message can become style or tempo evidence.

## 0.5.1

- Present Apple Messages, X data archives, Beeper via Wrench, and optional
  macOS Contacts through one checked source catalog on the homepage, a dedicated
  source-boundary page, documentation, and machine-readable discovery surfaces.
- Verify Wrench v0.15.0 with its pinned Beeper CLI v0.6.2 as the current bundle
  producer while retaining exact schema `1`, source `beeper-local`, and
  transform `1.1.0` compatibility instead of accepting a package-version range.
- Clarify that deterministic storage and measurement are local, body-bearing
  packets become visible to the chosen agent environment, and Message Like Me
  never receives Beeper credentials, invokes provider operations, or sends.
- Harden persisted X overlap revalidation and reaction suppression, and repair
  mobile command layout so long local commands wrap without widening the page.

## 0.5.0

- Add strict offline ingestion for caller-owned X data archive ZIPs through
  `ingest x-archive`, preserving exact archive and account provenance without
  extracting files, evaluating archive JavaScript, accessing a network, or
  downloading media. X Chat history is not part of this source.
- Reconcile an archive with an existing Beeper X source only when the caller
  names that source and exact account, direct-peer, and message evidence agree.
  Retain both provenances, fail closed on ambiguity, leave group DMs separate,
  and keep proven exact messages deduplicated across future reingests.
- Represent reply-link observability explicitly. X archive messages report it
  as unavailable, so they remain prose and tempo evidence without entering
  explicit-reply ratios or being counted as observed non-replies.
- Advance corpus, metrics, study-packet, and evaluation-packet artifacts so
  reply availability survives deterministic analysis and held-out evaluation.

## 0.4.0

- Publish `@hraness/message-like-me/message-bundle-v1` as the dependency-free
  authority for the immutable version-one local message bundle wire contract,
  including exact readonly types, artifact inventory, safety bounds, digest
  helpers, and strict pure record and manifest parsers.
- Make source-transform compatibility fail closed at `beeper-local` version
  `1.1.0`, keep the JSON Schema and checked cross-producer fixture aligned with
  the executable contract, and verify the public subpath in a packed consumer.
- Reuse the public contract parsers inside CLI ingestion without changing the
  bundle inventory, canonical bytes, privacy boundary, graph laws, or command
  behavior.
- Keep the informational site, release link, and installation command aligned
  with the package version through a checked release-identity invariant.

## 0.3.0

- Add strict private version-one source-bundle ingestion for local Beeper
  exports produced through Wrench, including account and network provenance,
  replies, edits, deletions, attachments, reactions, and tombstones.
- Namespace corpus ownership by source so native iMessage and multiple provider
  accounts coexist. Bounded snapshot absence retains prior history, explicit
  terminal state suppresses evidence, and later reappearance restores it.
- Add `sources list` and `sources show` with active message, conversation,
  reaction, undated-reaction, completeness, and warning health.
- Require Wrench 0.13.0 or newer for its direct official Beeper CLI path,
  sequential per-account progress, retained-shard validation, and atomic
  seven-file publication.
- Partition sessions, bursts, and response episodes by conversation, preserve
  truncated text bubbles as tempo evidence, and count undated reactions without
  inventing timestamps or exposing raw provider reaction values in aggregate
  output.
- Upgrade existing version-two stores in place while retaining conversations,
  profiles, study packets, and evidence provenance.

## 0.2.0

- Aggregate conservatively matched direct threads into one AddressBook person
  scope while retaining conversation aliases and keeping groups separate.
- Track profile validity with a scope-specific evidence revision so unrelated
  new messages do not stale every profile.
- Add temporal study bounds and two-file held-out evaluation packets.
- Add the evidence-auditable version-two profile schema while retaining
  version-one profile compatibility.
- Exclude retracted, reaction, and system bodies from prose evidence and harden
  database, export, and rendered-README boundaries.
- Publish the research review, methodology, evaluation workflow, and explicit
  non-clone product boundary.

## 0.1.0

- Initial local iMessage and Contacts ingestion, deterministic metrics, bounded
  study packets, profile storage, Agent Skill installation, and drafts-only
  workflow.
