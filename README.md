# TextButler

![AI in your messages: a friend asks “Butler, what time did Sam say?” in iMessage, and a reply marked 🤖{ } answers from what Sam wrote earlier.](site/public/launch/readme-hero-light%402x.png#gh-light-mode-only)
![AI in your messages: a friend asks “Butler, what time did Sam say?” in iMessage, and a reply marked 🤖{ } answers from what Sam wrote earlier.](site/public/launch/readme-hero-dark%402x.png#gh-dark-mode-only)

TextButler adds an assistant to the iMessage, WhatsApp, and Beeper chats you choose
on your Mac. By default, it answers “butler” requests and marks its replies as AI.

TextButler runs on your Mac. New installs start paused until you choose which chats it can answer.

> **Maya:** are we still on for climbing tomorrow?\
> **Maya:** Butler, what time did Sam say? And is he bringing the harness?\
> **Sam’s Mac:** 🤖{ 👀 }\
> **Sam’s Mac:** 🤖{ On Monday Sam said Friday at 6:30 at the gym, and that
> he’d bring the spare harness for you. Nothing here has changed since. }
>
> *The first message gets no
> answer because it doesn’t say “butler”; the reply comes only from what Sam
> wrote earlier in the same chat.*

See how it works on [textbutler.app](https://textbutler.app).

## What it works with

| Messaging app | What you get | What it needs |
|---|---|---|
| iMessage | Replies in selected direct and group conversations | A Mac that stays awake and signed in to Messages. SMS, RCS, and reactions aren’t supported. |
| WhatsApp | Replies in selected direct and group chats through a linked device | Pair your account during setup. The connection uses an unofficial WhatsApp client. |
| Beeper | Text replies in selected direct and group chats across its connected services | Keep Beeper Desktop open. Check each service’s terms before using AI with its messages. |

Messages reach TextButler through GhostGet, a separate Mac tool you
[install or update before connecting](https://ghostget.com/docs/tutorials/getting-started).
TextButler is Mac only. It runs in the background with no window and no menu
bar icon. The
website at [textbutler.app](https://textbutler.app) is informational and never
receives your messages.

## Set it up with your agent

Ask your coding agent to install TextButler and connect your messaging apps:

```text
Set up TextButler on this Mac: https://github.com/hraness/textbutler
Follow docs/textbutler/getting-started.md step by step.
Install or update GhostGet to exactly 0.18.71: https://ghostget.com/docs/tutorials/getting-started
Check `ghostget --version`, then restart or reconnect TextButler's GhostGet host so it checks the new capabilities.
Connect my iMessage, and WhatsApp or Beeper if I use them.
For replies, if Ollama is running with qwen3:4b-instruct-2507-q4_K_M, choose it with `textbutler providers local`; otherwise ask me which option I want.
Run `textbutler doctor` after each step and do what it says.
Stop and tell me whenever macOS asks for a permission, a pairing, or a key.
Leave every chat turned off and don't send any messages.
```

1. **Ask your agent.** It clones the repository, installs it, connects your
   messaging apps, and runs `textbutler doctor` until only your steps are left.
2. **Say yes to your Mac.** For iMessage, turn on Full Disk Access for the
   TextButler helper, then allow the Messages prompt when your agent re-runs
   setup. For WhatsApp or Beeper, pair once. Then choose what writes replies:
   pull the local model, paste a Gateway key, or sign in through xcb.
3. **Turn on one conversation.** Every chat starts off, and the butler starts paused.
   Choose a direct or group chat, then run `textbutler resume`. When someone says
   “butler”, your butler answers.

Your agent follows the [setup guide](docs/textbutler/getting-started.md).
Grant macOS access, pair your accounts, and choose a reply model when prompted.

## Open the guided terminal

Prefer to do it yourself? On your Mac, with Bun 1.3.14:

```sh
git clone https://github.com/hraness/textbutler.git
cd textbutler
bun install --frozen-lockfile --ignore-scripts
bun run textbutler tui
```

Choose **Setup & readiness**, then **Connect messaging apps**. TextButler uses
an existing GhostGet installation for messaging sign-in and permissions. The
guide explains how to select its executable and accounts, start the background
service, and add one conversation. New installations start paused and new
contacts have automatic replies off. Setup and conversation selection never
send a message.

For AI replies, install the local copy with `bun run textbutler:install` and
run `~/.local/bin/textbutler`. The installer refuses to build if the code
doesn’t match the last reviewed version. Before you rely on automatic replies,
test with someone you trust on the account you’ll use.

## How it works

![One message, start to finish: a friend’s message reaches GhostGet on your Mac, passes five checks, gets 🤖{ 👀 } right away, then your notes and the chat are read, your chosen model writes, and a marked reply goes back](site/public/diagrams/d1-one-message-wide.light%402x.png#gh-light-mode-only)
![One message, start to finish: a friend’s message reaches GhostGet on your Mac, passes five checks, gets 🤖{ 👀 } right away, then your notes and the chat are read, your chosen model writes, and a marked reply goes back](site/public/diagrams/d1-one-message-wide.dark%402x.png#gh-dark-mode-only)

1. **Someone texts you.** They write in a direct or group chat you’ve turned on.
   GhostGet passes the message to TextButler, running in the background on your
   Mac.
2. **It checks before it speaks.** Is this chat turned on? Are its
   members unchanged? Does the message match the selected reply mode? Has it been 5 minutes since you last wrote
   here? Is it under 12 replies this hour? It also waits 8 seconds, so a burst of
   texts gets one answer.
3. **Acknowledge the request.** With the default marker, it sends `🤖{ 👀 }`.
4. **It reads the room.** It reads the notes you keep for this conversation (how you
   talk, what matters, what’s off-limits) and the recent conversation. In your
   own chat it can also search your full history; for other people that’s off
   unless you turn it on.
5. **Your chosen model writes the reply.** It can search the web only when a
   Gateway key is saved, and it refuses any search that reuses words from your
   private messages.
6. **Reply in the same chat.** The default marker wraps the reply as `🤖{ … }`.
   You can configure the marker per person. If it can’t tell whether a send
   went through, it doesn’t send it again.
7. **You can step in anytime.** Write in the chat yourself and it stays out of
   it. Pause everything with one command, or ask for a draft to review first.

**Keyword mode** is the default: it answers only messages that contain the word
“butler”, in any capitalization. **Smart mode** can recognize a request for
help without the keyword and stays quiet when the result is uncertain.
**You can ask too:** say “butler” in any chat you’ve turned on, including your
own, and it answers you.

Each group has its own editable notes, separate from your direct conversations.
Group context starts with new messages after you add the group. If its members
or account change, select the group again before replies resume.

## Pick what writes replies

![Where your words go with a local model: GhostGet, TextButler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply](site/public/diagrams/d2-words-local-wide.light%402x.png#gh-light-mode-only)
![Where your words go with a local model: GhostGet, TextButler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply](site/public/diagrams/d2-words-local-wide.dark%402x.png#gh-dark-mode-only)

Replies can be written by a local model through Ollama, by Qwen through your own Vercel AI Gateway key, or by your Claude Code, Codex, or
Devin subscription through xcb.

| Reply writer | Setup command | Where the context goes |
|---|---|---|
| A local model through Ollama | `ollama pull qwen3:4b-instruct-2507-q4_K_M`, then `textbutler providers local` | Reply writing stays on your Mac. Optional web search sends queries through your saved Gateway key. |
| Qwen through your Vercel AI Gateway key | `pbpaste \| textbutler providers gateway-key` | Conversation context goes to Vercel AI Gateway. Spending stops at $1 a day. |
| A Claude Code, Codex, or Devin subscription | `textbutler providers check ACCOUNT` after connecting [xcb](https://github.com/hraness/xcb) | Conversation context goes through xcb to your chosen account. The reply model can’t run commands on your Mac. |

If you choose one with a command, that choice wins. Otherwise a saved Gateway
key wins, and with no key saved, an Ollama server already serving the pinned
model is picked up when the background service starts. When a Gateway key is
saved, the butler can also search the web for the people you turn on (in your
own chat, only when you ask), using your key even when a local model writes the
replies. It refuses any search that reuses words from your private messages,
and you can turn search off for one person with `textbutler habitats configure`.
Stop the background service before `providers local`, and restart it after
changing the reply writer. The [subscription guide](docs/textbutler/native-subscription.md) covers xcb setup.

## Stay in control

TextButler has no window or menu bar icon. A background service does the work,
and you control it from the terminal:

```sh
bun run textbutler daemon install
bun run textbutler status
bun run textbutler pause
bun run textbutler resume
bun run textbutler contacts enable CONTACT
bun run textbutler contacts disable CONTACT
```

`daemon install` starts the service now and at every sign-in (a per-user
LaunchAgent on macOS). `status` shows whether it’s running, whether replies are
paused, and each person’s state. `pause` stops everything at once, and
`contacts disable` turns one person off. Uninstalling with `daemon uninstall`
keeps your settings and contact notes.

Every command also takes `--json`. `textbutler tui --snapshot` prints the
guided terminal's views as plain text, and `textbutler commands --json` lists
every command with who may run it. Commands that send a reply or turn a chat on
need you in person: an agent gets `human-required` and nothing changes. See
[the command reference](docs/textbutler/cli-parity.md).

For AI replies, start the service from the installed copy instead:
`~/.local/bin/textbutler daemon install`. A service started with
`bun run textbutler` from the checkout doesn’t write AI replies.

To answer yourself, open the guided terminal, choose **Inbox & replies**, select
a conversation, then choose **Type a reply**. Review the recipient and complete
text before typing `send`. Cancelling the review sends nothing.

To read an AI reply before it goes out, ask for a draft:

```sh
bun run textbutler inbox
bun run textbutler replies suggest CONTACT
bun run textbutler replies show DRAFT
bun run textbutler replies send DRAFT DIGEST
bun run textbutler replies discard DRAFT
```

`CONTACT` is the exact contact ID or a unique name match. Use the complete draft
and digest returned by `replies show`; previews alone cannot send. Drafts expire
after 15 minutes. Changed contact settings, conversation context, or attachment
bytes require a fresh review. The CLI also supports an immediate explicit reply
with `bun run textbutler replies send CONTACT TEXT...`.

`submitted` means the messaging app accepted the message, not that the
recipient received or read it. A pending operation prints a job ID: inspect it
with `bun run textbutler jobs show JOB_ID`. Do not repeat a send with an unknown
outcome. Uncertain sends stay blocked until they’re sorted out.

By default, replies and acknowledgments carry the `🤖{ … }` marker. You can change or clear the marker for one person,
never in your own chat. The review shows the actual outgoing text.

Each person you turn on gets a folder of plain files on your Mac (`AGENTS.md`,
`ABOUT.md`, `MEMORY.md`, `STYLE.md`) holding your notes on how you talk, what
matters, and what’s off-limits. Your settings and sign-ins live elsewhere, where
the butler can’t change them. Optional learning (off by default; it needs a
Claude Code subscription through xcb) can remember up to 64 sourced notes and
adjust tone per chat; `textbutler habitats show` lists them and
`textbutler habitats memory-clear` removes them.

## For agents

Agents can use the [JSON CLI](docs/textbutler/agent-cli.md) to list
conversations, read and summarize history, prepare text or media drafts, and
send an explicitly authorized message, using the same staged actions the butler
uses on its own. Each connection reports its available actions.

## Compared with other tools

Smart Reply in Apple Messages and Writing Help in WhatsApp suggest replies that
you send yourself. [GhostReply](https://ghostreply.lol) is a $4.99 Mac app that
answers iMessages in your texting style. [OpenClaw](https://openclaw.ai) is an
open-source assistant you message, and it can run commands on your computer.
TextButler answers only the people you turn on, when they ask, marks its
replies by default, keeps notes on each person in files you can edit, and its
model can’t run commands on your Mac. See
[TextButler compared with GhostReply](https://textbutler.app/compare/ghostreply).

## Docs

- [Getting started](docs/textbutler/getting-started.md): the step-by-step setup
  your agent follows.
- [Messaging apps](docs/textbutler/messaging-apps.md): what each connection
  supports and its live limits.
- [AI subscriptions through xcb](docs/textbutler/native-subscription.md).
- [Agent JSON CLI](docs/textbutler/agent-cli.md).
- [Architecture](docs/textbutler/architecture.md), for developers: how the
  parts fit together.
- [Provider setup](packages/textbutler/PROVIDERS.md), for developers.

TextButler keeps each person’s context in files you can read and edit, marks
its own replies by default, and answers only after you turn a person on and
resume the butler: the design every Hraness project shares. [The thread through
hraness](https://hraness.com/writing/the-thread-through-hraness) follows that
design across the projects, and the [ALGAL
vision](https://algal.computer/docs/vision/) states the bet behind it.

## Verify a checkout

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

The complete gate type-checks the project, runs the synthetic test suite,
validates the bundled Agent Skills and the standalone public boundary, rebuilds
`dist/`, checks the committed build, and exercises a packed consumer. Run
`bun run check:textbutler` for the TextButler packages.

## Develop and contribute

Tests use synthetic Messages and AddressBook databases, synthetic X archive
ZIPs, and synthetic source bundles and conversations. Never add a real message,
handle, group title, attachment, contact record, private path, or derived
profile to a fixture.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.

The canonical repository is
[`hraness/textbutler`](https://github.com/hraness/textbutler).
The informational project page is
[textbutler.app](https://textbutler.app). The CLI does not connect to the site,
and the site never receives message or contact data.

## Support and opt-out

`textbutler support` shows optional ways to support TextButler’s development.
Its background service and administrative commands never show invitations, and
`HRANESS_SUPPORT=off` turns incidental notices off. Support state stays local;
these commands don’t sign you up or charge anyone.

## License

MIT.

Looking for the Message Like Me history tools? TextButler replaced Message Like
Me, and its published package (`bun add --global @hraness/message-like-me@0.8.24`)
installs those legacy tools, not TextButler. See
[docs/message-like-me.md](docs/message-like-me.md).
