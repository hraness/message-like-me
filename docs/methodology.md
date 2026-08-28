# Methodology

Message Like Me separates deterministic measurement from semantic judgment.
The CLI reads local data, constructs versioned artifacts, and reports counts
and distributions. An Agent Skill interprets a bounded sample and drafts
unsent text. Neither component establishes that a draft is what the user would
have written.

## Data boundary

The Messages database and optional AddressBook databases remain authoritative.
The CLI makes stable private snapshots and opens only those snapshots through
SQLite. It does not modify Messages, Contacts, their databases, or their
transactional sidecars.

A caller-owned local message bundle is a separate versioned source
observation. The CLI verifies its complete fixed inventory and digests before
ingest, never obtains its provider credential, and does not call its producer.

A caller-owned X data archive is another offline source observation. The CLI
parses bounded supported entries directly from the owner-only ZIP without
extracting files, evaluating archive JavaScript, accessing a network, or
downloading media. It preserves exact archive and account provenance. The
archive source covers direct messages, not X Chat. Bounded reply and mention
identity observations from selected tweet members may associate a provider user
ID with an X handle or display name; tweet prose is not added to the messaging
corpus or used as style evidence.

The normalized corpus, private installation key, aggregate metrics, profiles,
and drafting context stay in the local data root. Study, evaluation, and agent
handoff files are written only to explicit paths. Ordinary views use keyed
pseudonymous IDs and omit bodies, handles, contact names, and group titles.

This is a process boundary, not encryption. Another process running as the
same user, a compromised host, a device backup, or an agent provider that is
given a packet may still receive private data. Incoming messages also belong
to other participants. They provide response context but never become samples
of the user's prose.

## Normalized observations

The corpus preserves source, account, network, message direction, provider
ordering, timestamp, body availability and source, message kind, attachment
metadata, edit or retraction metadata, reply target and reply observability,
service, and conversation membership where the source supports them.
Unsupported, deleted, or truncated text remains unavailable rather than being
reconstructed. A truncated text record still represents a message bubble for
tempo and any observable reply evidence, but never contributes prose.

Native iMessage history and each connected bundle account have distinct source
namespaces. A bounded, truncated, or unknown bundle is not an authoritative
statement that omitted history no longer exists. Reimport merges present
records with retained state. Only explicit deletion, removal, replacement, or
tombstone state suppresses evidence, and a later record reappearance clears
that suppression. Bundle creation times are monotonic per source, so an older
snapshot cannot resurrect or overwrite newer state.

An X archive normally has its own source namespace and retains its exact ZIP
and account provenance. The caller may name an existing Beeper X source as an
overlap only when both sources describe the same exact account. Reconciliation
is limited to one-to-one direct conversations and requires an exact peer handle
plus exact shared-message evidence. It retains both provenances and lets one
proven exact message contribute once. Group DMs remain separate because the
legacy archive cannot establish cross-provider sender identity strongly enough.
Missing or contradictory evidence fails closed. Proven equivalence survives
later reingests, so the same message does not return as a duplicate. Archive
absence does not suppress retained history.

The analysis uses several operational units:

- A **message** is one source record. Only outgoing text bodies contribute to
  surface-style measurements.
- A **burst** is a run of messages in one direction whose neighboring records
  remain within the configured burst gap. The default gap is five minutes.
- A **session** is a run of conversation activity without a gap longer than
  the configured session gap. The default gap is eight hours.
- A **response episode** pairs an incoming burst with the next outgoing burst
  in the same session.
- An **explicit reply** is source metadata linking a message to an earlier
  message. It is distinct from a reaction or an ordinary adjacent response.
  Reply observability is recorded separately: X data archives do not expose
  reply links, so their messages are unavailable rather than observed
  non-replies.
- A **reaction** is counted as interaction behavior, not authored prose. A
  reaction without a provider timestamp contributes to counts and direction
  but not to temporal order, sessions, bursts, or response episodes. Raw
  provider reaction values remain private and are not categorical dimensions
  in aggregate metrics or drafting context.

Five minutes and eight hours are reproducible segmentation parameters, not
claims about natural conversational boundaries. Every metrics artifact records
the parameters used. Comparisons are meaningful only when their definitions
match.

## Deterministic metrics

For each conversation, the CLI reports the evidence window and counts of
incoming, outgoing, text, session, burst, and response records. Tempo metrics
include response-latency quantiles, outgoing messages per response, the ratio
of single-message to multi-message responses, multi-message inbound contexts,
visible multi-question contexts, and explicit reply frequency. Reply metrics
report explicit, eligible, and unavailable messages separately, and calculate
the ratio only from eligible messages. Session, burst, and response
construction runs independently for each source conversation before
person-scope results are combined. Adjacent timestamps in two apps or threads
never create one artificial episode. Mixed person scopes expose their sorted
service breakdown.

Surface measurements cover characters and words, lowercase starts, terminal
punctuation, question and exclamation marks, emoji-bearing messages, and
multiline messages. These are observable features, not explanations. For
example, visible question marks are only a proxy for questions, and a long
latency cannot reveal whether the user was busy, asleep, deciding what to say,
or simply missing local history.

Session starts and ends are likewise structural facts under the configured
threshold. They do not identify who cares more, who is avoiding whom, or the
nature of a relationship.

## Bounded semantic study

`study prepare` selects response episodes that contain both incoming and
outgoing text. The version-one selector favors coverage of different response
shapes, tags, lengths, reply use, latency bands, and positions across the
available time window. It is deterministic for the same corpus, bounds, and
parameters.

The CLI default packet limit is 24 examples. Each emitted body is capped at 4 KiB,
each direction keeps at most 12 text messages per example, and total emitted
body text is capped at 256 KiB. Coverage metadata states what was truncated or
omitted. A packet is a sample of response contexts, not a transcript.

Version 0.2 added temporal bounds to study selection. A profile intended for
held-out evaluation should use only examples before the chosen cutoff. The
cutoff, corpus revision, selection parameters, packet receipt, and evidence
window form part of the analysis provenance. Profile validity uses a digest of
the selected person or conversation scope within those exact time bounds, so a
later message outside a closed study window does not rewrite its evidence.

The agent studies prose, delivery shape, multi-point response strategy, reply
use, and exceptions. It must keep measured facts separate from interpretations
and cite study-example IDs instead of copying private phrases into a profile.
The resulting profile records its contact scope, corpus revision, exact packet
digest, analysis time, contextual rules, limitations, and confidence.

Profile provenance proves which artifact was analyzed. It does not prove that
the agent interpreted that artifact correctly.

## Held-out fidelity audit

Version 0.2 provides a two-file evaluation preparation workflow:

```sh
messagelikeme evaluate prepare <contact-id> \
  --after <cutoff> \
  --prompt-output <private-prompt-file> \
  --reference-output <private-reference-file> \
  --json
```

The prompt side contains held-out inbound context. The reference side contains
the corresponding historical outgoing response and must remain unopened until
the candidate drafts have been recorded. File separation supports a blind
workflow, but it is not cryptographic blinding. A user or agent with access to
both paths can read both files.

A checked audit proceeds as follows:

1. Choose a temporal cutoff before studying the contact.
2. Build and apply the profile from evidence before that cutoff.
3. Prepare evaluation examples after the cutoff.
4. Give the drafting agent the prompt file and current profile, but not the
   reference file.
5. Record one candidate bubble sequence for each evaluation example.
6. Open the reference file only after the candidates are fixed.
7. Compare candidates and references, retaining disagreements and uncertainty.

The CLI prepares bounded, provenance-bearing evidence. It does not
automatically declare a candidate correct or assign a universal fidelity
score. Semantic comparison still requires judgment, preferably including the
user whose style is being studied.

Comparison should keep these dimensions separate:

- **Intent and obligation coverage:** which inbound points the candidate
  addresses, defers, acknowledges, or misses.
- **Meaning and factuality:** whether the candidate invents facts, changes
  commitments, or imports a historical belief that does not belong in the
  current draft.
- **Prose:** register, directness, warmth, sentence shape, punctuation, and
  other supported tendencies.
- **Delivery shape:** bubble count, ordering, per-bubble length, follow-ups,
  and explicit reply choice.
- **Privacy:** reuse of names, distinctive phrases, anecdotes, or details that
  came from another historical context.
- **Calibration:** whether sparse or contradictory evidence should have caused
  the agent to use a neutral default or ask the user.

The historical response is a reference observation, not a unique correct
answer. The user might reasonably respond differently now. Results should be
reported by dimension and example, alongside an unprofiled drafting baseline
when possible. A single similarity score hides the failures that matter most.

## Drafting method

Ordinary drafting uses the current deterministic context and the applicable
validated profile. The user's present intent, supplied facts, uncertainty,
and requested format outrank historical style. Contact-specific rules apply
only to their supported scope; context rules can override broad tendencies.

The output may be one message or several separately presented bubbles. A
historical latency distribution never instructs the agent to delay its answer.
Every result remains an unsent candidate. Message Like Me has no command for
sending, reacting, scheduling, or operating a messaging application.

## Sources of error

Reported behavior can be distorted by:

- Messages that are not synchronized to the Mac or are no longer present;
- partial local provider exports whose completeness bounds exclude older or
  remote history;
- X archives that predate recent messages, omit X Chat, or cannot report
  explicit reply links;
- unsupported body encodings, attachments, edits, retractions, or source
  schema changes;
- ambiguous or stale Contacts labels;
- group conversations whose audience changes over time;
- timezone changes, work schedules, sleep, travel, notification settings, and
  device availability;
- a bounded packet that underrepresents rare but important contexts;
- simple surface proxies that miss pragmatic meaning;
- model and prompt differences in the agent interpreting a packet; and
- genuine drift in how the user communicates.

For reproducibility, retain schema versions, corpus revision, packet digest,
time bounds, segmentation parameters, budget and coverage fields, and the
agent environment used for semantic analysis. Re-ingest and re-evaluate when
the corpus changes materially. Describe uncertainty instead of broadening a
contact-specific observation into an identity claim.

## What the method can support

The checked artifacts can support statements such as "within this evidence
window, multi-message responses were more common for this conversation" or
"the held-out candidate reproduced the historical bubble count but missed one
inbound question."

They cannot support statements that the system has cloned the user, recovered
their personality, diagnosed a relationship, proved authorship, predicted a
future decision, obtained a contact's consent, or produced a message approved
by the user.
