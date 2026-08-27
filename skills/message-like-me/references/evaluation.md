# Evaluate a messaging profile

Use a temporal holdout to learn where a profile helps and where it overreaches.
This is a fidelity audit of unsent candidates, not a test of whether the agent
has cloned the user. A historical reply is one observed response under past
circumstances, not the uniquely correct response now.

## Separate study evidence from held-out evidence

Choose one canonical ISO cutoff before opening the study examples. Prepare and
apply a profile only from evidence before that cutoff:

```sh
messagelikeme study prepare <contact-id> \
  --before <cutoff> \
  --output <private-study-file> \
  --limit 24 \
  --json
```

After the profile is fixed, prepare later cases as two distinct private files:

```sh
messagelikeme evaluate prepare <contact-id> \
  --after <cutoff> \
  --prompt-output <private-prompt-file> \
  --reference-output <private-reference-file> \
  --limit 8 \
  --json
```

`--after` is inclusive and an optional `--before` is exclusive. Use the same
session and burst gap settings on study, inspection, and evaluation when the
results will be compared. Record both paths and the receipt, but do not open,
search, summarize, or delegate the reference file yet. File separation is a
procedural blind, not cryptographic access control.

## Draft before opening the reference

Open only the prompt packet and the current profile. For each prompt `case.id`:

1. resolve the current obligations, meaning, and facts in the inbound context;
2. record one candidate as an ordered sequence of message bubbles;
3. note any question that requires the user's current judgment; and
4. fix every candidate in a private artifact outside Git.

Do not use the reference path, a broad message query, or another historical
view to infer the outgoing replies. Do not revise a candidate after seeing its
reference and call it a blind result. If the reference was opened early,
disclose that the case is contaminated and prepare a fresh time window if one
is available.

## Compare by dimension

Only after all candidates are fixed, open the reference packet. Verify that its
`evaluationId`, `contactId`, evidence window, and case IDs match the prompt.
Compare each candidate with the corresponding historical outgoing sequence:

- intent and obligation coverage, including answered, acknowledged, deferred,
  and missed inbound points;
- meaning and factuality, especially invented facts, commitments, beliefs, or
  availability;
- prose choices supported by the profile;
- delivery shape, including bubble count, order, relative length, follow-ups,
  and explicit reply use;
- privacy failures such as importing a distinctive phrase, anecdote, name, or
  detail from another context; and
- calibration, including places where weak evidence should have produced a
  neutral draft or a question for the user.

Keep failures visible and report uncertainty. Prefer a per-case, per-dimension
comparison over one similarity score. When useful, compare with an unprofiled
neutral baseline so surface mimicry is not mistaken for better content.

Reference packets distinguish explicit-reply evidence from unavailable reply
metadata. Compare reply choices only for eligible historical messages. An X
archive case with unavailable reply observability cannot confirm either a
matching reply or a matching non-reply.

Never treat historical agreement as authorship, approval, identity fidelity,
or permission to send. The audit ends with local findings and unsent text.
