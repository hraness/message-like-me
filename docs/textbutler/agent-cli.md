# Use TextButler from an agent

An agent can read conversations, summarize them, and draft and send messages
through TextButler's CLI, which returns JSON. Run it as the signed-in Mac user
with the TextButler daemon running. Connect iMessage and your AI subscription
with the [setup guide](getting-started.md) first. These commands work while
automatic replies are paused and the selected contact is turned off.

## Select a conversation

```sh
textbutler conversations list
textbutler contacts add CANDIDATE_ID
textbutler contacts list
textbutler messages capabilities CONTACT_ID
```

Use the exact IDs the previous commands return. A unique contact name also
works; ambiguous names fail. Adding a contact keeps automatic replies off. Add
`--history` to `contacts add` only when you want TextButler to import and keep
recent history. Reading current history doesn't need that import.

## Read and summarize

```sh
textbutler messages history CONTACT_ID --limit 100
textbutler contacts account CONTACT_ID native-claude-code
textbutler messages summarize CONTACT_ID --limit 100
```

History includes message IDs, authorship, time, text, related message IDs, and
attachment metadata when the provider exposes it. Attachment metadata contains
names, media types, and sizes, never local file paths or contents. `--limit`
accepts 1 to 200 messages. The response is a recent sample, not a complete
archive, and it reports shortened text and omitted records. It doesn't download
or interpret attachment contents.

Summaries use the AI account selected for the contact, which must pass its
readiness check. The response includes the source message IDs and how many
messages it used. Check the summary against those messages. A calling agent can
also summarize the history JSON itself without another model request.

## Compose, review and send

Choose one way to create an unsent draft. For an AI suggestion:

```sh
textbutler replies suggest CONTACT_ID
```

Suggestions read the current conversation without requiring a history import.
If there is no unanswered incoming message, the command returns no draft.
To provide the content yourself instead:

```sh
textbutler messages compose CONTACT_ID --text 'Tuesday works for me.'
```

Use the returned draft ID to review it, then send only when instructed:

```sh
textbutler replies show DRAFT_ID
textbutler replies send DRAFT_ID DIGEST
```

Use the digest that `replies show` returns. It covers the recipient, content,
and imported media, so a change to the conversation or media can invalidate the
draft. Disclosure settings apply to both the reviewed and the sent content.
Each contact has one active draft; creating another replaces it. Drafts expire
after 15 minutes and are cleared when the daemon restarts. Run
`textbutler replies discard DRAFT_ID` to discard one.

When your user has approved the exact text, send it in one command:

```sh
textbutler messages send CONTACT_ID --text 'I have arrived.'
```

This sends a real message. Having the CLI available doesn't give an agent
permission to message anyone without its user's instruction.

## Leave campaign text to your user

`textbutler campaign run` sends text without the `🤖{ }` wrap because the
owner wrote it. An agent must never write, rewrite, template, or translate
campaign text, and runs `campaign run` only on a file its user wrote and asked
it to send. Anything an agent composes goes through `messages send`, which
keeps the disclosure. See [campaigns](campaigns.md).

## Media and reactions

Check `messages capabilities CONTACT_ID` before requesting an action.
These commands create unsent drafts that you review and send the same way:

```sh
textbutler messages attach CONTACT_ID /absolute/photo.jpg --caption 'Our view today'
textbutler messages react CONTACT_ID MESSAGE_ID '👍'
textbutler messages react CONTACT_ID MESSAGE_ID '👍' --remove
```

Media imports accept regular files you own, up to 16 MiB, and copy them into
the selected contact's private outbox. The draft records the copied bytes, so
later changes to the original file don't affect it. Common image, audio, video,
and document types are recognized. Whether an attachment can be sent still
depends on transport support and the account's current permissions.

For an ordered batch, put 1 to 7 supported action objects in a JSON array and use
`messages compose CONTACT_ID --actions /absolute/actions.json`. The supported
shapes are defined by the [action types](../../packages/transport/src/types.ts).
Attachment and sticker paths in an action object are relative to that contact's
workspace. The daemon validates targets, capabilities and imported media.

The iMessage connector sends ordinary text and media on a Mac with the
required permissions. Standard reactions, stickers, rich links, and polls also
need its separately configured Messages bridge and the matching capability in
`messages capabilities`. TextButler doesn't install that bridge or change macOS
security settings. The iMessage connector can't send threaded replies, App
Clips, or experiences, and the CLI won't turn a requested thread reply into an
ordinary message. Incoming reply relationships still show in history.

## Read uncertain results

Long operations may return a job ID. Read that job with
`textbutler jobs show JOB_ID`; don't repeat the original send. When the
transport accepts a send, the result is `submitted`. A `partial` or
`indeterminate` result must be reconciled before another attempt. Commands exit
with a nonzero code for pending or unsuccessful sends.

Append `--data-dir /absolute/private/path` to use another installation.
`textbutler messages --help` lists the agent commands.
