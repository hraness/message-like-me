# Textbutler runtime

This source package contains the macOS message-butler foundation. The owner
selects contacts and a coding-agent provider. Trusted runtime code admits
replies, isolates contact memory, adds disclosure, and journals outward intent.

The current Ghostget surface supports owner-selected read-only conversation
bindings and bounded history initialization. It does not provide incoming
subscriptions or delegated unattended sends. The daemon therefore exposes real
contact setup, settings and memory control, but does not run a live autoreply
loop. This is source under development, not a signed Mac release.

## Modules

- `config.ts`: strict contact settings, smart-mode defaults, activation limits,
  and the `🤖{ … }` disclosure formatter.
- `decision.ts`: keyword matching, debounce, owner cooldown, stale-state
  rejection, rate limits, and classifier admission.
- `workspace.ts`: private bounded contact files, exact edits, conditional
  atomic writes, and attributed context-only history bootstrap.
- `hooks.ts` and `plugins.ts`: versioned owner-installed lifecycle hooks with
  veto and timeout, loaded from an explicit private owner manifest.
- `journal.ts`: persisted run claims and send states. An uncertain dispatch is
  quarantined, never retried automatically.
- `runtime.ts`: compose, validate, recheck, prepare, journal, and submit through
  qualified injected ports. No model-facing tool dispatches during composition.
- `routed-agent.ts`: the concrete Agentrouter consumer, with separate tool-free
  classification and contact-bound composition. Provider qualification still
  applies at the router's execution boundary.
- `enrollment.ts` and `ghostget-owner-read.ts`: explicit owner conversation
  selection, account/participant binding, and bounded context-only history.
- `host-config.ts`: private owner configuration of the installed Ghostget CLI;
  no account or message reads occur just by loading configuration.
- `control-service.ts`, `daemon.ts`, and `cli.ts`: owner-only versioned Mac
  control and foreground daemon service, including bounded asynchronous read jobs.
- `launch-agent.ts`: explicit per-user background-service install, status and
  uninstall, with exact artifact and loaded-service identity checks.

## Run from source

From the repository root, install the pinned dependencies and inspect status:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run textbutler doctor
```

Use `bun run textbutler --help` for the current command syntax. For foreground
development, run `bun run textbutler daemon run`; closing that terminal stops
the process. For an explicitly installed background service:

```sh
bun run textbutler daemon install
bun run textbutler daemon status
bun run textbutler daemon uninstall
```

Installation registers `app.textbutler.daemon` in the current Mac user's
graphical login session. It records the exact Bun executable, source entrypoint
and data directory. Keep that source checkout in place while installed; uninstall
before moving it or changing its launch identity. Uninstall retains contact
memory, settings and activity. New settings start paused; existing settings
are preserved. `daemon status` reports installation and control-socket health
separately. An unknown or changed service is never removed by name alone.

## Select a conversation

Initialize the data directory with `bun run textbutler init`. Configure an
existing Ghostget installation and its explicitly selected iMessage account in
the mode-`0600` file `state/host.json` under the Textbutler data directory:

```json
{
  "schemaVersion": 1,
  "ghostget": {
    "executable": "/opt/ghostget/src/cli.ts",
    "runtimeExecutable": "/opt/bin/bun",
    "authId": "your-imessage-account-id"
  }
}
```

Replace the example paths with the actual physical installed paths. Omit
`runtimeExecutable` when `executable` is the standalone Ghostget executable.
An optional absolute `stateHome` selects Ghostget's configured state directory.
No shell command, arbitrary arguments or environment fields are accepted.
This configuration does not create an account or grant Messages permissions;
complete that setup in Ghostget. Restart Textbutler after editing host settings.

In the Mac app, choose **Add contact…** to request up to 200 recent Messages
conversations. The picker distinguishes direct conversations from unsupported
groups. Select one person and optionally check **Initialize from recent
history**. Enrollment rechecks the account incarnation and participant identity,
creates a disabled contact, and imports at most 200 recent text messages only
when requested. The result records shortening and omissions. Attachments are
not imported. The native Contacts directory remains unavailable through the
current Ghostget contract.

Long reads use bounded owner jobs; the global Pause button remains available.
Bun source launches disable automatic `.env` loading. A cancelled Ghostget CLI
receives 36 seconds for its documented cleanup and persistence envelope before
forced termination. Each invocation first claims the private
`state/ghostget-read-custody.json` marker. Uncertain, signalled, failed or malformed
outcomes preserve it; restarting the daemon does not clear the fence. Recovery
requires owner inspection of the exact configuration digest and operation record,
plus reconciliation of Ghostget's corresponding cleanup state. Do not delete the
marker or run broad provider recovery merely to unblock a retry. The application
does not automatically invoke Ghostget recovery or infer descendant cleanup from
the immediate parent process exiting.
Enabling a selected conversation rechecks its binding. Provider reads and
enrollment never send messages or initialize a live autoreply loop.

See [the architecture](../../docs/textbutler/architecture.md) for the complete
folder contract, background lifecycle, rich action rules, provider seam,
and remaining live acceptance criteria.

## Write a hook

Extensions are trusted owner-installed application code. The daemon loads only
files listed in `plugins/extensions.json` under its private data directory.
The directory must have mode `0700`, and the manifest and entry files must have
mode `0600`, with no symlinks or hardlinks. Creating a contact or editing its
memory never installs a plugin. For example:

```json
{
  "schemaVersion": 1,
  "extensions": [
    { "id": "quiet-hours", "version": "1.0.0", "entry": "quiet-hours.ts" }
  ]
}
```

Copy `examples/quiet-hours.ts` into that plugin directory, adjust its fixed UTC
hours, and restart the daemon process. Its default export supplies the matching
ID, version and hooks. The manifest order determines execution order. Unlisted
files are never imported. Changes require a full process restart, preserving
the active run's hook collection. An invalid manifest or module stops startup.

Code integrations can register extensions directly instead. Pass the same
`Hooks` instance to the runtime and routed agent to observe committed memory
edits as well as response lifecycle events:

```ts
import { Hooks } from "./packages/textbutler/src/index.ts";

const hooks = new Hooks();
hooks.register({
  id: "quiet-hours",
  version: "1.0.0",
  hooks: {
    "reply.before-send": async ({ signal }) => {
      signal.throwIfAborted();
      const hour = new Date().getUTCHours();
      if (hour < 8 || hour >= 22) return { veto: true, note: "Quiet hours" };
    },
  },
});
```

The API offers lifecycle observation and vetoes. `memory.updated` includes the
changed file path and committed revision; notification failure cannot undo a
committed write. Modules and their imports run with the daemon's full authority;
this is not an untrusted plugin sandbox. Keep executable extensions outside
contact folders. An agent can evolve `AGENTS.md`, `MEMORY.md`,
and the other workspace context files; those edits never install executable
hooks or change activation, account, recipient, or send authority.

## Verify

```sh
bun test packages/textbutler
bun x --no-install tsc --noEmit -p packages/textbutler/tsconfig.json
```

Tests use synthetic contacts and injected transport/provider implementations.
They exercise human takeover, duplicate events, disclosure, conflicting memory
edits, links, admission failures, and uncertain sends without contacting people.
