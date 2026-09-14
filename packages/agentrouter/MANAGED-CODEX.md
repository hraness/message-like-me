# Managed Codex accounts

The managed account controller connects owner account controls to Codex's
ChatGPT sign-in flow. It keeps account authentication separate from permission
to run an agent. A signed-in account never qualifies an execution adapter.

The implementation follows the supported
[Codex app-server account protocol](https://learn.chatgpt.com/docs/app-server#authentication).
Codex owns credential persistence and refresh in a private host account home.
The controller accepts browser and device-code sign-in; it has no API-key,
external-token, credential-export, thread, turn or arbitrary RPC operation.

## Connect a trusted process

Create a controller with `createManagedCodexAccountController()` and supply an
account ID, owner ID, process generation, shared `AccountLeaseStore` and
`transportFactory`. The factory receives an immutable account/lease/process
binding plus a notification callback. It must return a custody handle before
starting asynchronous work so that a failed launch can still be joined.

`createCodexAccountStdioTransport()` implements initialization, framed requests,
account notifications and shutdown over `CodexAccountProcessPort`. The host
supplies this process port; importing Agentrouter does not discover or launch
an installed Codex binary. The protocol exposes only `account/read`, managed
`account/login/start`, `account/login/cancel`, `account/logout` and `model/list`.
Unexpected server requests are refused; the transport cannot start a model turn.
The startup remote-control notification is accepted only when its status is
`disabled`. Remote identity fields are validated and discarded; another status
stops the account transport.

The host still owns runtime admission, the native launcher, private account
storage, configuration isolation, process journaling and crash recovery. Keep
account state outside every contact folder and do not inherit the owner's
normal CLI configuration or executable plugins. An injected port is trusted
code, not an owner-JSON setting or an agent tool.

## Offline native process helper

`createCodexAccountProcess()` in `src/codex-account-process.ts` supplies a macOS
process port for offline account-protocol checks. The caller provides an admitted
executable, its expected hash and version, a schema digest, a parent-runtime hash,
and an owner-private state directory. The helper verifies executable and parent
runtime hashes and records the caller-admitted version and schema digest. These
inputs do not establish provenance or execution qualification.

The helper copies the checked executable into an immutable run snapshot and uses
fixed app-server arguments, configuration and environment. Network access, process
forks and remote control are disabled. This mode cannot complete OAuth sign-in.
An exclusive account lock precedes account-home writes. The persistent account
home stays outside the run's temporary HOME and working directory and survives
shutdown; the helper does not inspect or export credentials.

The version-one `config.toml` baseline is shared by account helpers and managed
tasks. Its SHA-256 is
`9833be747176d26b0915621439e2cbea1bff12aeca6f7854e45265777bb98ae8`.
`codexManagedAccountConfiguration()` is the pure source of those bytes;
`codexAccountOfflineConfiguration()` remains a compatibility alias. No migration
or per-task file rewrite is required. An existing file with different bytes is
refused and preserved for explicit recovery.

A private journal records launch intent before spawning and retains process and
stream cleanup evidence. Failed cleanup keeps the account lock and recovery state.
An expired lease or stale lock does not authorize a replacement process. The
helper is not registered with Textbutler's default host and does not enable replies.
Filesystem cleanup can finish after the requested wait deadline. The transport
retains and joins that work before releasing account custody.

## Device-code process candidate

The helper also accepts explicit `mode: "device-code"` with a trusted
`deviceCodeAdmission` bound to the native executable, schema and parent-runtime
hashes. Its `codex-account-device-code-tcp443-dns-v1` profile adds the system
resolver socket and outbound TCP port 443 to the offline profile. It adds no
listener, browser helper, process forks, Keychain access or filesystem roots.
This is general TCP 443 access; it does not enforce TLS or a hostname allowlist.
The native client remains responsible for TLS authentication.

The separately selected `codex-account-device-code-tcp443-dns-v2` candidate
preserves every v1 byte and appends only
`(allow file-read-metadata (literal "/var"))`. This permits metadata access to
the system resolver's `/var` symlink; it adds no file-content access, socket
destination, Mach service or executable. V1 admission never upgrades to v2.
Receipts retain the v1 schema and existing v1 network label; v2 records
`tcp443-system-resolver-var-metadata-candidate` with its exact profile digest.
The fixed persistent configuration and offline task profile remain unchanged.

A bounded libc DNS-only diagnostic with this exact delta resolved the fixed
authentication hostname on the tested Mac and proved process cleanup. That
result may use the resolver cache. It establishes neither native Codex TLS
compatibility nor device-code sign-in, authentication or model execution.
Both profile variants remain candidates with `productionQualified: false`.

`createManagedCodexAccountFactory()` in Textbutler's `managed-codex.ts` composes
the controller, stdio transport and process helper. Its admission inputs come
from trusted host code, never owner JSON or contact files, and preserve the
explicitly selected v1 or v2 profile. It accepts device-code
sign-in only and creates a fresh process generation for each controller.
Account storage remains under the private host state directory. Importing or
constructing the factory does not launch Codex or inspect existing credentials.

Profile admission and successful sign-in do not qualify model execution. The
candidate remains absent from the bundled default host until distribution and
native account-flow evidence are admitted separately.

## Drive owner controls

- `snapshot()` returns account state, generations and discovered model metadata.
  It omits email, credentials, sign-in URLs and device codes.
- `check()` reads account status without requesting token refresh. Only a
  ChatGPT account requiring OpenAI authentication can become `signed-in`.
  Model discovery uses bounded pagination and preserves observed effort and
  service-tier choices. It establishes neither prices nor execution readiness.
- `startLogin("chatgpt")` returns a browser challenge;
  `startLogin("chatgptDeviceCode")` returns an address and one-time code.
  Show this result only to the owner and keep it in temporary view memory.
- `cancelLogin(loginId)` is bound to the exact pending attempt. `logout()`
  signs out the selected account; it cannot select another billing route.
- `close()` stops and joins the transport. Inspect its `released` result.

Notifications invalidate cached account/model state synchronously. A late result
from an earlier account or process generation cannot restore readiness.
Concurrent operations return busy; aborted work remains under custody until
it settles. A notification racing with an account mutation can invalidate its
reply; use a fresh `check()` to reconcile the resulting state.

An interrupted or failed dispatched login can leave native polling active even
when its challenge was never returned. The controller marks that outcome as
`recovery-required`, ignores later account events and blocks another attempt.
The host closes and joins that exact controller before making a fresh one
available. It preserves the original error and never replays the login request.
Incomplete cleanup retains the old controller and account lease for recovery.

The exclusive account lease survives uncertain factory, process and cleanup
failures. It is released only after the exact bound process, process group,
streams, writes, requests and notifications are joined. Lease expiry alone
does not authorize reuse. An account-control process must finish that handoff
before a separately admitted task process can reuse the account.

## Textbutler integration and current limits

Textbutler's `createProviderHost()` and `startDaemon()` accept an optional trusted
`managedCodex` factory. The factory is called only for an explicit owner account
operation. When supplied, the local control protocol and Mac account panel expose
sign-in, cancellation, sign-out and checks. The panel shows authentication state
and reply availability separately. Challenges are not stored in contact files,
settings or activity. The bundled default host currently supplies no managed
native process factory, so these controls are absent from its account rows.

Synthetic tests cover the controller, stdio protocol and owner controls. They
do not establish successful live sign-in or contact-scoped native execution.
The credential-free Codex task process uses a loopback model relay. The separate
`createCodexManagedTaskAdapter()` supports managed subscription tasks through
the built-in provider, but still requires a host launcher and current execution
qualification. Neither task adapter is enabled by account sign-in. The account
protocol supplies no inference proxy or token-export bridge between them.

Managed task settings are applied in memory to a fresh ephemeral thread. The
selected model, service tier, base instructions and developer instructions use
dedicated `thread/start` fields. The pinned protocol has no dedicated thread
effort field, so `codexManagedThreadConfiguration()` supplies a non-null effort
as `config.model_reasoning_effort`. This closed host-generated overlay also
disables the union of account and task feature flags, including remote control,
and disables the plan and user-input tools. It accepts no arbitrary configuration
from callers. Explicit effort and tier selections are repeated in `turn/start`;
null selections leave native defaults intact and the receipt records what the
thread actually reported.

The earlier `config/read` check covers only the public baseline projection. It
can report defaults that differ from the task, and cannot attest to a thread
overlay that has not yet been applied. Exact model and non-null effort/tier
selections are checked against `ThreadStartResponse` before any task turn.
Configuration and thread readback do not establish the effective tool inventory,
authenticated execution or OS confinement. This correction keeps the managed
task route unqualified and requires no native or provider calls.

Before a trusted host admits a native process, it must bind the executable and
generated experimental schema to a `CodexProtocolManifest` using
`assertCodexProtocolManifest()`. The manifest carries the protocol and source
versions plus executable, schema and manifest digests. A caller-supplied hash
alone is not admission evidence; mismatched runtime identity fails before
initialization.
