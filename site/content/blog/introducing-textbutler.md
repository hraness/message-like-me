Textbutler is an AI assistant for the iMessage, WhatsApp, and Beeper conversations you pick on your Mac. It writes reply drafts, marks the messages it writes as coming from an assistant, and by default sends nothing until you have read and approved it.

Personal messages pile up because each one needs a little thought: which weekend works for dinner, the name of that plumber, a time to catch up. Textbutler runs on your Mac, keeps what it knows about each contact in files you can read, works from the history you choose to import, and shows you each draft before it goes out.

Textbutler replaced Message Like Me, and messagelikeme.com redirects here.

## Who it is for

Textbutler is for a Mac owner who is behind on personal conversations and wants to read every word the butler writes before it goes out. It also suits developers who already pay for a Claude Code or Codex subscription and want to see a reference application built on xcb.

It is the wrong tool if you want to message people you do not already talk to, send the same note to many people, or run an assistant that passes itself off as you. Textbutler works only in one-to-one conversations you add one at a time; group chats never start a reply. Its own replies carry a visible marker by default, and we recommend leaving it on.

## What Textbutler does today

Textbutler connects to your messaging apps through Ghostget, which handles sign-in and permissions, so the butler never opens the Messages database itself. You add one conversation at a time, and adding one never sends a message. A new contact starts switched off, and a new install starts paused.

For each contact, Textbutler keeps a private folder of plain files: who the person is to you, dated notes, and your standing instructions for the butler. Folders are named with opaque identifiers rather than names or phone numbers, and the model can read and edit files only inside the folder for the contact it is working on.

Importing history is a separate opt-in step. It takes up to 200 recent messages from one conversation, keeps who said what and when, records anything it shortened or left out, and does not fetch media. Treat it as a starting sample rather than your whole archive.

The daily loop runs from the terminal:

```sh
textbutler inbox                        # which chats have unanswered messages
textbutler replies suggest <contact>    # ask for a draft for one of them
textbutler replies show <draft>         # read every line it would send, and to whom
textbutler replies send <draft> <digest>
```

`inbox` only reads. A suggestion is a draft that expires after fifteen minutes and never sends on its own. `show` prints the recipient, every message in order, and a digest of that review. `send` sends only the draft that matches the digest you read. If the conversation moved on, your disclosure settings changed, or the draft expired, it refuses rather than send something stale. You can also type your own reply with `replies send <contact> <text>`, or `discard` a draft you do not like.

When the butler writes, trusted code wraps its text in a marker the other person can see. The default looks like `🤖{ hello this is my response }`. You can change the markers per contact or clear them. Once cleared, the other person sees plain text with nothing to show the butler wrote it, so tell people you use it if you do that. Either way, Textbutler privately records which messages it wrote, so its own words never get mixed back in as examples of your style.

Automatic replies use Qwen 3.5 Flash through your own Vercel AI Gateway key by default. Drafts you ask for with `replies suggest` run through xcb on the Claude Code, Codex, or Devin subscription you already have. On either route the model proposes a reply, and Textbutler checks it before anything is sent. [How Textbutler uses xcb](/blog/how-textbutler-uses-xcb) covers the subscription route.

To start, clone the repository and open the guided terminal with Bun {{BUN_VERSION}}:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run textbutler tui
```

Choose **Setup & readiness**, then **Connect messaging apps**. You can read your inbox and send replies you write yourself without any AI account. AI drafts need a local build (`bun run textbutler:install`) and a connected xcb account.

## Habitats: a reply plan that learns per conversation

You write differently to your mother than to your running partner, so one style profile per owner misses most of what matters. Textbutler's longer bet is that each conversation gets its own small, private learning space, which the source calls a habitat.

Habitats are off until you switch them on. The code is in the repository and, like the rest of Textbutler, in development. Each conversation gets its own habitat, and habitats share nothing, even two threads with the same person. You can write a fixed core for a contact, covering the voice the butler should use, your shared history, and any boundaries, and the habitat may not rewrite it.

Over time, a background step looks at how past replies landed and proposes a new reply plan: warmer or more direct, more or less formal, longer or shorter, more or less humor. A separate judge then scores the current and proposed plans side by side on the two most recent cases that got a response, without knowing which is which. The new plan takes over only if it did no worse on either case and better by a set margin on average. Silence from the other person does not count as success.

A plan holds style and strategy as data. It cannot change who receives a message, which AI provider runs it, what tools are allowed, or whether replies are disclosed. Web search, meme search, and the small code sandbox are switches only you control. The learning step is told to leave them alone and keep your core text word for word, and a proposed plan that changes either is rejected. You can inspect a habitat at any time; rolling it back or clearing what it remembered requires pausing the butler first. [How Textbutler uses ALGAL](/blog/how-textbutler-uses-algal) walks through how those programs run.

## Limits and status

Current status:

> {{SITE_STATUS}}

Other limits:

- **Local does not mean offline.** Textbutler, its files, and its send log live on your Mac, and textbutler.app never receives your messages. To write a draft, though, Textbutler sends that contact's context to the AI provider you connected. Habitats default to a hosted model route, with a local model server as the alternative, and web search, if you turn it on, sends public queries to a search provider.
- **The butler replies on its own only for contacts you switch on.** After you switch a contact on and resume the butler, Textbutler answers when a message includes that contact's keyword, which is “butler” unless you change it. If you move a contact to smart mode, it also answers when a classifier is confident help is wanted. Those replies carry the marker unless you cleared it, wait five minutes after you last wrote, are capped per hour, and apply to at most five contacts unless you raise the limit. Disabling the contact or pausing everything cancels pending replies. Leave contacts off and Textbutler only drafts.
- **Live testing of the Ghostget connection is not finished.** The link between Textbutler's background service and Ghostget still needs live testing across apps. Beeper reaches apps such as Signal and Telegram as text only, and what is available depends on your linked accounts. Telegram's terms restrict using its content with AI, and connecting through Beeper does not change that. [How Textbutler uses Ghostget](/blog/how-textbutler-uses-ghostget) covers what that connection does.
- **No signed app yet.** You build Textbutler yourself, and a rebuilt local copy may need macOS permissions granted again.

[PeopleBlade](https://peopleblade.com), a local-first CRM for your personal agent, shares Textbutler's message bundle format: both tools implement the versioned message-like-me.local-message-bundle interchange without importing each other's private state.
