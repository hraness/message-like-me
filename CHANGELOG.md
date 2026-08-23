# Changelog

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
