# AI subscriptions through xcb

TextButler can draft replies with your Claude Code, Codex, or Devin subscription
through [Excalibur (xcb)](https://github.com/hraness/xcb). xcb handles provider
sign-in, decides which provider runtimes may run, confines them with
operating-system controls, and locks each account while a provider uses it.
TextButler keeps contact context, decides when to respond, and sends every
message. TextButler is an MIT-licensed reference application for this split.

The connection needs two things: a verified local TextButler build, whose build
step checks a reviewed record of its source, and an xcb build with the native
`generate` command. A daemon started from source has no such check built in, so
it never uses a subscription. A configured path, a matching executable hash, or
a signed-in account doesn't mean the connection is ready. Check the provider
through TextButler and verify the selected messaging account before turning on
replies. Tests with simulated providers don't show that live inference,
delivery, or unattended operation works on another installation.

## Connect an account

Install xcb and connect the subscription account with its
[native setup guide](https://github.com/hraness/xcb#native-xcb). xcb keeps its own
private state; the native default is `~/.local/share/xcb`. Copy the exact account
ID and full model key that `xcb accounts` and `xcb models` show.

Build and install TextButler with `bun run textbutler:install`, and start its
daemon through the installed command for AI replies. The build refuses to
continue if the reviewed record is missing or doesn't match the source, and
starting from source can't skip that check.

Stop the TextButler daemon before changing host configuration. Use physical
absolute paths, and replace the example account and model with the values xcb
showed you:

```sh
bun run textbutler setup \
  --xcb /absolute/path/to/xcb \
  --xcb-state /absolute/path/to/xcb-state \
  --xcb-account claude:ACCOUNT_ID \
  --xcb-model FULL_MODEL_KEY
```

To add a Codex or Devin account, repeat setup with
`--xcb-account codex:ACCOUNT_ID` or `--xcb-account devin:ACCOUNT_ID` and the
matching full model key. You can connect one account per provider. Setup
records the xcb executable's SHA-256 and the account and model you chose. It
doesn't copy subscription credentials, sign in to a provider, or turn on a
contact.

Restart the installed daemon, run `providers list`, and pass the returned
TextButler account ID to `providers check ACCOUNT_ID`. The check reads xcb's
current capabilities and whether it allows the provider to run. It doesn't make
a model call or say anything about reply quality; asking for an unsent
suggestion is the next test.

Setup keeps existing bindings and refuses a changed executable, hash, state
directory, account, or model. After upgrading xcb, stop the daemon and review
the xcb binding in the private `state/host.json` before updating its executable
digest. Keep the existing account and account-lock state, then restart and
check the account again.

A subscription route never falls back to the Claude API or another account. A
route that is unavailable, busy, out of date, or waiting on an unfinished run
stays unavailable until that specific problem is fixed. See
[getting started](getting-started.md) for choosing contacts, reviewing replies,
and turning replies on.

## What xcb runs

Each inference step starts the pinned native `xcb generate` process with a
size-limited JSON request on stdin. Private prompt content never goes into
command arguments. This command gives the provider no tools, workspace access,
inherited coding session, or executable hooks. TextButler never calls
`xcb run`, which is xcb's workspace coding interface.

The model returns a final JSON result or a proposal naming one TextButler
operation it was offered. The contact's broker validates each proposal and
performs only allowed operations: conditional edits to contact memory, limited
public web reads, and reply actions held for sending. Classification offers no
operations. The provider can't choose another contact, file location,
recipient, or credential.

The next step contains only the operation history TextButler supplies. A run
allows at most 16 steps, 12 operations, 512 KiB of prompt, 256 KiB per step, and
1 MiB of transcript, and stops when it exceeds any of them. Failed operations
are never replayed, because their effect may already have happened.

A proposed message never sends itself. Immediately before sending, trusted
TextButler code applies disclosure, checks whether the owner has taken over,
checks the current enrollment and whether the send was reviewed or automation
is allowed, applies idempotency, and records the send in the durable journal.

## Account locks and recovery

xcb keeps subscription credentials and provider state outside TextButler's
contact folders. It lets only one run use an account at a time, and releases
the account only after the provider process and its controllers have fully
exited. TextButler checks the result and xcb's confirmation that the run
finished before accepting any output. Cancelling a request, or seeing the xcb
parent process exit, doesn't prove the provider cleaned up.

TextButler also keeps a record of any call whose outcome is uncertain, for
recovery. Restarting, reinstalling, or repeating setup must not clear that
record. Inspect the xcb run and TextButler's diagnostic before recovering, and
never delete lock state just to make the account look ready.

## What the build checks

The local TextButler bundle contains its application code and pinned library
dependencies. Its build checks a separately reviewed record against the exact
list of source files and both contact permission profiles, then embeds that
approval. A missing record, or any change to the source or profiles, stops the
build; hashes and an xcb sign-in can't stand in for the review. xcb and the
provider executables are installed separately. The bundle's `external-xcb`
manifest value says that it can use this connection. It doesn't mean a provider
passed its checks, that the build is a signed release, or that live messaging
was tested.

xcb checks the selected provider's exact runtime and confinement on every call.
Which providers are ready can differ by build and machine; see the
[xcb readiness table](https://github.com/hraness/xcb#readiness). TextButler
must also show that its classifier and reply parsing, cancellation, and broker
limits work. Before relying on automatic replies, test with one recipient who
has agreed: pausing, the owner taking over, losing the transport, restarting,
and a grant expiring. The [readiness page](readiness.md) separates these live
checks from source tests. The separately billed Claude API route still needs
its own review of the trusted runtime; see
[provider setup](../../packages/textbutler/PROVIDERS.md).
