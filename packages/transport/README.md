# Textbutler transport

This package validates the boundary between Textbutler and Ghostget. The daemon
owns the client; a model receives only recipient-free proposed action tools.
It never receives account configuration, grant IDs or the Ghostget control API.

`createGhostgetAutomationClient()` validates the private
`ghostget.messaging-automation/1` owner protocol. The Textbutler daemon supplies
the supervised stdio process. `createGhostgetAutomationTransport()` binds a
transport instance to one durable enrollment and a trusted attachment-byte
admission function. Neither constructor reads provider databases.

The client covers exact enrollment, current capabilities, durable observations,
bounded history, grant issuance and recovery, byte admission, prepared actions
and durable outcomes. Plans bind their action order, bytes, conversation revision
and expiry. Submission consumes the local claim before invoking Ghostget;
missing or invalid receipts remain indeterminate. Cancellation requests the
provider stop and still waits for its original result.

Action intents include text, attachments, reactions, stickers, links and polls.
App Clips and experiences have typed intents but no current native executor.
Unsupported operations stay unavailable. Textbutler applies disclosure and
contact policy before preparation; Ghostget independently enforces its managed
permissions, recipient grant and dispatch checks.

`createGhostgetTransport()` and `createGhostgetWhatsAppTransport()` preserve the
older bounded-read/owner-confirmed CLI contracts. Their expiring opaque routes
are not durable automation enrollment. They do not acquire new authority when
the owner protocol is installed.

See [the Ghostget contract](../../docs/textbutler/ghostget-contract.md),
[WhatsApp behavior](../../docs/textbutler/whatsapp.md), and
[runtime setup](../textbutler/README.md). Tests use synthetic identities and do
not assert real message delivery.
