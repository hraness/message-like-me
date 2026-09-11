# Ghostget integration contract

Textbutler consumes Ghostget's public CLI surface. It does not share Ghostget's
desktop helper socket, read its private permission store, access `chat.db`, or
automate Messages independently. This keeps Textbutler's lifecycle separate
from ongoing Ghostget permission, vault, and desktop work.

## Current source evidence

Inspection of Ghostget 0.18.0 at `dc70c58` on 2026-09-11 found:

| Surface | Current usable boundary |
| --- | --- |
| Conversation listing | Bounded direct-iMessage conversation metadata |
| Exact conversation read | Account incarnation plus chat GUID, service and observed row ID; bounded recent history |
| Native Contacts directory | No public operation in this surface |
| Generic messaging routes | Newly minted opaque references that expire after 15 minutes |
| Text sending | Exact preview and owner-confirmed plan with receipts |
| Autonomous send permission | No renewable, recipient-scoped grant contract |
| Durable message events | No cursor/replay contract or continuation for these reads |
| Rich actions | Internal helper methods exist, but are not admitted public operations here |

Textbutler can persist read-only conversation coordinates outside contact
memory, recheck account and participant identity, and initialize bounded
history after owner selection. Such a binding is not send authority. A rolling
history poll could observe new messages, but cannot prove that no messages
were missed; no lossless-subscription claim follows from polling.

The current Ghostget desktop helper is tied to its application lifetime.
Textbutler's own LaunchAgent must not rely on that helper remaining alive or
take over its process custody.

## Needed for unattended replies

The following describes required semantics, not invented callable methods.
Ghostget can choose its public naming and implementation.

1. **Stable conversation binding.** Issue an opaque binding for a client,
   provider account and account incarnation, exact conversation and participant
   set. Resolve or renew it without making the agent choose raw recipient
   coordinates. Participant/account changes invalidate the old binding.
2. **Explicit owner grant.** Bind authority to the client, conversation binding,
   allowed action kinds, expiry, revision and limits. Enrollment is the owner's
   explicit grant step. Revocation and narrowing take effect at the provider's
   send boundary. An operation-wide permission or one-time preview confirmation
   must not be promoted into this grant.
3. **Recoverable events.** Provide a bounded cursor, replay, gap detection and
   catch-up status for the selected conversations. Preserve message identity,
   author, provider time, revision, reaction distinction and outgoing owner
   activity. An unknown gap pauses automation. History catch-up never itself
   triggers a response.
4. **Prepared actions.** Bind the exact ordered action list, context revision,
   contact grant, expiry and caller idempotency key in a digest. Recheck those
   facts atomically immediately before the provider's effect. Reject stale
   context or revoked grants before submitting any part.
5. **Durable outcome.** Journal before the effect and return a receipt with
   submitted, failed, partial or indeterminate state. Provide an independent
   reconciliation operation for uncertain outcomes. Neither side blindly
   retries a possibly submitted action.

Textbutler retains owner cooldown, global/contact pause, burst collection,
rate limits, classification, contact memory, and disclosure. A grant does not
skip those checks. Textbutler's journal is additional protection; it cannot
replace the provider's own atomic permission and effect checks.

## Rich actions

Advertise each capability independently: attachments, reactions, stickers,
links, App Clips and experiences. Validate file ownership and exact bytes,
message-target membership, payload bounds, and account capability at prepare
and submit. Include supported reaction forms and experience identifiers in
capability metadata; arbitrary native payload injection is not a capability.

A Textbutler response containing only nontext actions starts with a disclosed
text companion. Ordered execution must stop if that companion fails. The
provider receipt identifies each submitted part, including partial or unknown
outcomes, so Textbutler can avoid undisclosed or repeated follow-up actions.

Linq's hosted rich-message APIs are a reference for experience design, not
evidence that the current Ghostget adapter implements them. An optional Linq
transport needs its own explicit sender/account setup and authenticated event
ingress. It cannot silently substitute another sender for the owner's native
iMessage conversation.

## Activation evidence

Before enabling unattended replies, run synthetic boundary tests, then a
bounded owner-authorized live test with exact conversation/account identity,
grant issue and revocation, owner takeover, event reconnect/gap handling,
ordered disclosure and rich actions, cancellation, and uncertain-send
reconciliation. Record the exact Ghostget/runtime versions and capability
receipt. Unsupported operations remain unavailable after source publication.
