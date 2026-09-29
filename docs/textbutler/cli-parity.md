# Textbutler commands

Everything Textbutler does is a command. Add `--json` to any command below and
it prints one JSON object with `ok`, `schema`, `generatedAt` and either
`data` or `error`. `textbutler commands --json` prints this list for an
agent to read.

## Who can run what

Each command has one of four kinds:

- **read** only looks. It never changes anything.
- **operate** changes something an agent may change on its own: pausing,
  turning a chat off, throwing a suggestion away, stopping the service.
- **decide** belongs to a person. Run from an agent or a script, it stops with
  `human-required` (exit 3) and changes nothing. Run in your own terminal, it
  asks you to type a short one-time code shown on that terminal.
- **decide-legacy** is a decision that worked before the one-time code existed.
  It keeps working as it did, bound to a digest or a settings revision, and is
  listed here so you can see it.

Error codes and exit statuses: `usage` 2, `human-required` 3,
`owner-unavailable` 4 (the service isn't running), `conflict`,
`digest-mismatch` and `control-already-running` 5.

## The service

The background service owns one private socket in your Textbutler data folder.
Only your macOS user can open it. The CLI checks each command's kind before it
sends anything, so there is no separate socket for agents.

`textbutler control serve` runs the service in a terminal. It does not start at
login unless you run `textbutler control install` yourself.
`textbutler control stop` asks the running service to finish and exit; it never
sends a signal to a process.

## Every command

| Command | Kind | What it does |
| --- | --- | --- |
| `status` | read | One-screen health: service, chats, suggestions, accounts |
| `tui` | read | Guided terminal; --snapshot or --json print the views without a terminal |
| `doctor` | read | Check setup, macOS access, the service and legacy login items |
| `control serve` | operate | Run the background service in this terminal until control stop |
| `control status` | read | Show whether the service is running and whether it starts at login |
| `control stop` | operate | Ask the running service to finish and exit; never signals a process |
| `control install` | decide (person only) | Start the service at login (a persistent login item) |
| `control uninstall` | decide (person only) | Stop the service and remove its login item |
| `approvals list` | read | List reply suggestions waiting for a decision |
| `approvals show <id>` | read | Show every action in a suggestion and the digest to decide it |
| `approvals decide <id> --digest <digest> <allow-once\|deny>` | decide (person only) | Send a reviewed suggestion exactly as shown (allow-once), or discard it (deny) |
| `permissions list` | read | Show which chats may get automatic replies |
| `permissions set <contact> --expected-revision <n> <tighten\|loosen>` | decide (person only) | Turn one chat's automatic replies on (loosen) or off (tighten) |
| `setup` | operate | Create private settings (paused) or add a connection |
| `init` | operate | Create private settings without the checklist |
| `pause` | operate | Pause automatic replies for every chat |
| `resume` | decide-legacy | Resume automatic replies (chats that are off stay off) |
| `inbox` | read | List chats waiting for your reply |
| `replies suggest` | decide-legacy | Write a reply suggestion (spends model credits); never sends |
| `replies show` | read | Show every action and the digest of a suggestion |
| `replies send` | decide-legacy | Send a reviewed suggestion by digest, or your own text |
| `replies discard` | operate | Throw a suggestion away |
| `replies reconcile` | operate | Record whether an uncertain send arrived |
| `conversations list` | read | List recent one-to-one chats you can add |
| `contacts list` | read | Show added chats and their settings |
| `contacts add` | operate | Add a chat with automatic replies off |
| `contacts enable` | decide-legacy | Turn on automatic replies for a chat |
| `contacts disable` | operate | Turn off automatic replies and remove send access |
| `contacts account` | operate | Choose the AI account for a chat |
| `contacts mode` | decide-legacy | Answer everything (smart) or only on a keyword |
| `contacts self` | operate | Mark a chat with yourself |
| `contacts label` | operate | Rename a chat |
| `messaging list` | read | Show configured messaging apps |
| `messaging start` | decide-legacy | Connect iMessage, WhatsApp or Beeper |
| `providers gateway-key` | decide-legacy | Save a Vercel AI Gateway key from a pipe |
| `providers local` | operate | Write replies with a model on this Mac |
| `providers list` | read | Show connected AI accounts |
| `providers check` | read | Check that one AI account is ready |
| `daemon install` | decide-legacy | Start the service now and at login (same as control install) |
| `daemon uninstall` | operate | Stop the service and remove it from login |
| `daemon status` | read | Show whether the service is running |
| `daemon run` | operate | Run the service in this terminal (same as control serve) |
| `jobs show` | read | Read the result of a long operation |
| `habitats show` | read | Show a chat's reply style, memory and budget |
| `habitats configure` | operate | Replace a chat's habitat (replies paused) |
| `habitats rollback` | operate | Go back to an earlier habitat revision |
| `habitats memory-clear` | operate | Forget a chat's learned excerpts |
| `habitats task-stage` | operate | Stage a shadow task (replies paused) |
| `habitats task-rollback` | operate | Roll back a shadow task |
| `messages history` | read | Read one chat's recent messages |
| `messages summarize` | decide-legacy | Summarize one chat (spends model credits) |
| `messages capabilities` | read | Show what a chat can send |
| `messages compose` | operate | Draft a reply from text or actions |
| `messages react` | operate | Draft a reaction |
| `messages attach` | operate | Draft an attachment |
| `messages send` | decide-legacy | Send your own text in a chat |
| `campaign run` | decide-legacy | Send your own texts at a slow pace |
| `campaign status` | read | Show a campaign's progress |
| `support` | read | See optional ways to support Textbutler |

## Where the old menu bar items went

Textbutler no longer has a menu bar icon. Each item it had is a command:

| Menu item | Command |
| --- | --- |
| Status line, Details, Recent activity | `textbutler status` or `textbutler tui --snapshot` |
| Refresh now, Check again | `textbutler status` again, or `textbutler jobs show <id>` |
| Automatic replies (per chat) | `textbutler permissions set <chat> --expected-revision <n> loosen` or `tighten` |
| Choose an agent account (per chat) | `textbutler contacts account <chat> <account>` |
| Pause or Resume automatic replies | `textbutler pause`, `textbutler resume` |
| Replies waiting, Check for replies | `textbutler inbox` |
| Suggest a reply | `textbutler replies suggest <chat>` |
| Review and send a suggestion | `textbutler approvals show <id>`, then `textbutler approvals decide <id> --digest <digest> allow-once` |
| Discard suggestion | `textbutler approvals decide <id> --digest <digest> deny` |
| Find conversations to add, Add a conversation | `textbutler conversations list`, `textbutler contacts add <id>` |
| Connect a messaging app | `textbutler messaging start imessage`, `whatsapp` or `beeper` |
| Open Full Disk Access or Automation settings | `textbutler doctor` prints the exact settings pane |
| Start Textbutler at login | `textbutler control install` |
| Setup guide, Get started | `textbutler setup` |
| Help & support | `textbutler support` |
| Quit Textbutler | `textbutler control stop` |

## Old login items

If an earlier version installed the menu bar's login item, the installer moves
it aside to a `.retired-<time>` file when you reinstall. It never deletes the
file and never touches a login item that it didn't create.
`textbutler doctor --json` lists any that remain under `legacyLoginItems`.
