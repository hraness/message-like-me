If software answers in your chats, the honest question is how anyone in the conversation knows it is not you. TextButler's answer is not a label the model remembers to add. Marking lives in the send path, so it applies even when the model, a draft, or an unusual message type is involved.

## Every text reply carries the wrap

The model proposes actions; it never sends them. After owner-installed hooks have had their say, trusted code wraps each text action in the contact's three disclosure symbols. Each symbol is either empty or exactly one visible character; anything invisible or longer is rejected.

By default a reply reads `🤖{ hello this is my response }`, so the person reading sees the marker before they read a word. Clearing all three symbols removes the wrap and sends plain text. That is a per-contact setting you choose, not something the assistant decides.

## What cannot carry a wrap

Reactions, stickers, link previews, and app cards cannot carry a text prefix. While markers are configured, any response that is not plain text sends a disclosed text companion first, and that companion counts toward the eight-action limit on a single reply. The provider must run the actions in order and stop if the companion fails, so a sticker never lands before its label.

An app card may still name TextButler in its content, but that never replaces the companion. With disclosure fully cleared, the companion is not added either: unexplained extra text would be its own kind of confusion.

## Clearing the wrap hides nothing

The visible wrap is for your contacts. The record is for you. When the provider accepts a message, the transport reports its message IDs, and a private sends journal marks each one `butler` or `operator`. History and attribution check that journal first, so butler output stays identified as butler output even when the wrap is cleared.

The wrap itself becomes only a fallback for messages that predate the journal. An `operator` row also wins over appearances: your own words stay owner-authored even when they quote the marker.

## Drafts show the mark you would send

`textbutler replies suggest CONTACT` asks the contact's agent for a draft. The suggestion holds a summary, the exact proposed actions, and the disclosed preview the send would carry, and it expires after fifteen minutes. It is bound to the conversation revision and disclosure settings it was created under: changed context, changed symbols, or an expired draft is rejected rather than sent.

`textbutler replies show DRAFT` lists every disclosed action in order, the exact recipient, attachment hashes, and the review digest. `textbutler replies send DRAFT DIGEST` sends only that reviewed draft. There is no path where a different, unmarked version of what you reviewed leaves the Mac.

## When the owner writes

`textbutler replies send` with the explicit operator field sends your text word for word through the same checks and journal, with no wrap. Only that field reaches the owner path: the butler, the agent, and the default send command cannot use it. Each operator run needs an idempotency key, claimed under `operator:KEY`, so repeating a key reports the first outcome instead of sending twice, and the journal keeps those runs for 400 days so each key sends at most once.

An uncertain operator send is never retried on a guess. It waits until you record `--sent` or `--failed`, because an indeterminate outcome cannot prove the first attempt did not arrive.

## What learning cannot touch

Optional contact learning can adjust tone and formality. It cannot change the disclosure symbols, the recipient, the tools, or the model account. Owner-written context in `soulCore` is a fixed anchor the model cannot edit, and learned text never grants a capability or invents a relationship.

Marking is therefore not a mood the assistant is in. It is a property of the send path, checked in code the model does not control.

## Go deeper

- The [architecture guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/architecture.md) covers the send transaction, the sends journal, and owner controls in full.
- [Introducing TextButler](/blog/introducing-textbutler) follows one message through the default keyword mode.
- [How TextButler uses ALGAL to compare reply plans](/blog/how-textbutler-uses-algal) explains what optional learning can and cannot change.
