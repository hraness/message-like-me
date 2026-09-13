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

A private journal records launch intent before spawning and retains process and
stream cleanup evidence. Failed cleanup keeps the account lock and recovery state.
An expired lease or stale lock does not authorize a replacement process. The
helper is not registered with Textbutler's default host and does not enable replies.
Filesystem cleanup can finish after the requested wait deadline. The transport
retains and joins that work before releasing account custody.

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
