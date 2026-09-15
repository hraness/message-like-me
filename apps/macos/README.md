# Textbutler menu-bar companion

Textbutler has an unbundled native macOS status-item companion for its CLI. Launch and login installation are explicit owner actions.
The companion is a small, menu-only shell: it reads the owner-only
`textbutler.control.v1` socket, shows daemon and contact state, account readiness,
capabilities and eight recent activities, and dispatches only versioned
pause/resume actions. A checkmark beside “Automatic replies paused” shows the
confirmed pause setting. Checkmarks in the read-only contact, account and
capability submenus show enablement or readiness. It never holds provider credentials or
starts a daemon itself.

This directory contains the Swift source and explicit build, test and run helper.
There is no desktop window, app bundle, signing or notarization workflow.
`menubar install` copies an explicitly selected prebuilt binary to a private
per-user location and installs its separate login service.

Build the companion explicitly on macOS:

```sh
bun run --cwd apps/macos menubar:build
```

Run the prebuilt binary in the foreground:

```sh
bun run --cwd apps/macos menubar
```

For source-checkout login startup, select the physical absolute path to the
binary you just built and install it explicitly:

```sh
TEXTBUTLER_MENUBAR_DEV_BINARY=/absolute/checkout/apps/macos/out/textbutler-menubar bun run textbutler menubar install
bun run textbutler menubar status
bun run textbutler menubar uninstall
```

The Textbutler CLI and companion are not yet a published package. Launching never builds source. The companion uses
a per-user singleton lock, validates the private daemon socket before every
request, checks the connected peer's user identity, and enforces one four-second
deadline across connection, writes and reads. Its physical data directory must
be owned by the current user and private; the socket must have mode `0600`.
Requests protect against `SIGPIPE`, bound newline-inclusive frames to 1 MiB,
and close their descriptor on every outcome.

To upgrade a login companion, first run `bun run textbutler menubar uninstall`,
then install the newly built binary with the explicit path above. This stops
only the owned menu service before replacing its executable. An already running
foreground companion must be quit before launching the replacement; replacing
binary bytes alone does not update a running process.

Menu-open and periodic refreshes share one worker and at most one pending
refresh. Pause/resume uses the current settings revision, cannot overlap another
operation, and is never retried after an uncertain outcome. Instead the menu
reads the authoritative state again. Last-confirmed freshness remains visible
when the daemon cannot be reached, and stale state cannot enable a mutation.
Labels and tooltips are bounded and strip control characters and bidi overrides.
The website action opens `textbutler.app`; it does not claim to open local settings.

Run the native synthetic protocol tests explicitly on macOS:

```sh
bun run --cwd apps/macos menubar:test
```

These compile the same control client used by the menu and exercise private
fixture sockets in a private temporary directory, including malformed responses, size
boundaries, unsafe paths, a slow peer, mutation framing and refresh coalescing.
They never connect to the installed daemon. CI runs them alongside the native
build. Both commands use a fresh Swift module cache, removed after completion.
On a managed Hraness host, run these native commands through the installed
`oompa-host-run` mac-native lane.

The optional `--data-dir` argument selects the same physical private daemon
directory for both foreground and login launches. Uninstalling the menu login
service preserves daemon settings and contact data. The companion never starts
or restarts the messaging daemon.
