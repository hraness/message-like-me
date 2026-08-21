# Messaging profile schema

A profile is durable semantic analysis backed by a deterministic local study
packet. It is not a transcript, contact record, or prompt dump. The CLI's
`StyleProfileV1` parser is the serialization authority. Every field below is
required unless the type explicitly permits an empty array.

## Identity and evidence

Every profile begins with:

- `schemaVersion: 1`;
- `contactId`, copied from the study packet;
- `corpusRevision`, copied from the study packet;
- `packetSha256`, copied from the JSON receipt printed by
  `messagelikeme study prepare ... --json`;
- `analyzedAt`, a canonical ISO timestamp;
- `overview`, a concise synthesis of the contact-specific style.

Use private HMAC-derived identifiers supplied by the CLI. Do not add handles,
phone numbers, email addresses, contact names, group titles, or raw excerpts to
identity fields.

The packet does not contain its own digest. Use the receipt value exactly; do
not hash parsed JSON or reconstruct the digest from memory.

## Analysis sections

Keep these required sections distinct:

- `prose` contains string fields `register`, `capitalization`, `punctuation`,
  `vocabulary`, `warmth`, and `humor`, plus string arrays `openings`,
  `closings`, and `notablePatterns`.
- `tempo` contains string fields `defaultBundle`, `singleLongMessage`,
  `multipleMessages`, `responseTiming`, and `followUps`.
- `replies` contains a string `usage` plus string arrays `useWhen` and
  `avoidWhen`.
- `contexts` is an array of objects with string fields `when`,
  `incomingPattern`, `responseStrategy`, `prosePattern`, and `tempoPattern`,
  plus `evidenceExampleIds`, an array of study-example IDs.
- `invariants` lists broadly supported rules that should survive context
  changes.
- `avoid` lists constructions that are atypical, easily caricatured, or
  private one-offs.
- `confidence` contains `overall` (`low`, `medium`, or `high`) and a string
  array `limitations`.

Do not store a reusable list of private catchphrases. A profile should explain
how to make a choice, not provide text to copy.

Ground prose, tempo, and reply descriptions in the packet's deterministic
metrics. Use `contexts[].evidenceExampleIds` for semantic support instead of
copying message text. Put counterexamples, sparsity, and drift in
`confidence.limitations`. Never present an inferred label as a measured fact.

## Personalized skill output

When the user asks for a reusable personalized messaging skill, select current
validated profiles across the intended contact scope. Export each one to an
explicit private path:

```sh
messagelikeme profile export <contact-id> --output <private-file>
```

Derive the skill from those profiles rather than embedding a corpus or study
packet. When several contacts are in scope, synthesize the shared baseline
first, then retain only repeated contact or context adjustments. Keep:

- the general voice and turn-shape rules that are supported broadly;
- contact or context adjustments only when they can be selected without
  exposing identifying metadata;
- the drafting boundary that preserves meaning and produces unsent text only;
- the privacy rule that message data never leaves the local workflow.

Exclude corpus paths, handles, message IDs, verbatim excerpts, raw evidence,
and analysis prompts. The generated skill should remain useful if the raw
study packet is later removed, while its source profile retains local evidence
provenance.

## Revision

Revise a profile when new evidence changes a rule, a contact-specific pattern
drifts, or the prior sample was sparse. Preserve still-supported findings and
record the new evidence window. Do not silently broaden scope, erase
counterexamples, or overwrite a higher-confidence observation with a small
recent sample.
