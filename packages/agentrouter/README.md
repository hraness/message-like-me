# Agentrouter

Agentrouter is a provider-neutral foundation for applications that give an agent
a small, explicit tool surface. This first consumer is Textbutler. The package is
private while its public contract and provider qualification are being developed.

It provides:

- A Codex/Claude adapter interface with explicit runtime qualification.
- Shared SQLite account custody, generation fencing and process-aware recovery.
- A tool broker bound to one workspace and run, with closed file, public-web and
  messaging operations. There is no shell, executable or arbitrary RPC operation.
- Strict classifier output validation and selection from a fresh, host-observed
  model catalog. The cost comparison uses a 2,000-input / 128-output-token request.

`src/index.ts` exports the complete current interface. `createPublicWeb()` provides bounded public HTTPS GETs with address pinning, redirect checks, no ambient authentication, a 15-second deadline, and a 256 KiB maximum text response. Run `bun test
packages/agentrouter` from the repository root.

## Provider execution status

**Both bundled provider adapters are unqualified and refuse execution.**
`createProviderLaunchPlan` describes configuration intent; it does not spawn a
provider or establish a sandbox. Real Codex/Claude subprocess adapters and account
sign-in are not implemented in this package yet. The library never converts a successful model
response, working directory, permission prompt or tool list into an isolation claim.

A production adapter must independently prove the exact runtime binary and its
effective tool inventory, configuration isolation, contact read and write
confinement, and the separation of authentication from model-readable files. The
trusted host owns those qualification records. They must not come from messages,
plugins, contact files or model output. No bundled qualification receipt exists.

The [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents `features.shell_tool`, but disabling that setting alone does not prove
that every command-capable route is absent. The
[App Server documentation](https://learn.chatgpt.com/docs/app-server) marks dynamic
tool calls as experimental. An adapter must pin and test their exact wire contract.

The [Claude custom-tools documentation](https://code.claude.com/docs/en/agent-sdk/custom-tools)
documents selecting built-ins with `tools`; `tools: []` is the intended starting
point for an MCP-only broker. The
[permissions documentation](https://code.claude.com/docs/en/agent-sdk/permissions)
explains that `allowedTools` alone only pre-approves calls. An unlisted tool is not
necessarily disabled. Use the exact broker manifest and a deny-by-default policy,
with no inherited settings, skills or plugins, then qualify the effective result.

## Ownership boundaries

The application owns its daemon, contact enrollment, message classification policy,
conversation history, memory format, prefix formatting and Ghostget/Linq access.
Agentrouter owns the execution seam. The model cannot choose a workspace or contact
in broker input. `WorkspaceFiles` and `PublicWeb` are trusted host ports. Textbutler supplies its confined file implementation and uses `createPublicWeb()` by default. Custom replacements must preserve file confinement and public-network policy across DNS and every redirect. URL syntax validation alone is insufficient. The supplied web client admits public unicast addresses, rejects mixed public/private DNS answers, pins the selected address while preserving TLS hostname verification, and validates each redirect anew. It fetches bounded UTF-8 text only; it does not carry account cookies or authorization headers.

Messaging ports only stage proposed actions and return an intent ID. They must never
submit a message during composition. The application must recheck current enrollment, exact recipient/message ownership,
capability support, idempotency and authorization at its final dispatch boundary.
It must add the configured butler envelope itself. Arbitrary rich payloads,
stickers and mini apps are not admitted until a transport contract proves support.

The web client refuses ambient proxy environment variables because Bun can route
HTTPS through them despite a disabled connection pool. Its 16 KiB header limit
applies to accepted headers; Bun buffers headers before that check. The local TLS
fixture proves address pinning and certificate/hostname enforcement under Bun
1.3.14. A bounded live GET to `https://example.com/` also passed on 2026-09-11
(559 bytes with the expected page title). Tests generate their own temporary
certificate with OpenSSL and remove it afterward.

Accounts are opaque host bindings. Keep provider authentication and native runtime
state out of contact folders. Do not copy credentials into a second app or let a
contact edit provider configuration. One shared lease database can coordinate
applications only when all of them use its custody contract; this package does
not alter an existing application's running sessions or account authority.

Lease expiry indicates a missed heartbeat and never authorizes takeover. A failed
or ambiguous adapter call retains its lease. Recovery needs independent proof that
the old process/controller stopped, followed by an exact generation-conditional
release. `AbortSignal` alone does not prove process exit. A successful adapter result
must assert `processStopped: true` only after obtaining that evidence.

The current AI Charts CLI collects usage and does not execute agents, so its likely
future shared interface is sanitized usage/account metadata, not this execution
port. Account sign-in and product-provider terms need separate qualification;
[Anthropic's SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) directs
third-party product integrations to supported API authentication unless approved.
