# Messaging profile schema

A profile is durable semantic analysis backed by one deterministic local study
packet. It is an inspectable evidence layer for drafting, not a transcript,
contact record, prompt dump, identity model, or claim that the user has been
cloned. The CLI's `StyleProfileV2` parser is the serialization authority.

Author new profiles with `schemaVersion: 2`. The CLI can read version-one
profiles for compatibility, but do not create or silently upgrade one without
preparing current evidence.

## Identity and provenance

Copy these root fields exactly from the packet and its JSON receipt:

- `schemaVersion: 2`;
- `contactId`, the pseudonymous person or conversation analysis scope;
- `corpusRevision`, the global source-snapshot revision;
- `packetSha256`, from the `study prepare --json` receipt;
- `analyzedAt`, a canonical ISO timestamp; and
- `overview`, a concise synthesis limited to this evidence scope.

The packet does not contain its own digest. Use the receipt value exactly. Do
not hash parsed JSON or reconstruct the digest from memory.

The required `evidence` object records the actual analysis boundary:

- `evidenceRevision`, the scope-and-window revision copied from the packet;
- `firstMessageAt`, `lastMessageAt`, and `messageCount` from packet metrics;
- `outgoingTextMessages` and `responseEpisodes` from packet metrics;
- `studyExamples`, equal to the emitted example count;
- `selectionAlgorithm`, exactly
  `bounded-diverse-response-contexts-v1`; and
- `after` and `before`, copied from `evidenceWindow`, including `null`.

`corpusRevision` preserves whole-ingest provenance. `evidenceRevision` decides
whether the selected person's or conversation's evidence changed inside the
recorded time bounds. Do not substitute one for the other. `after` is inclusive
and `before` is exclusive.

Use only private identifiers supplied by the CLI. Do not add handles, phone
numbers, email addresses, contact names, group titles, relationship labels, or
raw excerpts to identity or evidence fields.

## Descriptive sections

Keep these required sections distinct:

- `prose` contains string fields `register`, `capitalization`, `punctuation`,
  `vocabulary`, `warmth`, and `humor`, plus string arrays `openingPatterns`,
  `closingPatterns`, and `notablePatterns`.
- `tempo` contains string fields `defaultBundle`, `singleLongMessage`,
  `multipleMessages`, `responseTiming`, and `followUps`.
- `replies` contains a string `usage` plus string arrays `useWhen` and
  `avoidWhen`.
- `contexts` is an array of objects with string fields `when`,
  `incomingPattern`, `responseStrategy`, `prosePattern`, and `tempoPattern`,
  plus `evidenceExampleIds`.
- `invariants` lists broadly supported drafting rules that survive the studied
  context changes.
- `avoid` lists constructions that are atypical, easily caricatured, private
  one-offs, or unsupported by the evidence.
- `confidence` contains `overall`, `prose`, `tempo`, `replies`, and `contexts`
  levels (`low`, `medium`, or `high`) plus `limitations`.

Describe response timing as **within-session response latency under the
recorded session and burst gaps**. Do not shorten it to the user's response
time, availability, preference, or promise. Tempo used for drafting means the
shape of an outgoing turn, such as bubble count and follow-ups, never an
instruction to wait.

Do not store a reusable list of private catchphrases. A profile should explain
how to make a choice, not provide text to copy.

## Claims

Every item in the required `claims` array contains:

- `dimension`: `prose`, `tempo`, `reply`, or `context`;
- `statement`: the bounded conclusion;
- `basis`: `measured` or `inferred`;
- `appliesWhen`: the observed scope and conditions;
- `supportExampleIds` and `counterexampleIds` from this packet;
- `supportCount`, a non-negative count grounded in the cited examples or an
  exact aggregate count;
- `confidence`: `low`, `medium`, or `high`; and
- `draftingConsequence`: the smallest justified change to an unsent draft.

Use `measured` only when the statement restates a deterministic count, rate,
timestamp, distribution, or segmentation result under its recorded
definitions. Do not attach an explanation to a measured fact. For example,
the CLI can measure that three bubbles followed an inbound burst; it cannot
measure that the user was excited.

Use `inferred` for a semantic interpretation of bounded text examples, such as
the order used to address several requests. Cite every supporting example and
meaningful counterexample available in the packet, and set `supportCount` to
the number of distinct supporting example IDs. Incoming text can support an
inference about response context, but only outgoing authored text supports a
claim about the user's prose. Lower confidence when support is sparse,
truncated, homogeneous, contradictory, or time-sensitive.

All IDs in `contexts[].evidenceExampleIds`, `supportExampleIds`, and
`counterexampleIds` must exist in the bound packet. Never invent an ID, cite an
example from another packet, or turn an inferred label into a measured claim.
When a required descriptive field lacks support, state that limitation and set
the relevant confidence low instead of inventing a pattern.

## Apply and revise

Write the profile to an explicit private file outside Git and validate it:

```sh
messagelikeme profile apply <private-profile-file> --json
messagelikeme profile show <contact-id> --json
```

Treat a validation or evidence-conflict error as a profile error to correct,
never as a reason to bypass the schema. Revise a profile when scoped evidence
changes, a supported pattern drifts, or the prior sample was sparse. Preserve
still-supported findings and counterexamples. Do not broaden a person-specific
or conversation-specific observation into a universal trait.

## Personalized skill output

When the user asks for a reusable personalized messaging skill, select current
validated profiles across the intended scopes. Export each to an explicit
private path:

```sh
messagelikeme profile export <contact-id> --output <private-file>
```

Derive the skill from profiles rather than embedding a corpus or packet.
Synthesize repeated baseline choices first, then retain only supported person
or context adjustments that can be selected without identifying metadata.
Preserve the evidence-layer boundary, measured-versus-inferred discipline,
uncertainty, and the rule that present meaning and intent outrank imitation.

Exclude corpus paths, handles, message IDs, verbatim excerpts, raw evidence,
and analysis prompts. The generated skill should remain useful if the study
packet is later removed, while its source profile retains local provenance.
