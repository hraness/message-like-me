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

`createClaudeSdkAdapter()` implements the pinned Claude Agent SDK subprocess
protocol with API-key authentication. Its execution gate requires a trusted host
qualification for the exact native executable and SDK digest. No production
qualification receipt is bundled. The default provider adapters continue to refuse
execution. `createProviderLaunchPlan()` is descriptive configuration, not a sandbox.

The installed versions are Claude Agent SDK **0.3.268**, bundled native Claude Code
**2.1.268**, Anthropic SDK **0.125.0**, MCP SDK **1.30.0**, and Zod **4.6.2**.
`inspectClaudeSdkRuntime()` checks the installed SDK version, native binary owner,
mode, link count and SHA-256, and returns the composite qualification identity.
Every run verifies and copies executable bytes from a checked file descriptor into
its private run directory before resolving credentials. The subprocess runs that
snapshot, so replacing the configured source path cannot replace the admitted
credential-bearing executable.

The adapter creates separate private working, home, configuration and temporary
directories outside contact memory. It supplies an explicit environment, removes
all built-in tools, disables inherited settings, hooks, automatic memory, connectors,
plugins, bundled skills, workflow triggers and persistence, and configures only its in-process MCP broker. It checks the
native initialization model, version, tools, MCP servers, skills, plugins and API-key
source before admitting broker calls. A fixed plain-text prompt header prevents task text from entering native slash or bang command dispatch. Classification has no tools. The contact
folder is accessed only by host broker methods; it is never the native process cwd.

Native processes use a detached process group. Raw stdout is bounded to 1 MiB per
frame and 8 MiB total before SDK parsing; stderr is discarded and capped at 256 KiB.
Cancellation terminates the group, escalates to kill if needed, and waits for root
exit and group absence before releasing account custody. A joined failure uses
`AgentStoppedError`; an unproven exit keeps its lease and private state. These
controls do not prove confinement of a malicious native process or a descendant
that escapes its process group. Runtime qualification must cover the trusted
executable, host policy and relevant descendant behavior independently.

The host can bind an account to one explicit environment variable:

```ts
const credentials = createEnvironmentClaudeApiKeyResolver({
  "owner-api-account": "TEXTBUTLER_ANTHROPIC_API_KEY",
});
const adapter = createClaudeSdkAdapter({
  runtime: { executablePath: pinnedNativePath, executableSha256: reviewedBinarySha256 },
  stateRoot: privateProviderStateDirectory,
  credentials,
  qualification: independentlyVerifiedHostQualification,
});
```

Those paths, digest and qualification are host inputs, never contact or plugin
configuration. The resolver reads only the selected variable at invocation time;
it does not discover personal accounts, parse dotenv files, use ambient provider
keys, or borrow subscription tokens. It admits the pinned API-key format and
rejects OAuth tokens. A host Keychain integration can implement the same
`ClaudeApiKeyResolver.withApiKey()` interface without changing the broker. API keys
must remain outside contact folders, settings responses and logs. The adapter's
per-run default budget is $0.25 and deadline is 120 seconds; neither is a claim of
account-wide spend control.

`test/claude-sdk.test.ts` runs the real SDK against synthetic subprocess peers to
verify option isolation, MCP routing, zero-tool classification, output validation,
revocation and process custody. `test/provider-process.test.ts` also proves
termination of a surviving process-group descendant and raw output bounds. On
2026-09-11 the actual macOS ARM64 native CLI completed a separate control
initialization with a fresh synthetic home and no user message: the configuration
was accepted and the MCP inventory was empty. That control response contains no
built-in tool inventory and is insufficient for execution qualification.
`qualification/claude-native.ts` is the explicit adversarial native fixture with a
local synthetic Anthropic endpoint and temporary contact folders. It uses the same
restricted launch-option builder as production; the production adapter does not
accept custom API endpoints. Its receipt describes the exact fixture/runtime
boundary and never automatically enables production.

Codex execution remains unavailable. A credential-free probe of installed Codex
**0.153.4** found default-on `code_mode_host`, shell, browser, computer, image,
plugins, hooks and workspace dependency capabilities. Disabling the old `js_repl`
flag does not remove current code execution. App-server dynamic tools are additive,
and `thread/start` exposes no complete effective tool inventory. Reusing Oompa's
transport or login implementation would therefore not establish Textbutler's
required scope. See the [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [App Server documentation](https://learn.chatgpt.com/docs/app-server).

The [Claude custom-tools documentation](https://code.claude.com/docs/en/agent-sdk/custom-tools)
documents selecting built-ins with `tools`; `tools: []` removes that surface.
The [permissions documentation](https://code.claude.com/docs/en/agent-sdk/permissions)
explains why `allowedTools` alone only pre-approves calls. A production qualification
must also establish that managed host policy has not introduced configuration,
hooks or other authority that cannot be disabled by application settings.

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
