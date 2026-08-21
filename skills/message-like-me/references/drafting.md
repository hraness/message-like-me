# Draft messages that sound like the user

Use this workflow only for an unsent draft. The profile is evidence for
relationship-aware choices, not a simulation of the user or a source of facts
about what they believe now.

## Select the applicable profile

Load the compact local drafting context with:

```sh
messagelikeme context <contact-id> --json
```

This view is preferred over reopening a study packet. It combines the current
stored profile with deterministic metrics and reports when the profile is
missing or stale for the current person or conversation evidence revision.

Use the narrowest profile supported by the situation:

1. A current person-specific or conversation-specific rule for a comparable
   context.
2. A current context rule supported across contacts.
3. The general baseline.

Fall back rather than inventing precision. If no profile is applicable, say so
and offer a neutral draft or analyze a bounded study packet first.

## Resolve the content before styling it

List what the current incoming message and the user's request call for: facts
to answer, decisions to make, emotions to acknowledge, questions to return,
and any point that should remain open. Resolve conflicts in this order:

1. current truth, supplied facts, and necessary uncertainty;
2. the user's present intent, audience, and requested format;
3. complete and safe handling of the current message; and
4. well-supported historical style and delivery-shape tendencies.

Do not add a commitment, excuse, intimacy, opinion, availability claim, belief,
or personal detail the user did not provide. Never import historical content
merely because it appeared in an example. Ask the user when a missing current
fact materially changes the reply.

When several things need a response, decide the content order before choosing
message boundaries. Apply the profile's observed behavior for grouping,
acknowledging, deferring, and changing topics. Do not mechanically answer every
sentence if the user normally consolidates related points.

## Apply voice and tempo

Apply the `draftingConsequence` of claims whose scope and confidence fit the
current context. Treat inferred claims more cautiously than measured shape
facts. Match durable dimensions rather than copying private phrases:

- register, directness, warmth, and amount of explanation;
- fragments or full sentences, capitalization, and punctuation;
- typical use of slang, laughter, emoji, questions, and closings;
- one bubble or a burst, with realistic relative lengths;
- a short acknowledgement before a fuller answer when the profile supports it;
- explicit reply links only when the observed profile and current ambiguity
  support them.

Do not simulate a delayed response or claim the user will reply at a particular
time. Historical timing is **within-session response latency under recorded
gap settings**. It describes selected past response episodes and never tells
the agent when to answer. Tempo used in a draft means the shape of the outgoing
turn, not automated timing.

## Present drafts clearly

Label the result as a draft. Render each intended message bubble as its own
block in order. Keep optional explanation outside the draft so it cannot be
mistaken for text to send.

When uncertainty matters, offer at most a small number of materially different
variants and name the difference plainly, such as warmer, more direct, or one
bubble instead of three. Do not generate a menu of superficial paraphrases.

Never send the result or operate Messages. End with the unsent draft and any
fact the user still needs to decide.
