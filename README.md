# TextButler

![AI in your messages: a friend asks “Butler, what time did Sam say?” in iMessage, and a reply marked 🤖{ } answers from what Sam wrote earlier.](site/public/launch/readme-hero-light%402x.png#gh-light-mode-only)
![AI in your messages: a friend asks “Butler, what time did Sam say?” in iMessage, and a reply marked 🤖{ } answers from what Sam wrote earlier.](site/public/launch/readme-hero-dark%402x.png#gh-dark-mode-only)

TextButler puts a clearly marked AI assistant in the iMessage, WhatsApp, and
Beeper chats you choose on your Mac, and it answers when someone says “butler”.

**Status:** In development. TextButler runs on a Mac, built from its source
code: there’s no app to download yet, and new installs start paused. Automatic
replies have worked end to end over iMessage in our testing. Try them on your
own account, especially over WhatsApp or Beeper, before you rely on them.

> **Maya:** are we still on for climbing tomorrow?\
> **Maya:** Butler, what time did Sam say? And is he bringing the harness?\
> **Sam’s Mac:** 🤖{ 👀 }\
> **Sam’s Mac:** 🤖{ On Monday Sam said Friday at 6:30 at the gym, and that
> he’d bring the spare harness for you. Nothing here has changed since. }
>
> *An example conversation. The people are made up. The first message gets no
> answer because it doesn’t say “butler”; the reply comes only from what Sam
> wrote earlier in the same chat.*

See it on [textbutler.app](https://textbutler.app), or watch the
[launch film](https://textbutler.app/launch/textbutler-launch.mp4) (no sound;
every name in it is made up).

## What it works with

| Messaging app | Status | What you get | Limits |
|---|---|---|---|
| iMessage | Works today | Automatic, marked replies in one-to-one chats | No tapbacks or other reactions on a normal Mac. SMS and RCS aren’t supported. Your Mac must be awake and signed in to Messages. |
| WhatsApp | Not yet tested live | Replies in one-to-one chats, through a linked device | You pair it once yourself. It uses an unofficial client, so try it on your own account first. |
| Beeper (Signal, Telegram, Instagram, and more) | Text only | Replies in direct chats, through Beeper Desktop | Beeper Desktop has to stay open. No photos, reactions, or polls. Telegram’s terms limit AI use of message content, so ask the person first. |
| Group chats, SMS, RCS | Not supported | — | TextButler ignores group chats, reactions, and old messages. |

Messages reach TextButler through GhostGet, a separate Mac tool you
[install first](https://ghostget.com/docs/tutorials/getting-started).
TextButler is Mac only. It runs in the background with no window and no menu
bar icon. There’s no app to download. Setup builds a small helper app on your
Mac so macOS can grant iMessage access, and the helper has no window. The
website at [textbutler.app](https://textbutler.app) is informational and never
receives your messages.

## Set it up with your agent

TextButler has no installer and no app store page. Paste this into Claude Code,
Codex, or Devin:

```text
Set up TextButler on this Mac: https://github.com/hraness/textbutler
Follow docs/textbutler/getting-started.md step by step.
If GhostGet isn't installed, set it up first: https://ghostget.com/docs/tutorials/getting-started
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
3. **Turn on one person.** Everyone starts off, and the butler starts paused.
   Turn on one chat, then run `textbutler resume`. When that person says
   “butler”, your butler answers.

You’ll need a Mac, Bun 1.3.14, and GhostGet. There’s no one-line installer and
no TextButler setup skill yet, so your agent follows the
[written guide](docs/textbutler/getting-started.md). Permission switches,
pairing, and pasting a key are always yours to do.

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

1. **Someone texts you.** They write in a one-to-one chat you’ve turned on.
   GhostGet passes the message to TextButler, running in the background on your
   Mac.
2. **It checks before it speaks.** Is this person turned on? Is it a one-to-one
   chat? Did they say “butler”? Has it been 5 minutes since you last wrote
   here? Is it under 12 replies this hour? It also waits 8 seconds, so a burst of
   texts gets one answer.
3. **👀, right away.** It sends `🤖{ 👀 }` so they know it’s on it.
4. **It reads the room.** It reads the notes you keep for this person (how you
   talk, what matters, what’s off-limits) and the recent conversation. In your
   own chat it can also search your full history; for other people that’s off
   unless you turn it on.
5. **Your chosen model writes the reply.** It can search the web only when a
   Gateway key is saved, and it refuses any search that reuses words from your
   private messages.
6. **Marked, then sent.** The reply arrives as `🤖{ … }`, so nobody mistakes it
   for you. If it can’t tell whether a send went through, it doesn’t send it
   again.
7. **You can step in anytime.** Write in the chat yourself and it stays out of
   it. Pause everything with one command, or ask for a draft to review first.

**Keyword mode** is the default: it answers only messages that contain the word
“butler”, in any capitalization. **Smart mode** decides when a reply is clearly
wanted, answers only when it’s at least 85% sure, and stays quiet otherwise.
**You can ask too:** say “butler” in any chat you’ve turned on, including your
own, and it answers you.

## Pick what writes replies

![Where your words go with a local model: GhostGet, TextButler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply](site/public/diagrams/d2-words-local-wide.light%402x.png#gh-light-mode-only)
![Where your words go with a local model: GhostGet, TextButler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply](site/public/diagrams/d2-words-local-wide.dark%402x.png#gh-dark-mode-only)

Replies can be written by a local model through Ollama (in testing), by Qwen 3.5
Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or
Devin subscription through xcb.

| Option | Status | Command | What leaves your Mac |
|---|---|---|---|
| A local model on your Mac (Ollama) | In testing | `ollama pull qwen3:4b-instruct-2507-q4_K_M`, then `textbutler providers local` | Nothing. The reply is written on your Mac. About 2.5 GB; TextButler never downloads a model for you. This is where the default is heading. |
| Qwen 3.5 Flash with your own Vercel AI Gateway key | Works today | `pbpaste \| textbutler providers gateway-key` | The conversation context goes to Vercel AI Gateway. Spending stops at $1 a day. |
| Your Claude Code, Codex, or Devin subscription | Works today | `textbutler providers check ACCOUNT` after connecting [Excalibur (xcb)](https://github.com/hraness/xcb) | The conversation context goes through xcb to that account. Use your xcb account name for `ACCOUNT`. The model can’t run commands on your Mac, and xcb keeps your sign-in. |

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

Every message the butler sends is wrapped in the person’s marker, `🤖{ … }` by
default, including the 👀. You can change or clear the marker for one person,
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
  parts fit together and what still needs live testing.
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
Me, and its published package (`bun add --global @hraness/message-like-me@0.8.22`)
installs those legacy tools, not TextButler. See
[docs/message-like-me.md](docs/message-like-me.md).
