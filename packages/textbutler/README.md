# Textbutler runtime

This source package contains the macOS message-butler foundation. The owner
selects contacts and a coding-agent provider. Trusted runtime code admits
replies, isolates contact memory, adds disclosure, and journals outward intent.

The current Ghostget adapter does not provide durable contact bindings,
incoming subscriptions, or delegated unattended sends. Both bundled Agentrouter
provider adapters remain unqualified. The daemon therefore exposes real local
settings and memory control, but does not run a live autoreply loop. This is
source under development, not an installable signed Mac release.

## Modules

- `config.ts`: strict contact settings, smart-mode defaults, activation limits,
  and the `🤖{ … }` disclosure formatter.
- `decision.ts`: keyword matching, debounce, owner cooldown, stale-state
  rejection, rate limits, and classifier admission.
- `workspace.ts`: private bounded contact files, exact edits, conditional
  atomic writes, and attributed context-only history bootstrap.
- `hooks.ts`: versioned owner-installed lifecycle hooks with veto and timeout.
- `journal.ts`: persisted run claims and send states. An uncertain dispatch is
  quarantined, never retried automatically.
- `runtime.ts`: compose, validate, recheck, prepare, journal, and submit through
  qualified injected ports. No model-facing tool dispatches during composition.
- `routed-agent.ts`: the concrete Agentrouter consumer, with separate tool-free
  classification and contact-bound composition. Provider qualification still
  applies at the router's execution boundary.
- `control-service.ts`, `daemon.ts`, and `cli.ts`: owner-only versioned Mac
  control and foreground daemon service.

## Run from source

From the repository root, install the pinned dependencies and inspect status:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run textbutler doctor
```

Use `bun run textbutler --help` for the current command syntax. Daemon execution
stays in the foreground; closing its terminal stops that process. No launchd
service, provider permissions, or login startup is installed automatically.

See [the architecture](../../docs/textbutler/architecture.md) for the complete
folder contract, intended launchd lifecycle, rich action rules, provider seam,
and remaining live acceptance criteria.

## Write a hook

Extensions are trusted owner-installed application code. Register them when
constructing the runtime and pass the resulting `Hooks` instance as its `hooks`
port. This example vetoes a response during fixed UTC quiet hours:

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

The current API offers lifecycle observation and vetoes. It does not yet load
extension files from disk or supply an untrusted plugin sandbox. Keep executable
extensions outside contact folders. An agent can evolve `AGENTS.md`, `MEMORY.md`,
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
