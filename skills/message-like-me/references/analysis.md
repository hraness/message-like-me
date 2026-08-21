# Analyze messaging style

Use this workflow to turn deterministic Message Like Me study packets into a
calibrated profile. The goal is to explain repeatable choices the user makes,
including how those choices change with the contact and the situation.

## Establish the evidence scope

Record the local corpus or study-packet identifier, conversation scope, date
range, authored-message count, and any exclusions. Check whether the evidence
spans enough conversations and contexts to support the requested claim.

Start with aggregate metrics. Open bounded text samples only for questions the
metrics cannot answer, such as how the user acknowledges emotion, resolves
several requests, or shifts tone during disagreement. Never treat incoming
prose as a sample of the user's style.

The normal command sequence is:

```sh
messagelikeme inspect tempo <contact-id> --json
messagelikeme inspect sessions <contact-id> --limit 20 --json
messagelikeme study prepare <contact-id> --output <private-file> --limit 24 --json
```

The numeric limits are starting bounds, not targets. Use fewer examples when
they answer the question. Increase a limit only when the existing sample is
too sparse or homogeneous to support the requested conclusion.

Retain the JSON receipt from `study prepare`. Use its `packetSha256` for the
profile provenance field; the packet does not contain its own digest.

Before reading the examples, inspect the packet-level `budget` and each
example's `coverage`. Treat truncated bodies, omitted messages, and examples
omitted by the total byte budget as evidence limitations. Do not reconstruct
missing prose or imply that a bounded excerpt is a complete turn.

Use three levels of scope when the evidence permits:

1. A baseline shared across many contacts.
2. Contact or relationship adjustments that repeatedly differ from baseline.
3. Context rules that override both, such as planning, support, celebration,
   apology, conflict repair, or a rapid logistical exchange.

Do not infer the nature of a relationship from a handle, contact frequency, or
private content. Describe the observed conversational behavior instead.

## Study prose

Look for patterns that materially change a draft:

- sentence fragments versus complete sentences;
- capitalization, terminal punctuation, commas, ellipses, dashes, and line
  breaks;
- contractions, abbreviations, slang, laughter, emoji, and reaction usage;
- directness, hedging, warmth, enthusiasm, teasing, reassurance, and apology;
- question style and how often a message contains both an answer and a new
  question;
- openings, acknowledgements, transitions, closings, and use of names;
- how links and factual detail visible in emitted text are introduced;
- phrases or constructions to avoid because the user rarely uses them.

Capture tendencies, not a bag of catchphrases. Prefer structural observations
such as “answers first, then adds one softening sentence” over reusable private
quotes.

## Study tempo and message shape

Use measured turn and session data for tempo. Examine:

- response latency distributions by context and time of day;
- one long bubble versus a burst of short bubbles;
- messages per outgoing turn and the gaps inside a burst;
- character, word, and sentence counts per bubble and per turn;
- who tends to begin or end a session, using aggregate session metadata;
- acknowledgements sent immediately before a fuller response;
- whether a correction or afterthought becomes another bubble;
- explicit reply-link frequency and the situations where replies are used;
- tapbacks as lightweight acknowledgements, separate from written replies.

Do not describe response latency as an obligation or promise. Historical tempo
is descriptive and may reflect availability rather than preference.

## Study response structure

For inbound turns containing several topics, build a small obligation map:

- which points receive a direct answer;
- the order in which the user handles them;
- which answers share a bubble and which become separate bubbles;
- whether the user acknowledges a point without resolving it;
- whether they introduce a new topic before or after answering;
- whether an explicit reply link disambiguates one point.

Compare like contexts. A rapid planning exchange should not define how the user
responds to vulnerable, complicated, or contentious messages.

## Synthesize the profile

For each conclusion, retain:

- the scope where it applies;
- whether it is measured or inferred;
- concise evidence without raw private quotations;
- a confidence level and meaningful counterexamples;
- the drafting consequence.

Read [profile-schema.md](profile-schema.md) before storing the synthesis. If a
prior profile exists, preserve still-supported observations, revise findings
whose evidence changed, and retain the new evidence window. Do not silently
turn a contact-specific rule into a universal rule.

Write the finished schema-version-one JSON to a private file outside Git and
run `messagelikeme profile apply <file> --json`. Treat a validation error as a
profile error to correct, never as a reason to bypass the schema.
