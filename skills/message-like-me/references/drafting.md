# Draft messages that sound like the user

Use this workflow only for an unsent draft. A convincing draft preserves the
user's meaning first, then applies the smallest set of well-supported style and
tempo choices.

## Select the applicable profile

Load the compact local drafting context with:

```sh
messagelikeme context <contact-id> --json
```

This view is preferred over reopening a study packet. It combines the current
stored profile with deterministic metrics and reports when the profile is
missing or stale for the current corpus revision.

Use the narrowest profile supported by the situation:

1. A current contact-specific rule for a comparable context.
2. A current context rule supported across contacts.
3. The general baseline.

Fall back rather than inventing precision. If no profile is applicable, say so
and offer a neutral draft or analyze a bounded study packet first.

## Resolve the content before styling it

List what the incoming message calls for: facts to answer, decisions to make,
emotions to acknowledge, questions to return, and any point that should remain
open. Preserve the user's stated intent and factual constraints. Do not add a
commitment, excuse, intimacy, opinion, availability claim, or personal detail
the user did not provide.

When several things need a response, decide the content order before choosing
message boundaries. Apply the profile's observed behavior for grouping,
acknowledging, deferring, and changing topics. Do not mechanically answer every
sentence if the user normally consolidates related points.

## Apply voice and tempo

Match durable dimensions rather than copying private phrases:

- register, directness, warmth, and amount of explanation;
- fragments or full sentences, capitalization, and punctuation;
- typical use of slang, laughter, emoji, questions, and closings;
- one bubble or a burst, with realistic relative lengths;
- a short acknowledgement before a fuller answer when the profile supports it;
- explicit reply links only when the observed profile and current ambiguity
  support them.

Do not simulate a delayed response or claim the user will reply at a particular
time. Tempo here means the shape of the outgoing turn, not automated timing.

## Present drafts clearly

Label the result as a draft. Render each intended message bubble as its own
block in order. Keep optional explanation outside the draft so it cannot be
mistaken for text to send.

When uncertainty matters, offer at most a small number of materially different
variants and name the difference plainly, such as warmer, more direct, or one
bubble instead of three. Do not generate a menu of superficial paraphrases.

Never send the result or operate Messages. End with the unsent draft and any
fact the user still needs to decide.
