A messaging assistant needs two kinds of judgment. It must understand a conversation well enough to write a useful reply, and it must know which account and conversation that reply belongs to. TextButler separates those jobs: GhostGet connects to messaging apps, while TextButler manages the assistant in each chat.

## Connect the conversation once

[GhostGet](https://ghostget.com) provides native iMessage and WhatsApp connections and a connection through Beeper. You set up the messaging account, then choose a direct conversation in TextButler. Selecting it creates a contact with automatic replies off.

You can import recent messages from that conversation as context. Importing history does not send anything or turn on replies. The history helps the assistant understand what was said before it joined.

For Beeper, the connection reads conversation history and sends text while Beeper Desktop is open. Support varies by messaging app; the [messaging guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/messaging-apps.md) describes the available connections and setup requirements.

## Reading a message is separate from answering it

Suppose a friend asks when to meet. GhostGet gives TextButler the message in the selected conversation. TextButler then checks whether that contact is enabled, whether the message fits the response mode, and whether you have recently written in the chat.

In the default keyword mode, the request must include “butler”. Smart mode can recognize a request without that keyword. Both modes use the same contact settings and activity checks.

If TextButler decides to answer, it combines the conversation with the notes you keep for that contact and asks your chosen model for a reply. GhostGet does not choose the model or write the answer.

This separation lets you choose a reply writer without setting up your messaging account again. A local model, a hosted model and a subscription model can use the same connection.

## A proposed reply still has to be sent

The model returns a proposal. TextButler checks it against the selected conversation and applies the contact’s disclosure settings before asking GhostGet to send it.

For a draft you review, TextButler shows the recipient and the complete reply. The send command refers to that reviewed version. For automatic replies, the contact must be enabled and the assistant resumed.

Keeping these steps separate matters when something fails. A messaging app accepting a request does not mean the other person received it. If TextButler cannot tell whether a message went through, it pauses further automatic activity for that contact rather than sending the same message again.

## Keep account access separate from conversation notes

Your notes explain the relationship and how the assistant should respond. They do not contain the messaging sign-in or decide which account may send. Account connections and contact controls live outside the files the model can edit.

That gives each part a clear job. GhostGet connects to the messaging service. Your model writes a proposed response. TextButler checks the conversation and decides whether that response may leave your Mac.

To try the connection, follow the [TextButler setup guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md), select one conversation, and review a draft before enabling automatic replies.
