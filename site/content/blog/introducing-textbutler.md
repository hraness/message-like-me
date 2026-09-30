TextButler puts a clearly marked AI assistant in the iMessage, WhatsApp, and Beeper chats you choose on your Mac, and it answers when someone says “butler”.

That’s the whole idea. You don’t open an app to talk to it, and neither do your friends. It lives in the conversations you already have, it speaks only when asked, and everything it sends is wrapped so nobody mistakes it for you.

## Why it answered Maya

In the chat at the top of this post, Sam is out with his phone in his bag when his friend Maya checks tomorrow’s climbing plans. Her first message gets no answer, because it doesn’t say “butler”. Her second one does. The butler sends 🤖{ 👀 } right away so she knows it’s on it, then answers from what you actually wrote to her on Monday. It doesn’t guess where you are or invent plans, and the 🤖{ } around each message tells her exactly who’s talking. Maya didn’t install anything.

## What it is

TextButler is an assistant that runs in the background on your Mac. It has no window and no menu bar icon. It works in the one-to-one chats you turn on, one person at a time. Everyone else, and every group chat, is left alone.

There’s no app to download. Setup builds a small helper app on your Mac so macOS can grant iMessage access, and the helper has no window. TextButler is open source under the MIT license and runs from source with Bun {{BUN_VERSION}}.

Your messages reach it through [GhostGet](https://ghostget.com), a separate Mac tool you install first. GhostGet reads and sends for your Mac; TextButler decides when to answer and what to say.

TextButler replaced Message Like Me, and messagelikeme.com redirects here.

## How it works

One message, start to finish:

![One message, start to finish: a friend’s message reaches GhostGet on your Mac, passes five checks, gets 🤖{ 👀 } right away, then your notes and the chat are read, your chosen model writes, and a marked reply goes back](/diagrams/d1-one-message-narrow.light@2x.png#gh-light-mode-only)
![One message, start to finish: a friend’s message reaches GhostGet on your Mac, passes five checks, gets 🤖{ 👀 } right away, then your notes and the chat are read, your chosen model writes, and a marked reply goes back](/diagrams/d1-one-message-narrow.dark@2x.png#gh-dark-mode-only)

1. **Someone texts you.** They write in a one-to-one chat you’ve turned on, and GhostGet passes the message to TextButler.
2. **It checks before it speaks.** Is this person turned on? Is it a one-to-one chat? Did they say “butler”? Has it been {{COOLDOWN}} since you last wrote here? Is it under {{HOURLY_CAP}} replies this hour? It also waits {{DEBOUNCE}}, so a burst of texts gets one answer.
3. **👀, right away.** It sends 🤖{ 👀 } as an ordinary text message. Tapbacks aren’t available on a normal Mac, so it doesn’t pretend to use them.
4. **It reads the room.** It reads the notes you keep for this person (how you talk, what matters, what’s off-limits) and the recent conversation. In your own chat it can also search your full history; for other people that’s off unless you turn it on.
5. **Your chosen model writes the reply.** More on that choice below.
6. **Marked, then sent.** The reply arrives as 🤖{ … }. If TextButler can’t tell whether a send went through, it doesn’t send it again.
7. **You can step in anytime.** Write in the chat yourself and it stays out of it. Pause everything with one command, or ask for a draft to review first.

“Butler” matches in any capitalization, as a whole word, so the “Butler,” your phone capitalizes still counts. You can ask it things too: say “butler” in any chat you’ve turned on, including your own notes-to-self chat, and it answers you.

## Pick what writes replies

Replies can be written by a local model through Ollama (in testing), by Qwen 3.5 Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or Devin subscription through xcb.

![Where your words go with a local model: GhostGet, TextButler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply](/diagrams/d2-words-local-narrow.light@2x.png#gh-light-mode-only)
![Where your words go with a local model: GhostGet, TextButler, and Ollama all sit inside your Mac, and nothing crosses its edge to write the reply](/diagrams/d2-words-local-narrow.dark@2x.png#gh-dark-mode-only)

| Option | One command | What leaves your Mac |
|---|---|---|
| A local model on your Mac (in testing) | `ollama pull qwen3:4b-instruct-2507-q4_K_M`, then `textbutler providers local` | Nothing. The reply is written on your Mac |
| Qwen 3.5 Flash with your own Vercel AI Gateway key | `pbpaste \| textbutler providers gateway-key` | The conversation context, to Vercel AI Gateway. Spending stops at {{GATEWAY_BUDGET}} a day |
| Your Claude Code, Codex, or Devin subscription | `textbutler providers check ACCOUNT` after connecting xcb | The conversation context, through xcb to that account. The model can’t run commands on your Mac |

The local model is where TextButler is heading. Your messages already live on your Mac, and with a local model the reply gets written there too. It’s about {{LOCAL_MODEL_SIZE}}, and TextButler never downloads it for you: you pull it with Ollama, then choose it with `textbutler providers local`. If no Gateway key is saved, TextButler also picks it up on its own when its background service starts. We’re still testing it before it becomes the default.

Which one wins when you have more than one? If you choose one with a command, that choice wins. Otherwise a saved Gateway key wins over a local model. When a Gateway key is saved, the butler can also search the web for the people you turn on (in your own chat, only when you ask), using your key even when a local model writes the replies. It refuses any search that reuses words from your private messages, and you can turn search off for one person with `habitats configure`.

Subscriptions go through [Excalibur (xcb)](https://xcb.sh), which keeps your sign-in. [How TextButler uses xcb](/blog/how-textbutler-uses-xcb) has the details.

## It only speaks when it should

Most of the time, TextButler does nothing. That’s the design.

![Five checks before it speaks: turned on, one-to-one, said “butler”, you’ve been quiet {{COOLDOWN}}, under {{HOURLY_CAP}} this hour. Most of the time, it does nothing](/diagrams/d4-five-checks.light@2x.png#gh-light-mode-only)
![Five checks before it speaks: turned on, one-to-one, said “butler”, you’ve been quiet {{COOLDOWN}}, under {{HOURLY_CAP}} this hour. Most of the time, it does nothing](/diagrams/d4-five-checks.dark@2x.png#gh-dark-mode-only)

- **Keyword mode** is the default. It answers only messages that contain “butler”.
- **Smart mode** lets it decide when a reply is clearly wanted. It answers only when it’s at least {{SMART_CONFIDENCE}} sure, and stays silent otherwise.
- **It waits {{COOLDOWN}} after you last wrote.** If you’re in the conversation, a request in that window is skipped, not saved for later.
- **At most {{HOURLY_CAP}} replies an hour** to any one person.
- **One-to-one chats only.** Group chats, reactions, and old messages are ignored. SMS and RCS aren’t supported.

Here’s what staying out of it looks like on WhatsApp:

> **Jordan:** running 10 late, sorry!!
>
> **Sam:** all good, grabbing a table
>
> **Jordan:** butler can you remind Sam I owe him for last time

No reply. Jordan’s first message didn’t ask, and by the time he did, Sam had just written.

## Your agent sets it up

TextButler has no installer and no app store page. It’s a command line tool and a background service, which is exactly the kind of thing your coding agent is good at. Paste this into Claude Code, Codex, or Devin:

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

![Who does what: your agent clones, installs, connects your apps, and runs textbutler doctor; you turn on Full Disk Access, allow Messages, pair WhatsApp or Beeper, pick what writes replies, and turn on one person](/diagrams/d3-who-does-what-narrow.light@2x.png#gh-light-mode-only)
![Who does what: your agent clones, installs, connects your apps, and runs textbutler doctor; you turn on Full Disk Access, allow Messages, pair WhatsApp or Beeper, pick what writes replies, and turn on one person](/diagrams/d3-who-does-what-narrow.dark@2x.png#gh-dark-mode-only)

Your agent clones the repository, installs it, connects your messaging apps, and runs `textbutler doctor` until only your steps are left. Those steps are yours because macOS and your accounts require a person: turning on Full Disk Access for the TextButler helper, allowing the Messages prompt, pairing WhatsApp or Beeper once, and pasting a key or signing in. Then you turn on one person and resume the butler.

To be plain about it: there’s no one-line installer and no TextButler setup skill yet, so your agent follows the written guide. If you’d rather do it yourself, `bun run textbutler tui` walks you through the same steps. Once it’s running, the same command line gives your agent JSON commands to list conversations, summarize a thread, and draft a reply that sends only with the review code the draft shows.

## It never pretends to be you

Every message the butler sends is wrapped in 🤖{ }, including the 👀. The marker is on by default. You can remove it for one person, but never in your own chat.

New installs start paused and everyone starts off. Setup, choosing contacts, and importing history never send a message. `textbutler pause` stops everything at once, and `textbutler contacts disable` turns one person off.

When you’d rather read first, ask for a draft instead: `textbutler replies suggest` writes one, `textbutler replies show` prints every word and who it goes to, and `textbutler replies send` with the draft’s review code sends exactly what you read. Drafts expire after {{DRAFT_EXPIRY}}. When a messaging app reports a send as submitted, that means the app accepted it, not that it was delivered.

## Each person gets their own folder

Each person you turn on gets a folder of plain files on your Mac: your notes about how you talk with them, what matters, and what’s off-limits. You can open and edit every file. Your settings and sign-ins live elsewhere, where the butler can’t change them.

Learning is optional and off by default; today it needs a Claude Code subscription through xcb. When it’s on, the butler tries a new way of replying in one chat, and keeps it only if it does better on that chat’s own past replies. It can also remember up to {{MEMORY_ENTRIES}} notes, each with where it came from. `textbutler habitats show` lists them and `textbutler habitats memory-clear` removes them. [How TextButler uses ALGAL](/blog/how-textbutler-uses-algal) explains how.

## Where it stands

{{SITE_STATUS}}

**Works today**

- Marked automatic replies over iMessage, end to end in our testing.
- WhatsApp and Beeper text connections through GhostGet. Automatic replies over them aren’t tested live yet.
- Three reply writers: your Gateway key, your subscription, and a local model (in testing).
- Drafts you review before sending, and the guided terminal.
- The JSON command line for agents.

**Coming**

- The local model as the default.
- A TextButler setup skill for agents, and an easier install.
- Live testing of automatic replies on WhatsApp and Beeper.
- Learning that’s easier to turn on.
- TextButler AI credits, so you can skip getting a key of your own.

Group chats and SMS aren’t planned right now.

## Try it

Start with one person who knows you’re trying it. Paste the prompt above into your coding agent, approve the macOS prompts, pick what writes replies, turn that one chat on, and resume. Everyone else stays off until you say so.

For the full step-by-step path, see the [TextButler home page](https://textbutler.app). Messages move through [GhostGet](https://ghostget.com/blog/built-on-ghostget), and subscriptions through [xcb](https://xcb.sh/blog/introducing-xcb).
