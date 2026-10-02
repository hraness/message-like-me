# Security

Report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/hraness/textbutler/security/advisories/new).
Don’t open a public issue that contains a message, handle, contact name, group
title, attachment, local path, conversation note, API key, or anything else
that could identify a person.

Include the affected commit or version, your macOS version, the command you
ran, what you expected, what happened, and a reproduction built from synthetic
data.

## What TextButler protects

TextButler runs on your Mac and reads and sends messages in the conversations
you turn on. Treat all of the following as private:

- message text, attachments, and conversation history GhostGet returns;
- each conversation’s notes (`AGENTS.md`, `ABOUT.md`, `MEMORY.md`,
  `STYLE.md`) and its history excerpts;
- settings, contact bindings, the run and send journal, and unsent drafts;
- a saved Vercel AI Gateway key and the xcb and GhostGet account bindings.

These files live under TextButler’s application support folder and are private
to your macOS user. Conversation folders use opaque IDs, never names or phone
numbers. File permissions protect against other local users; they are not
encryption and don’t protect against malware, another process running as you,
backups, or an administrator.

## Boundaries

- **The model proposes; TextButler sends.** A reply model never runs commands
  on your Mac and never sends a message itself. TextButler checks every
  proposed action against the conversation’s settings and limits before
  GhostGet sends it.
- **One conversation at a time.** During a run the model sees only that
  conversation’s folder. It can’t reach other conversations, parent folders,
  links, or host settings.
- **You hold the switches.** New installs start paused, new conversations
  start turned off, and commands that send a reply or turn a chat on refuse to
  run for an agent.
- **No blind retries.** If TextButler can’t tell whether a send went through,
  it pauses that conversation instead of sending again.
- **Hosted models see context.** With a Gateway key or an xcb subscription,
  the conversation context for a reply goes to that provider under its own data
  terms. Web search sends its queries through your saved Gateway key, even when
  a local model writes the reply.
- **The website is data-blind.** [textbutler.app](https://textbutler.app)
  never receives messages, contacts, or settings, and the CLI never connects
  to it.

[`docs/textbutler/architecture.md`](docs/textbutler/architecture.md) describes
each path in detail, including what still needs checking before live use.

## Supported versions

Security fixes land on `main`. TextButler is installed from source; pull the
latest `main` and reinstall with `bun run textbutler:install` to pick them up.
