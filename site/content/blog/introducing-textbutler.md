TextButler adds an assistant to the direct and group chats you choose on your Mac, across iMessage, WhatsApp, and Beeper. In its default mode, someone asks for it by saying “butler”, and its replies carry an AI marker. Your friends use their existing messaging app.

## Start with one conversation

Imagine a friend asking which train you agreed to take. The answer is already in your conversation, several days back. An assistant can find it and reply while you are away from the chat.

TextButler keeps useful context close to the conversation. Each chat has its own notes: how you talk, what matters, and what the assistant should leave to you. You can read and edit those files on your Mac.

Add it to a group to help with shared plans and questions. The group gets separate notes, with context from new messages after you add it. Choose the group and review its members; if the account or membership changes, select it again before replies resume.

New installations start paused, and every conversation starts with automatic replies off. You choose the conversation and turn it on.

## Follow a message through the system

[GhostGet](https://ghostget.com) connects TextButler to messaging apps on your Mac. It handles reading and sending; TextButler decides whether to answer and prepares the reply. This example uses the default keyword mode with the AI marker on.

![In default keyword mode, a request passes through GhostGet and TextButler’s checks, then returns as a marked reply](/diagrams/d1-one-message-narrow.light@2x.png#gh-light-mode-only)
![In default keyword mode, a request passes through GhostGet and TextButler’s checks, then returns as a marked reply](/diagrams/d1-one-message-narrow.dark@2x.png#gh-dark-mode-only)

When a message arrives in an enabled conversation, TextButler checks the conversation, the response mode, recent activity from you, and the reply limit. A burst of messages gets time to settle before it answers. If you have just written in the chat, it skips the request instead of saving it for later.

For a request it accepts, TextButler sends an acknowledgment, reads that chat’s notes and recent conversation, and asks your chosen model to write a reply. The default acknowledgment is `🤖{ 👀 }`, and the reply uses the same `🤖{ }` marker.

You can pause automatic replies or turn off one conversation. You can also ask for an unsent draft, inspect its words and recipient, and send the version you reviewed.

## Choose when it answers

**Keyword mode** is the default. TextButler looks for “butler” as a whole word, in any capitalization. Messages without the keyword receive no automatic answer.

**Smart mode** can answer an assistance request without the keyword. It asks a model whether help was requested and stays silent when the result is uncertain. The same contact settings, cooldown and reply limits apply.

The marker is also configurable for individual contacts. It stays on by default and cannot be removed in your own chat. Keep it visible so the person receiving a reply can tell when the assistant wrote it.

## Choose where replies are written

TextButler offers three routes:

- A local model through Ollama, which writes the reply on your Mac.
- Your Vercel AI Gateway key, which sends conversation context to the hosted model.
- Your Claude Code, Codex, or Devin subscription through [xcb](https://xcb.sh), which sends context through that provider’s tool.

Choosing a local reply model does not make every optional feature local. Web search uses a saved Gateway key and sends queries to a search service. Each contact’s settings control whether search is available.

An explicit provider choice takes precedence. Otherwise, a saved Gateway key takes precedence over a detected local model. The [setup guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md) keeps the current model choices and commands together.

## Keep the useful context close

Each direct or group conversation has a folder of plain files on your Mac. You can read and edit the notes. Your account settings and sign-ins live separately from those files.

Optional learning can revise reply guidance for one conversation after comparing it with past examples. It starts off. [How TextButler uses ALGAL](/blog/how-textbutler-uses-algal) explains the comparison and its limits.

Connect your messaging apps, choose what writes replies, and turn on the direct or group conversations where you want an assistant. Follow the [setup guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/getting-started.md) or give the setup prompt to your coding agent.
