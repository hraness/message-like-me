TextButler lets you pick what writes its replies. Replies can be written by a local model through Ollama (in testing), by Qwen 3.5 Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or Devin subscription through xcb. This post is about the third option: if you already pay for one of those subscriptions, TextButler can write replies and drafts on it, so you don't need a second AI plan. TextButler hands the writing to xcb, which talks to the subscription you have already signed in to, while your conversations, contacts, and sends stay on TextButler's side.

## What xcb is

[xcb](https://xcb.sh), short for Excalibur, is a local tool that routes coding tasks across the Claude, Codex, and Devin subscriptions you already pay for. It keeps the sign-in for each account, starts the provider's program when there is work, and keeps an account locked to one job until that provider process has exited.

xcb's main interface runs coding tasks. It also has a smaller mode for other applications, in which an app sends a prompt and gets text back. In that mode xcb gives the model no tools, loads no saved session, and runs no hooks or plugins, so the model can only answer.

xcb's documentation names TextButler as the reference consumer of that mode. TextButler accepts xcb accounts for Claude Code, Codex, and Devin, and each provider has to pass its checks before any drafting runs on it.

xcb also decides which accounts an application may use. It offers an account and model to applications only after that pair passes xcb's application check, and that approval expires within 24 hours.

## How TextButler calls it

Setup happens once, with TextButler stopped. You point TextButler at the xcb program on your Mac, the folder where xcb keeps its state, one account, and one full model name copied from xcb's own account and model lists:

```sh
bun run textbutler setup \
  --xcb /absolute/path/to/xcb \
  --xcb-state /absolute/path/to/xcb-state \
  --xcb-account claude:ACCOUNT_ID \
  --xcb-model FULL_MODEL_KEY
```

Use `codex:ACCOUNT_ID` or `devin:ACCOUNT_ID` to add a Codex or Devin account the same way. Then run `textbutler providers check` with the same account, for example `textbutler providers check claude:ACCOUNT_ID`, to confirm it passes. Setup records a fingerprint of the xcb program and the account you chose. It does not copy your subscription login, and it does not switch on any contact.

Every reply then follows the same loop:

1. **Check the program.** Before each call, TextButler confirms the xcb program on disk still matches the SHA-256 fingerprint from setup. If you upgraded or replaced it, the call is refused until you review the change.
2. **Send the prompt privately.** The request, including that contact's context, goes to xcb on standard input, never in command-line arguments where other programs could see it.
3. **Read the answer strictly.** The reply must be well-formed, name the same account and model that were requested, and fit a size limit. TextButler rejects JSON with a repeated key, so a reply cannot carry two values for one field.
4. **Carry out actions itself.** The model may ask for one of a short list of TextButler actions: edit this contact's notes, read a public web page, or stage a reply. TextButler checks each request and performs it for that one contact only. A run stops after 16 steps or 12 operations.

So xcb holds the login and runs the model, and TextButler holds the contacts, the recipients, and the decision to send. The model never gets a file or messaging tool from the provider, and it cannot pick another contact, another recipient, or a credential. TextButler never passes your subscription login to xcb or reads it back.

AI replies work only in a local build of TextButler, made with `bun run textbutler:install`. The build carries a reviewed record of its source files and of TextButler's two reply profiles, one to decide whether a message wants a reply and one to write it. If the source has changed since that review, the build refuses. Running TextButler straight from a source checkout leaves AI replies switched off, whichever reply writer you pick.

## What you get as a user

- **Replies on the plan you have.** Replies and drafts are written by the subscription account you connected.
- **Your login stays with xcb.** TextButler's contact folders never hold subscription credentials.
- **TextButler decides what is sent.** Automatic replies go only to people you turned on, only when they say “butler” by default, and wrapped in 🤖{ } by default. A draft is only text until you read it with `replies show` and approve it with `replies send`. Trusted TextButler code adds the marker, checks that the conversation has not moved on, and records the send.
- **No quiet switch to paid API use.** If the subscription route is unavailable, busy, or out of date, TextButler reports that and waits. It does not try another account or the Claude API.

## Not the Claude API

A subscription through xcb is not the same as the Claude API. TextButler's source describes a separately billed Claude API route, but it needs its own reviewed packaged runtime, and no build of this repository provides one, so it isn't available. Choosing Claude Code, Codex, or Devin never borrows an API key.

## Limits

TextButler status: {{SITE_STATUS_LABEL}}. This integration is for people who build TextButler themselves. You install xcb yourself, from its releases or from source, and it must be a build that includes the application mode TextButler calls. TextButler pins the xcb program you set up rather than a release number. It also pins a companion library, AgentMixer {{AGENTMIXER_VERSION}}, for shared helpers such as Claude API price parsing; that version number is not the version of xcb.

A successful account check reads xcb's account list without making a model call, so it does not show that a draft will be good or that a message will arrive. Automatic replies have worked end to end only over iMessage in our testing. Start with one person, or with an unsent draft, and see [Introducing TextButler](/blog/introducing-textbutler) for the full status and the rest of the reply flow. For how xcb itself works, read [Introducing xcb](https://xcb.sh/blog/introducing-xcb).
