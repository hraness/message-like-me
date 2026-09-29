# Start using TextButler

TextButler puts a clearly marked AI assistant in the iMessage, WhatsApp, and
Beeper chats you choose on your Mac, and it answers when someone says “butler”.
Start with its inbox and replies you write yourself. Automatic replies stay
paused until you choose what writes replies, turn them on for a contact, and
resume the butler.

If you're a coding agent following this guide for someone: run `textbutler
doctor` after each step and do what it says, stop and hand over whenever macOS
asks for a permission, a pairing, or a key, leave every contact turned off, and
don't send any messages.

You need a Mac, Bun 1.3.14, and GhostGet, a separate Mac tool that handles
messaging sign-in and permissions. If GhostGet isn't installed, follow its
[getting started tutorial](https://ghostget.com/docs/tutorials/getting-started)
first.

AI replies need a local build of TextButler and something to write them.
Replies can be written by a local model through Ollama (in testing), by Qwen 3.5
Flash through your own Vercel AI Gateway key, or by your Claude Code, Codex, or
Devin subscription through xcb. If you choose one with a command, that choice
wins. Otherwise a saved Gateway key wins over a local model. When a Gateway key
is saved, the butler can also search the web for the people you turn on (in
your own chat, only when you ask), using your key even when a local model
writes the replies. It refuses any search that reuses words from your private
messages; turn search off for one person with `habitats configure`. Installing doesn't turn replies on, and you should
test live messaging with a recipient you trust. The Claude API route needs a
separately reviewed runtime that neither the source checkout nor the local build
supplies.

## Open the guided terminal

From your TextButler checkout, with Bun 1.3.14:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run textbutler tui
```

For daily use, you can install a local command that works outside the checkout:

```sh
bun run textbutler:install
~/.local/bin/textbutler
```

The installer builds a self-contained local copy, checks your source files and
both contact permission profiles against the reviewed record in
`qualification/`, and verifies its contents and exact Bun runtime before use. If
the source doesn't match the reviewed record, the build stops. A daemon started
from source never runs AI replies. The installer starts no services and connects no accounts.
An existing, different `textbutler` command is preserved. This is a local build,
not a signed public release. Connect xcb separately for AI replies. Keep the same
Bun runtime installed. To upgrade a verified existing installation, stop its
services and run `bun run textbutler:install --upgrade`. The installer checks
the existing launcher and complete installed version, preserves them for
rollback, and atomically switches the command. It never replaces an unrelated
command or changes your settings. Restart the installed daemon afterward.

The terminal has numbered actions for setup, app connections, conversations,
replies, contacts, pause and macOS access. Enter goes back from a selection;
`q` or Ctrl-C closes the terminal. It does not stop an installed background
service. Commands below use `bun run textbutler`; the help abbreviates that
prefix to `textbutler`. You can use `~/.local/bin/textbutler` for these commands.
Use the installed terminal when setting up daemon startup for AI replies.

Choose **Setup & readiness** first. It creates private settings and points you
to messaging setup. After saving your connections, return to **Setup & readiness**
to start the service at login. Repeating setup preserves existing settings and
contact activation. Use `doctor` at any time to see connection status, remaining
setup steps and whether reply generation is actually available.

## Connect your messaging apps

TextButler uses an existing GhostGet installation for account sign-in, permissions
and messaging access. [Install GhostGet](https://ghostget.com/docs/tutorials/getting-started)
first if you haven't. You need its physical executable path and the exact account
ID; TextButler does not guess an identity. Native iMessage can use the app setup
flow below. Set up other messaging accounts in GhostGet first.

Choose **Connect messaging apps** in the terminal:

- **iMessage:** the native Mac Messages connection.
- **WhatsApp:** a native linked device; connecting explicitly starts sync.
- **Beeper:** linked apps such as Signal, Telegram, Instagram, WhatsApp and
  iMessage. Keep Beeper Desktop open with its local API enabled. The current
  GhostGet automation adapter supports direct conversations and text replies.

Beeper automation requires GhostGet 0.18.14 or later with the
`ghostget.messaging-automation/1` protocol. A connection being configured does
not prove that it is connected. Check it before selecting conversations.

Initial setup can also be scripted. Replace the paths and IDs with your own:

```sh
bun run textbutler setup \
  --ghostget /absolute/path/to/ghostget \
  --account imessage:messages \
  --account beeper:beeper-main
```

If GhostGet's entrypoint is a TypeScript file, also pass
`--runtime /absolute/path/to/bun`. An optional `--state-home` selects its existing
state directory. Configuration is additive: this command preserves existing accounts and agent
settings and refuses to replace an account identity. Stop the service before
adding a connection, then run setup with the same connector paths and the new
account ID. To change existing bindings, stop the
foreground service or uninstall its login entry, review private
`state/host.json`, then restart or reinstall the service. Uninstall retains your
settings, contact memory and activity.

For foreground use with AI, run `~/.local/bin/textbutler daemon run` in another
terminal. For login startup, use `~/.local/bin/textbutler daemon install`. Use
your chosen installation prefix if different. Source daemon commands remain
available for the manual pilot; keep that checkout at its current path while a
source service is installed.

See [messaging app support](messaging-apps.md) for Beeper limitations and native
alternatives, including requirements that affect Telegram AI processing.

## Shape a contact's butler

Contact habitats keep a small owner-authored `soulCore` (voice, relationship
context, shared context and boundaries) separate from the butler's learned tone
and formality. The contact-local memory archive can retain 64 sourced notes;
each reply sees only a small snapshot, and the butler can search older notes
locally for relevant preferences or open topics. Inspect or clear it with
`habitats show CONTACT` or `habitats memory-clear CONTACT REVISION`.

Search and memory are contact-scoped. JavaScript is separately disabled by
default; enable it only for a contact whose butler should receive the pure-data
tool. It runs code in a fresh QuickJS WebAssembly runtime without network,
filesystem, timers or host APIs, under strict CPU and memory budgets. Exa web
search remains separately owner-controlled and can send public queries to the
search provider, so leave it off when that is not wanted.

Configure an individual plan while the daemon is paused, using the exact
revision reported by `habitats show CONTACT`:

```sh
textbutler habitats configure CONTACT REVISION '{"version":1,"guidance":"Be considerate and remember useful shared context without assuming familiarity.","contextMessages":12,"maxReplyCharacters":640,"humor":"match","webSearch":false,"memeSearch":true,"javascript":true,"memorySearch":true,"soulCore":{"voice":"Warm and concise","relationshipContext":"Longtime friend","sharedContext":"They are planning a trip together","boundaries":"Do not make plans or commitments for the owner"}}'
```

Replace the contact ID and plan values with what you want for that conversation.
The learned style can evolve from sourced feedback, but it cannot rewrite the
owner-authored `soulCore` or change tool grants. Tool output is evidence, never
permission to send a message. See [contact calculation and memory tools](javascript-tools.md)
for the runtime limits and memory-search behavior.

## Give TextButler access to iMessage

In the guided terminal, **Give TextButler access** walks you through the two
macOS settings below in order and opens each System Settings pane when you
press Enter or `o`. It never causes a macOS prompt itself.

Use the native app when you want macOS Full Disk Access to belong to `TextButler.app`.
The app supervises its pinned runtime and background service. Build it from an
already installed, verified payload on your Mac:

```sh
bun run textbutler:app build \
  --from /absolute/installed/textbutler/version \
  --output /absolute/new/app-build-directory
bun run textbutler:app install --from /absolute/new/app-build-directory
```

The default destination is `~/Applications/TextButler.app`, which macOS lists
as TextButler. Building and installing the app does not start replies or change
macOS permissions. macOS never asks for Full Disk Access, so `install` ends
with a notice; at a terminal, press Enter to open the Full Disk Access pane. In
**System Settings → Privacy & Security → Full Disk Access**, click **+**, press
**Command-Shift-G**, enter `~/Applications/TextButler.app`, and choose **Open**.
Enable its switch. macOS may require your password in its own dialog.

Configure the exact GhostGet `src/cli.ts`, Bun runtime, private state directory
and `imessage:ACCOUNT` binding using `setup` above. This development version pins
GhostGet 0.18.44 and its reviewed `imsg` helper artifact. Native setup provisions
that pinned helper into the connector state directory (`imessage transport install`)
before linking; a missing or mismatched artifact stops setup instead of reaching
messaging. Setup links only
that account to this Mac's Messages store and
enables GhostGet's account-specific automation read, text and attachment-send capabilities.
Contact selection and automatic replies remain separate choices.

With the background service stopped, run the setup role through its verified
app launch:

```sh
bun run textbutler:app imessage-setup \
  --data-dir "$HOME/Library/Application Support/Textbutler"
```

Before macOS asks to let TextButler control Messages, setup prints a notice;
press Enter to continue or `s` to skip. If you choose Don't Allow, macOS won't
ask again: turn on Textbutler in **System Settings → Privacy & Security →
Automation**, then run the setup command again. `textbutler doctor` shows
which of these steps is left.

After app setup completes, use the installed `daemon install` command to
register its background service. If an older service is installed, first use
`daemon uninstall`; this preserves your settings and contacts. Startup verifies
the native app receipt and all pinned artifacts. A changed app or runtime
requires a verified rebuild and reinstall. Local apps use ad-hoc signatures,
so macOS may require permission again after a rebuild. Check `doctor` and the
messaging connection before enabling a contact.

To upgrade an installed app, stop the service and finish or reconcile any
pending setup attempt, then build from the new installed payload. Install it
with the following command:

```sh
bun run textbutler:app install --from /absolute/new/app-build-directory --upgrade
```

Apps now include the TextButler icon, and releases from before the icon can't
verify them. To go back to an earlier release, stop the
service, move `~/Applications/TextButler.app` and `state/macos-app.json` in
your data folder somewhere safe, then build and install the app from that
release. Then turn on macOS access for the reinstalled app again.

The upgrade verifies both versions and retains the previous signed
app and receipt. If it reports an uncertain transition, preserve its records
and reconcile that transition before retrying. Recheck Full Disk Access and
Messages Automation after the upgrade.

Changing the connector's provider implementation changes its reported
identity. Existing conversation enrollments then report that the provider
identity changed and must be enrolled again; per-operation owner permissions
likewise key on the implementation and must be approved again through the
permission command. Re-enrolling preserves each contact's memory and run
history: enroll the same conversation coordinate, grant the new binding, and
update the contact's route reference to the new enrollment in one owner-state
write, then revoke the superseded grants.

See [local data](local-data.md) for retained setup records and installation data
removal. Repeating setup preserves an already linked account and its identity.

For JSON commands to read, summarize, compose and send messages from another
agent, see the [agent CLI guide](agent-cli.md).

To send your own words to several people at a slow, safe pace, see
[campaigns](campaigns.md).

## Pick what writes replies

Choose one of the three options below. You can switch later.

### A local model on your Mac (in testing)

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

TextButler stores it owner-only under `state/provider-credentials` in your data
folder. Restart the background service (`daemon uninstall`, then
`daemon install`) and replies are written by Qwen 3.5 Flash, with spending
capped at $1 a day. `textbutler doctor` shows which model writes your replies.
A `habitat` block you write yourself in `state/host.json` takes precedence, and
`"enabled": false` there turns this reply writer off.

### Your Claude Code, Codex, or Devin subscription

Install an xcb native build with `generate` support and follow its
[account setup](https://github.com/hraness/xcb#native-xcb). Sign in through xcb,
then use `xcb accounts` and `xcb models` to obtain the exact account ID and full
model key. Credentials remain in xcb's private state.

With the TextButler daemon stopped, connect that installation:

```sh
bun run textbutler setup \
  --xcb /absolute/path/to/xcb \
  --xcb-state /absolute/path/to/xcb-state \
  --xcb-account claude:ACCOUNT_ID \
  --xcb-model FULL_MODEL_KEY
```

For Codex or Devin, use `--xcb-account codex:ACCOUNT_ID` or `--xcb-account devin:ACCOUNT_ID`
and a matching observed model. Repeat setup to add another provider's account. The command pins the executable bytes and
explicit routing; it does not activate a contact. Setup refuses changes to an
existing binary or account/model binding. After an xcb upgrade, stop the daemon
and review its private `state/host.json` binding before updating the executable
digest. Retain account and custody state.

Start or restart the installed daemon, then check the account:

```sh
bun run textbutler providers list
bun run textbutler providers check TEXTBUTLER_ACCOUNT_ID
bun run textbutler doctor
```

Use the account ID returned by `providers list`. This checks xcb's current
capabilities and admission without making a model turn. Resolve any unavailable
or recovery status before asking for an unsent suggestion. See the
[subscription connection](native-subscription.md) for the execution and custody
contract. Source and bundle integrity checks alone do not qualify an AI provider.

## Add one conversation and try the inbox

Choose **Add a conversation**, select the exact person and app, and choose
whether to import recent text history. Importing history never sends anything.
The new contact has automatic replies off.

Choose **Inbox & replies**. TextButler lists unanswered incoming messages in your
selected conversations. Choose **Type a reply**, review the recipient and the
complete disclosed text, then type `send` if you want to send it. This path does
not require an AI account. Leaving the review sends nothing.

After the connected agent passes its readiness check, choose it under **Manage a contact**.
A suggestion is an unsent draft. Review every action before sending. The CLI
supports the same review:

```sh
bun run textbutler inbox
bun run textbutler replies suggest CONTACT
bun run textbutler replies show DRAFT
bun run textbutler replies send DRAFT DIGEST
```

Use the exact digest shown by `replies show`. Changes to a draft or its attachment
bytes invalidate that review. A result of `submitted` means the transport
accepted the action; it is not proof that the recipient received or read it.

A pending command prints a job ID. Use `jobs show JOB_ID` with the same data
directory. Do not repeat an uncertain send or grant operation. Recovery fences
remain until the operation can be reconciled; restarting does not erase them.

## Check on it from the terminal

TextButler has no window or menu bar icon. The background service keeps working
after you close the terminal, and you check on it with:

```sh
bun run textbutler status
bun run textbutler inbox
bun run textbutler pause
```

`status` shows whether the service is running, whether replies are paused and
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
response mode, enable that contact, then resume. If you use a subscription
through xcb, also select its account for the contact. These are separate
choices. The readiness view must show actual engine and transport
availability; successful setup alone is insufficient.

```sh
bun run textbutler contacts account CONTACT ACCOUNT
bun run textbutler contacts mode CONTACT keyword --keyword butler
bun run textbutler contacts enable CONTACT
bun run textbutler resume
```

`pause` stops automatic replies globally. `contacts disable CONTACT` also revokes
that contact's grant. Owner-confirmed replies remain a separate explicit action
while automatic replies are paused.

Your Mac must be awake and signed in. Begin with one conversation and confirm
behavior on an agreed test recipient before relying on automation. See
[agent setup](../../packages/textbutler/PROVIDERS.md) for the current engine
qualification requirements.
