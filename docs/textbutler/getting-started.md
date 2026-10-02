# Start using TextButler

TextButler puts a clearly marked AI assistant in the iMessage, WhatsApp, and
Beeper chats you choose on your Mac, and it answers when someone says “butler”.
This guide takes you from a source checkout to one working conversation. Start
with the inbox and replies you write yourself. Automatic replies stay paused
until you choose what writes replies, turn them on for a contact, and resume
the butler.

If you're a coding agent following this guide for someone: run `textbutler
doctor` after each step and do what it says, stop and hand over whenever macOS
asks for a permission, a pairing, or a key, leave every contact turned off, and
don't send any messages.

## Before you start

You need a Mac, Bun 1.3.14, and exactly GhostGet 0.18.71, the tool that handles
messaging sign-in and permissions. Install it or update an existing installation
with the [GhostGet setup guide](https://ghostget.com/docs/tutorials/getting-started).
Run `ghostget --version` and confirm it reports `0.18.71` before connecting.
After an update, restart or reconnect TextButler's GhostGet host so it checks the
new capabilities, then run `textbutler doctor`.

AI replies need a local build of TextButler and something to write them. You can
use a local model through Ollama, Qwen 3.5 Flash through your own Vercel AI
Gateway key, or your Claude Code, Codex, or Devin subscription through xcb. If
you choose one with a command, that choice wins. Otherwise a saved Gateway key
wins over a local model.

When a Gateway key is saved, the butler can also search the web for the people
you turn on (in your own chat, only when you ask), using your key even when a
local model writes the replies. It refuses any search that reuses words from
your private messages. Turn search off for one person with `habitats configure`.

Installing doesn't turn replies on. Test live messaging with a recipient you
trust. The Claude API route needs a separately reviewed runtime that neither the
source checkout nor the local build supplies.

## Open the guided terminal

From your TextButler checkout, with Bun 1.3.14:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run textbutler tui
```

For daily use, install a local command that works outside the checkout:

```sh
bun run textbutler:install
~/.local/bin/textbutler
```

The installer builds a self-contained local copy. It checks your source files
and both contact permission profiles against the reviewed record in
`qualification/`, and verifies the copy's contents and exact Bun runtime before
use. If the source doesn't match the reviewed record, the build stops. A daemon
started from source never writes AI replies.

The installer starts no services and connects no accounts. It keeps an existing,
different `textbutler` command. This is a local build, not a signed public
release, and connecting a reply writer is a separate step. Keep the same Bun
runtime installed.

To upgrade a verified installation, stop its services and run
`bun run textbutler:install --upgrade`. The installer checks the existing
launcher and the complete installed version, keeps them for rollback, and
switches the command atomically. It never replaces an unrelated command or
changes your settings. Restart the installed daemon afterward.

The terminal has numbered actions for setup, app connections, conversations,
replies, contacts, pause, and macOS access. Enter goes back from a selection;
`q` or Ctrl-C closes the terminal but doesn't stop an installed background
service. Commands below use `bun run textbutler`, which the help shortens to
`textbutler`. You can use `~/.local/bin/textbutler` for any of them. Use the
installed terminal when you set up daemon startup for AI replies.

Choose **Setup & readiness** first. It creates private settings and points you
to messaging setup. After you save your connections, return to **Setup &
readiness** to start the service at login. Repeating setup keeps existing
settings and which contacts are turned on. Run `doctor` at any time to see
connection status, the setup steps left, and whether replies can be written yet.

## Connect your messaging apps

TextButler uses GhostGet for account sign-in, permissions, and messaging access.
[Install or update GhostGet](https://ghostget.com/docs/tutorials/getting-started)
to exactly `0.18.71`, then check the version of the executable you'll configure
below. You need its physical executable path and the exact account ID;
TextButler doesn't guess an identity. Native iMessage can use the app setup flow
below. Set up other messaging accounts in GhostGet first.

Choose **Connect messaging apps** in the terminal:

- **iMessage:** the native Mac Messages connection.
- **WhatsApp:** a native linked device; connecting starts sync.
- **Beeper:** linked apps such as Signal, Telegram, Instagram, WhatsApp, and
  iMessage. Keep Beeper Desktop open with its local API turned on. GhostGet's
  current automation adapter supports direct and group conversations with text
  replies.

TextButler uses GhostGet's `ghostget.messaging-automation/1` protocol and checks
the account's capabilities when its host connects. Updating GhostGet doesn't
refresh a host that's already running: restart TextButler's background service
or reconnect its GhostGet host, then run `textbutler doctor` before selecting
conversations.

You can also script initial setup. Replace the paths and IDs with your own:

```sh
bun run textbutler setup \
  --ghostget /absolute/path/to/ghostget \
  --account imessage:messages \
  --account beeper:beeper-main
```

If GhostGet's entry point is a TypeScript file, also pass
`--runtime /absolute/path/to/bun`. An optional `--state-home` selects its
existing state directory. Setup only adds: it keeps existing accounts and agent
settings and refuses to replace an account identity.

To add a connection, stop the service, then run setup with the same connector
paths and the new account ID. To change existing bindings, stop the foreground
service or uninstall its login entry, review the private `state/host.json`, then
restart or reinstall the service. Uninstalling keeps your settings, contact
memory, and activity.

For foreground use with AI, run `~/.local/bin/textbutler daemon run` in another
terminal. To start at login, run `~/.local/bin/textbutler daemon install`. Use
your own installation prefix if it's different. Source daemon commands still
work for manual testing; keep that checkout at its current path while a source
service is installed.

See [messaging app support](messaging-apps.md) for Beeper limits and native
alternatives, including rules that affect AI processing of Telegram messages.

## Give TextButler access to iMessage

In the guided terminal, **Give TextButler access** walks you through the two
macOS settings below in order, and opens each System Settings pane when you
press Enter or `o`. It never triggers a macOS prompt itself.

Use the native app when you want macOS Full Disk Access to belong to
`TextButler.app`. The app supervises its pinned runtime and background service.
Build it from an installed, verified payload on your Mac:

```sh
bun run textbutler:app build \
  --from /absolute/installed/textbutler/version \
  --output /absolute/new/app-build-directory
bun run textbutler:app install --from /absolute/new/app-build-directory
```

The default destination is `~/Applications/TextButler.app`, which macOS lists
as TextButler. Building and installing the app doesn't start replies or change
macOS permissions. macOS never asks for Full Disk Access, so `install` ends
with a notice; at a terminal, press Enter to open the Full Disk Access pane. In
**System Settings → Privacy & Security → Full Disk Access**, click **+**, press
**Command-Shift-G**, enter `~/Applications/TextButler.app`, and choose **Open**.
Turn on its switch. macOS may ask for your password in its own dialog.

Configure the exact GhostGet `src/cli.ts`, Bun runtime, private state directory,
and `imessage:ACCOUNT` binding with `setup` above. Native setup requires exactly
GhostGet 0.18.71 and its reviewed `imsg` helper. Before linking, setup installs
that pinned helper into the connector's state directory
(`imessage transport install`); if the helper is missing or doesn't match, setup
stops before it touches messaging. Setup links only that account to this Mac's
Messages store and turns on GhostGet's automation permissions for that account
to read, send text, and send attachments. Choosing contacts and turning on
automatic replies are separate steps.

With the background service stopped, run the setup role through the app:

```sh
bun run textbutler:app imessage-setup \
  --data-dir "$HOME/Library/Application Support/Textbutler"
```

Before macOS asks to let TextButler control Messages, setup prints a notice;
press Enter to continue or `s` to skip. If you choose Don't Allow, macOS won't
ask again: turn on Textbutler in **System Settings → Privacy & Security →
Automation**, then run the setup command again. `textbutler doctor` shows
which of these steps is left.

After app setup finishes, register the background service with the installed
`daemon install` command. If an older service is installed, run
`daemon uninstall` first; it keeps your settings and contacts. On startup the
service checks the native app's install record and every pinned file. A changed
app or runtime needs a verified rebuild and reinstall. Local apps use ad hoc
signatures, so macOS may ask for permission again after a rebuild. Check
`doctor` and the messaging connection before turning on a contact.

### Upgrade or roll back the app

To upgrade an installed app, stop the service and finish or reconcile any
pending setup attempt, then build from the new installed payload. Install it
with:

```sh
bun run textbutler:app install --from /absolute/new/app-build-directory --upgrade
```

The upgrade checks both versions and keeps the previous signed app and its
install record. If it reports an uncertain transition, keep its records and
reconcile that transition before trying again. Check Full Disk Access and
Messages Automation again after the upgrade.

Apps now include the TextButler icon, and releases from before the icon can't
verify them. To go back to an earlier release, stop the service, move
`~/Applications/TextButler.app` and `state/macos-app.json` in your data folder
somewhere safe, then build and install the app from that release. Then turn on
macOS access for the reinstalled app again.

### If the connector's provider changes

Changing the connector's provider implementation changes the identity it
reports. Existing conversation enrollments then report that the provider
identity changed, and you must enroll them again. Per-operation owner
permissions are also tied to the implementation, so approve them again with the
permission command. Re-enrolling keeps each contact's memory and run history:
enroll the same conversation, grant the new binding, and point the contact at
the new enrollment in one settings write, then revoke the old grants.

See [local data](local-data.md) for the setup records TextButler keeps and how
to remove installation data. Repeating setup keeps an already linked account
and its identity.

## Pick what writes replies

Choose one of the three options below. You can switch later.

### A local model on your Mac

With a local model, the reply is written on your Mac. Install
[Ollama](https://ollama.com), then pull the model TextButler looks for (about
2.5 GB; TextButler never downloads a model for you):

```sh
ollama pull qwen3:4b-instruct-2507-q4_K_M
```

When no Gateway key is saved, the background service finds that model on
Ollama's local port when it starts. To choose the local model explicitly, even
with a Gateway key saved, stop the service and run:

```sh
~/.local/bin/textbutler providers local
```

`providers local MODEL` picks another model you've pulled, and
`--base-url http://127.0.0.1:<port>/v1` points at another OpenAI-compatible
server on this Mac. Restart the background service afterward. `textbutler
doctor` shows which model writes your replies. Web search on this route still
needs a saved Gateway key.

### Qwen 3.5 Flash with your own Vercel AI Gateway key

Create an API key in the Vercel AI Gateway dashboard, copy it, and pipe it in so
it never lands in your shell history:

```sh
pbpaste | ~/.local/bin/textbutler providers gateway-key
```

TextButler stores it, readable only by you, under `state/provider-credentials`
in your data folder. Restart the background service (`daemon uninstall`, then
`daemon install`), and Qwen 3.5 Flash writes your replies, with spending capped
at $1 a day. `textbutler doctor` shows which model writes your replies. A
`habitat` block you write yourself in `state/host.json` takes precedence, and
`"enabled": false` there turns this reply writer off.

### Your Claude Code, Codex, or Devin subscription

Install an xcb native build with `generate` support and follow its
[account setup](https://github.com/hraness/xcb#native-xcb). Sign in through xcb,
then run `xcb accounts` and `xcb models` to get the exact account ID and full
model key. Credentials stay in xcb's private state.

With the TextButler daemon stopped, connect that installation:

```sh
bun run textbutler setup \
  --xcb /absolute/path/to/xcb \
  --xcb-state /absolute/path/to/xcb-state \
  --xcb-account claude:ACCOUNT_ID \
  --xcb-model FULL_MODEL_KEY
```

For Codex or Devin, use `--xcb-account codex:ACCOUNT_ID` or
`--xcb-account devin:ACCOUNT_ID` and a model key that `xcb models` listed for
it. Repeat setup to add another provider's account. The command pins the
executable's bytes and the account and model you chose; it doesn't turn on a
contact. Setup refuses to change an existing executable or account and model
binding. After an xcb upgrade, stop the daemon and review its binding in the
private `state/host.json` before updating the executable digest. Keep the
existing account and account-lock state.

Start or restart the installed daemon, then check the account:

```sh
bun run textbutler providers list
bun run textbutler providers check TEXTBUTLER_ACCOUNT_ID
bun run textbutler doctor
```

Use the account ID that `providers list` returns. The check reads xcb's current
capabilities and whether it allows this provider to run, without making a model
call. Fix any unavailable or recovery status before you ask for an unsent
suggestion. The [subscription guide](native-subscription.md) explains how runs
and account locks work. Passing the source and bundle integrity checks doesn't
mean an AI provider is ready.

## Add one conversation and try the inbox

Choose **Add a conversation**, select the exact direct or group chat and app,
and review its members. For a direct chat, you can also import recent text
history. Group context starts with new messages after you add the group; older
group history isn't imported. Each group has its own editable notes. If the
account or membership changes, add that group again before replies resume.
Selecting a conversation or importing history never sends anything. The new
conversation has automatic replies off.

Choose **Inbox & replies**. TextButler lists unanswered incoming messages in your
selected conversations. Choose **Type a reply**, review the recipient and the
complete disclosed text, then type `send` if you want to send it. This path
doesn't need an AI account. Leaving the review sends nothing.

After the connected agent passes its readiness check, choose it under **Manage a
contact**. A suggestion is an unsent draft. Review every action before sending.
The CLI supports the same review:

```sh
bun run textbutler inbox
bun run textbutler replies suggest CONTACT
bun run textbutler replies show DRAFT
bun run textbutler replies send DRAFT DIGEST
```

Use the exact digest that `replies show` prints. Changes to a draft or its
attachment bytes invalidate that review. A result of `submitted` means the
transport accepted the action; it doesn't prove the recipient received or read
it.

A pending command prints a job ID. Run `jobs show JOB_ID` with the same data
directory. Don't repeat an uncertain send or grant operation. TextButler keeps
blocking that operation until it can be reconciled, and restarting doesn't clear
the block.

## Shape a contact's butler

Each contact's habitat keeps a short `soulCore` you write (voice, relationship
context, shared context, and boundaries) separate from the tone and formality
the butler learns. The contact's memory archive can keep 64 sourced notes. Each
reply sees only a small snapshot, and the butler can search older notes locally
for relevant preferences or open topics. Inspect or clear memory with
`habitats show CONTACT` or `habitats memory-clear CONTACT REVISION`.

Search and memory are limited to one contact. JavaScript is off by default; turn
it on only for a contact whose butler should have the pure-data calculation
tool. It runs code in a fresh QuickJS WebAssembly runtime without network, file
system, timers, or host APIs, under strict CPU and memory limits. Exa web search
is a separate setting you control, and it can send public queries to the search
provider, so leave it off when you don't want that.

While the daemon is paused, configure a contact's plan with the exact revision
that `habitats show CONTACT` reports:

```sh
textbutler habitats configure CONTACT REVISION '{"version":1,"guidance":"Be considerate and remember useful shared context without assuming familiarity.","contextMessages":12,"maxReplyCharacters":640,"humor":"match","webSearch":false,"memeSearch":true,"javascript":true,"memorySearch":true,"soulCore":{"voice":"Warm and concise","relationshipContext":"Longtime friend","sharedContext":"They are planning a trip together","boundaries":"Do not make plans or commitments for the owner"}}'
```

Replace the contact ID and plan values with what you want for that conversation.
The learned style can change based on feedback with sources, but it can't
rewrite your `soulCore` or change which tools are allowed. Tool output informs
a reply; it never gives permission to send a message. See
[contact calculation and memory tools](javascript-tools.md) for the runtime
limits and how memory search works.

## Check on it from the terminal

TextButler has no window or menu bar icon. The background service keeps working
after you close the terminal, and you check on it with:

```sh
bun run textbutler status
bun run textbutler inbox
bun run textbutler pause
```

`status` shows whether the service is running, whether replies are paused, and
each contact's state. `inbox` lists chats waiting for your reply. `pause` and
`resume` stop and restart every automatic reply at once. `daemon uninstall`
unregisters the background service and keeps your data.

If you open `TextButler.app` itself, it starts nothing and exits: the app exists
so macOS can grant iMessage access to TextButler, and launchd runs its
background roles. Upgrading with `bun run textbutler:install --upgrade` moves
the retired menu bar companion's login item aside if an earlier version added
it. It renames the file and never deletes it. Every menu item it had is now a
command; [the command reference](cli-parity.md) lists where each one went.

## Turn on automatic replies only when ready

Once a reply writer and messaging connection are ready, choose the contact's
response mode, turn that contact on, then resume. If you use a subscription
through xcb, also select its account for the contact. These are separate
choices. `doctor` must show that a reply writer and the messaging connection are
actually available; a successful setup alone isn't enough.

```sh
bun run textbutler contacts account CONTACT ACCOUNT
bun run textbutler contacts mode CONTACT keyword --keyword butler
bun run textbutler contacts enable CONTACT
bun run textbutler resume
```

`pause` stops automatic replies for every contact. `contacts disable CONTACT`
also revokes that contact's permission to send. Replies you confirm yourself
remain available while automatic replies are paused.

Your Mac must be awake and signed in. Begin with one conversation and confirm
how it behaves with a test recipient who has agreed, before relying on
automation. See [agent setup](../../packages/textbutler/PROVIDERS.md) for what
each reply writer needs before it can be used.

## Next steps

- [Agent CLI guide](agent-cli.md): JSON commands for another agent to read,
  summarize, compose, and send messages.
- [Campaigns](campaigns.md): send your own words to several people at a slow,
  safe pace.
