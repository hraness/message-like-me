A subscription that writes code can also write a conversational reply. The important difference is what the model receives and what it can do with its answer. TextButler uses [xcb](https://xcb.sh) to request text from your Claude Code, Codex, or Devin subscription, while keeping messaging decisions in TextButler.

## Use the account you choose

You sign in through xcb and connect an account and model to TextButler. xcb keeps the subscription credentials in its own private state. TextButler supplies the conversation context needed for a reply.

This is one of TextButler’s reply options, alongside a local model through Ollama and a model reached through your Vercel AI Gateway key. With a subscription, context goes to that subscription provider. Keeping contact notes on your Mac does not make a hosted model call local.

The [subscription setup guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/native-subscription.md) explains how to connect an account and check that it is ready. A successful connection does not enable automatic replies for anyone.

## Ask for a response without opening a coding workspace

A coding tool usually works with a project: it reads files, runs commands and changes code. TextButler calls xcb’s application interface, which supplies no provider tools, coding workspace or inherited coding session.

For example, the model might receive the recent conversation, your notes about the contact, and a request to draft an answer about travel plans. It returns an answer or proposes one of the operations TextButler offered for that conversation.

TextButler checks those proposals and performs the allowed operation itself. The model cannot select another recipient or use the coding tool to run commands on your Mac. Access to conversation history, notes and optional search comes through TextButler’s contact settings.

## Keep writing and sending separate

The subscription model writes the words. TextButler applies the contact’s controls and disclosure settings, then sends through GhostGet.

You can keep the result as an unsent draft. Reviewing it shows both the recipient and the words that will be sent. The default AI marker makes the assistant’s role visible in the conversation; the owner can change that setting for individual contacts.

This division is useful even when the model is good at following instructions. A model’s suggestion about whom to contact is not a change to your contact settings. Those settings stay under your control.

## Handle an unavailable subscription without changing the plan

An account may be busy, at a usage limit, or need attention before it can run. TextButler’s subscription connection does not silently switch to another account or a paid API. A call that cannot complete returns a failure; resolve the account’s reported condition before trying a new request.

A message with an uncertain send result needs a different response: check what happened before trying again. Repeating model generation and repeating a send are separate actions, and an uncertain send must not turn into a duplicate reply.

Start with a reviewed draft in one selected conversation. It tests the full path from the notes the model receives to the reply you actually want to send. [Introducing TextButler](/blog/introducing-textbutler) explains the conversation controls; the [subscription guide](https://github.com/hraness/textbutler/blob/main/docs/textbutler/native-subscription.md) covers installation and account setup.
