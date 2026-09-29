*This post covers the legacy Message Like Me history tools. Today, TextButler reads and sends live messages through GhostGet automation on your Mac, and you bring in a chat's recent history when you add it with `textbutler contacts add CANDIDATE --history`. See [Introducing TextButler](/blog/introducing-textbutler) for how that works.*

The legacy history tools can import your Beeper and WhatsApp history without signing in to either service or holding a Beeper or WhatsApp password or session. GhostGet, a separate local tool, exports that history to a private folder in the tools' own format, and the `messagelikeme` command checks the folder and imports it on your Mac. The two programs do not talk to each other during the import; the folder is the whole handoff.

## Who this is for

You already use Beeper, WhatsApp, or both, and you want the butler to have the history of a conversation with a friend, a sibling, or a group chat. You want that without giving a third app your messaging logins, and without anything leaving your Mac.

The export covers your own history, from accounts you are signed in to, and that includes the other people's messages in each conversation.

## What GhostGet does

[GhostGet](https://ghostget.com) is a local command line tool that works with the accounts you are already signed in to on your own computer. For messaging, it can read your Beeper Desktop history and your WhatsApp linked-device history. GhostGet holds the sign-in state and runs the export, and TextButler never sees that state.

For TextButler, GhostGet writes a finished folder of plain text files that describe your accounts, the people in each conversation, the conversations, and their messages, reactions, and deletions.

```sh
ghostget beeper export-message-like-me --auth <your-beeper-auth> \
  --output /absolute/private/path/beeper-bundle --json

ghostget whatsapp export-message-like-me --auth <your-whatsapp-auth> \
  --output /absolute/private/path/whatsapp-bundle --json
```

The command names still carry Message Like Me, TextButler's earlier name, because the format was named then and existing tools depend on it.

## How TextButler uses it

TextButler's side is one import command, run with its `messagelikeme` command-line tool, which also keeps the earlier name:

```sh
messagelikeme ingest bundle --input /absolute/private/path/beeper-bundle --json
messagelikeme sources list --json
```

The import reads only the finished folder. It does not start GhostGet, open Beeper or WhatsApp, use the network, or send anything.

### TextButler defines the folder format

The folder format is defined in TextButler's repository, as a small module of types and strict checking functions that does no file, network, or messaging work of its own. GhostGet does not keep its own copy of those rules. It depends on TextButler's module, pinned to one fixed commit, and runs every record it writes through TextButler's own checks before the folder is finished.

There are two versions:

- **Version 1, for Beeper.** One folder can hold several connected accounts, because Beeper bridges several networks. Each account becomes its own source in TextButler.
- **Version 2, for WhatsApp.** One folder holds exactly one WhatsApp account, and every address must be a well-formed WhatsApp identifier. Status updates, broadcasts and newsletters are rejected.

Because GhostGet checks its output with TextButler's code at a fixed commit, the rules change in one place, and GhostGet adopts a change only when its pin is updated.

### Each folder lists hashes of its own files

A bundle is seven files: six line-per-record text files and an index file written last. The index lists each file's record count, byte length and SHA-256 hash, plus one hash over the index itself, computed like this:

```text
bundle hash = SHA-256( canonical JSON of the index, without its integrity section )
```

"Canonical" means one exact spelling of the JSON, so the same content always produces the same bytes and the same hash. TextButler recomputes all of it before it changes anything in its store. It also refuses a folder that is not private to your user account, contains an extra file, a symbolic link, or a hard link, or changes while it is being read. Checking finishes before the store is touched, and the import itself is one database transaction, so a folder that fails is not partly imported.

### Both repositories test the same sample folder

A small synthetic bundle, with invented accounts such as "Synthetic Primary" and a placeholder phone number, is checked into both repositories as identical files:

- GhostGet's tests run its real exporter over the synthetic source with a fixed clock and require the output to match the checked-in folder byte for byte.
- TextButler's tests import that same checked-in folder and require the index file's SHA-256 to match the value recorded in the test.

If GhostGet's output changes by one byte, its own test fails. If TextButler's importer stops accepting the checked-in folder, TextButler's test fails. The two copies are kept identical by hand rather than by a shared check, so a deliberate format change means regenerating the folder in GhostGet and copying it into TextButler in step.

### Re-importing does not erase history

Each export is a snapshot of what your Mac could see at that moment, and TextButler treats it that way:

- A later export that leaves out an older message does not delete it from TextButler.
- An explicit deletion record hides its target, and if the message reappears later it comes back.
- An older snapshot cannot overwrite newer state.

You can run the export again next month, and a smaller window will not throw away what you imported before.

## What the import gives you

Your Beeper and WhatsApp conversations land in TextButler's private store on your Mac, where its replies can draw on that history, and TextButler never holds a Beeper or WhatsApp login. `sources list` shows what was imported, and `sources show` reports each source's health.

If you use WhatsApp both natively and through Beeper, TextButler stops and asks you to name the overlapping Beeper source with `--overlap-source` before it imports the native export. Both sources stay stored. It counts two messages as one only in one-to-one chats where your own number and the other person's number match exactly, and only after at least one unambiguous shared message agrees on sender, time, direction, text, and kind. Names, partial numbers, approximate times, group chats, and messages without text never count as a match.

## Limits

- **An export holds what your Mac had.** Each export records what the local apps had on your Mac, and says so. The Beeper export marks that it does not claim remote history, and the WhatsApp export marks remote history as incomplete.
- **No media.** Attachments come across as names and types only. Images, audio and video stay where they are.
- **WhatsApp reactions are left out.** The WhatsApp tool GhostGet reads cannot tell whether a reaction was later removed, so GhostGet drops reaction rows and adds a warning when it saw any. An empty reactions file in a WhatsApp bundle means reactions could not be observed.
- **The hashes cover the folder only.** They show the folder was not damaged or edited after GhostGet wrote it, not whether the messaging app's data was right or complete.
- **Keep the folder private.** It is not anonymized. Names, phone numbers, message text, and who talks to whom are all in it. Do not put it in Git, a shared folder, or a cloud drive.

TextButler status: {{SITE_STATUS_LABEL}}. It runs from source on a Mac and has no downloadable app yet; [Introducing TextButler](/blog/introducing-textbutler) covers what it does today and how to start. GhostGet lists the products that use it on [Built on GhostGet](https://ghostget.com/blog/built-on-ghostget).
