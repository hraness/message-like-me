# Textbutler macOS distribution

The initial desktop target is Apple Silicon on macOS14.5 or newer. The app
contains the native control panel, a compiled Textbutler CLI, and Bun1.3.14.
It does not contain Ghostget, Claude Code, owner credentials, or private state.
Opening the app does not install a service. The owner explicitly starts the
background service after moving the app to `/Applications` or their own
`Applications` folder. New settings start paused; existing settings and contact
memory are preserved. Installation does not qualify or activate message sending.

This directory prepares an independent desktop artifact. It does not invoke the
legacy `v*` package release or advance the website production ref. The intended
desktop coordinate is `desktop-v0.1.2-macos-arm64`, with assets
`Textbutler-0.1.2-macos-arm64.zip`, `desktop-manifest.json`, `SHA256SUMS`, and
GitHub artifact provenance. A source build or ad hoc signature is not a signed
release. Do not advertise a download until its verified publication exists.

## Build and inspect without Apple credentials

Use the repository's host scheduler mac-native lane for these commands, with
Bun1.3.14 and the locked Cargo dependencies. Install the root dependencies with
`bun install --frozen-lockfile --ignore-scripts` first.

```sh
bun run --cwd apps/macos native:package
bun run --cwd apps/macos native:smoke
cargo test --manifest-path apps/macos/src-tauri/Cargo.toml --locked
```

The local app is written under
`apps/macos/src-tauri/target/release/bundle/macos/Textbutler.app`. The package
script excludes Apple credentials from build children and explicitly requests
an unsigned bundle. Its final ad hoc outer seal preserves the nested Bun bytes;
it is only for local validation. It is not notarized or Gatekeeper-qualified.
The compiled dependency graph must exclude the separately qualified native
Claude SDK. The API adapter uses direct module imports; whitespace-only
minification omits Bun's source-location comments while the portable-path guard
remains in force. Runtime attribution files are retained separately.

The smoke check runs the actual copied Bun and compiled CLI in an isolated
synthetic home. It verifies supported `--no-env-file`/`--no-install` flags,
relocated lifecycle entrypoint, JIT, SQLite, system FFI, paused empty daemon,
socket response, and joined shutdown. It does not call launchctl, authenticate a
provider, read private conversations, invoke a model, or send a message. Actual
LaunchAgent and live-provider qualifications are separate evidence.

The native webview has a separate `textbutler.lifecycle.v1` command with exactly
`status`, `install`, and `uninstall`. It selects only fixed bundled resources,
clears inherited environment, bounds output and execution, and permits one
lifecycle operation at a time. An interrupted operation becomes indeterminate;
its owner receipt remains authoritative. The UI cannot supply a process path,
argument list, environment, shell command, or data directory.

## Signing prerequisites

The owner needs an active Apple Developer Program membership, the exact
Developer ID Application certificate and private key, and one of the two
supported `notarytool` credential modes.
Use a dedicated protected `desktop-signing` environment restricted to reviewed
`main`. Preserve all required provider reviews and administrator controls. Do
not repurpose the website's status-signing App or broaden its permissions.

| Environment value | Kind | Purpose |
| --- | --- | --- |
| `APPLE_TEAM_ID` | Variable | Exact ten-character Developer ID team |
| `APPLE_SIGNING_IDENTITY_SHA1` | Variable | Exact Developer ID leaf certificate fingerprint |
| `APPLE_API_KEY_ID` | Variable | Notary API key ID |
| `APPLE_API_ISSUER` | Variable | Notary API issuer UUID |
| `APPLE_CERTIFICATE_BASE64` | Secret | Password-protected certificate/private-key P12, encoded as Base64 |
| `APPLE_CERTIFICATE_PASSWORD` | Secret | P12 password |
| `APPLE_API_PRIVATE_KEY` | Secret | Complete notary P8 private key |
| `APPLE_NOTARY_APPLE_ID` | Secret | Apple Account email for app-specific-password notarization (alternative to API key) |
| `APPLE_NOTARY_APP_PASSWORD` | Secret | Apple Account app-specific password (alternative to API key) |

Configure exactly one mode: either all three `APPLE_API_*` values, or both
`APPLE_NOTARY_*` values. For app-specific-password mode, create a label such as
`Textbutler notarization` at [account.apple.com → Sign-In and Security → App-Specific Passwords](https://account.apple.com/)
and add the generated value to the protected environment. The signer supplies it
to `notarytool` through its secure prompt and stores it only in the temporary
keychain deleted after the run. It is never placed in a command argument,
receipt, log, or app.

Inspect only credential names and nonsecret identity metadata. Never place
private keys, passwords, credential exports, or their contents in shell history,
source control, build artifacts, receipts, or agent-visible output.

## Release handoff

The [Desktop Release workflow](../../../.github/workflows/desktop-release.yml)
implements the staged handoff. The integration owner must establish its live
publication authority before first use. These helpers do not grant GitHub
authority. Required admission includes exact current-main CI and native
package evidence, independent review, immutable desktop tag and release
controls, the exact workflow/run/attempt, and unchanged source through dispatch.
Keep signing, credential-free verification, provenance, and immutable publication
in separate jobs. No job with Apple secrets may install dependencies, build the
app, execute bundle code, or publish a release. Only the final admitted publisher
receives `contents:write`; an OIDC attestation job receives its separate scope.

Before first dispatch, verify immutable Releases are enabled, protect the exact
desktop tag from update and deletion, create the dedicated `desktop-signing`
environment with a `main` deployment policy and administrator bypass disabled,
and configure its Apple identity variables and secrets. Preserve any required
environment reviewers. Read the registered numeric ID of
`.github/workflows/desktop-release.yml` into the repository variable
`DESKTOP_RELEASE_WORKFLOW_ID`; never substitute a workflow display name. This
workflow is bound to repository ID `1342143606` and owner actor ID `894119`.

After complete source CI succeeds for unchanged current main, create the direct
tag `desktop-v0.1.2-macos-arm64` at that exact commit. Dispatch the workflow from
`main` with `tag`, `ci_run_id`, and `ci_run_attempt`. The code revalidates main,
tag, current CI attempt and both required jobs at each authority boundary. The
desktop tag is independent of the legacy `v*` npm/package release. Do not advance
main until the release attempt settles. A missing signing environment, workflow
ID, required credential, tag or exact CI proof blocks the workflow.

The unsigned build and credential-free verifier run on separate Apple Silicon
hosts. The signer receives Apple secrets only in its signing step. The
checkout-free OIDC job admits the exact verifier hashes and current source
authority before attesting the ZIP, desktop manifest and checksums. The final
publisher verifies the signed provenance certificate's repository, source,
workflow, run and attempt, then creates a bounded draft, uploads each missing
exact asset once and reads back its bytes. It publishes only a complete immutable
prerelease and rechecks the resulting assets. It never requests Latest.

The helpers below implement the artifact handoffs. Paths refer to new isolated
directories, and digests must come from the admitted prior job, not from an
untrusted archive. The signing and verification helpers accept exact source SHAs
and handoff digests; they cannot replace source CI or workflow authority checks.

```sh
# Builder: clean checkout of the exact admitted main SHA, after package and smoke.
bun apps/macos/distribution/prepare.ts SOURCE_SHA UNSIGNED_DIRECTORY
# Fresh signing host: admitted unsigned-manifest SHA, protected Apple credentials.
bun apps/macos/distribution/sign.ts UNSIGNED_DIRECTORY UNSIGNED_RECEIPT_SHA256 SOURCE_SHA SIGNED_DIRECTORY
# Fresh credential-free Mac: exact signer receipt SHA from the signing job.
bun apps/macos/distribution/verify.ts SIGNED_DIRECTORY SIGNED_RECEIPT_SHA256 SOURCE_SHA VERIFIED_DIRECTORY
```

Unsigned handoff admission checks source, archive digest, bounded ZIP structure,
and the extracted file inventory before certificate use. The signer creates a
temporary Keychain, verifies the exact team and certificate fingerprint, signs
the bundled Bun first, refreshes its resource inventory, then signs the outer
app with hardened runtime and secure timestamps. It never changes the login
Keychain or its search list. Only Bun receives `com.apple.security.cs.allow-jit`;
the Rust app receives no additional entitlement.

The signer records submission intent before notarization and the submission ID
before waiting. After Apple's exact submission is accepted, it staples the app
and creates the final ZIP. The verifier checks the final ZIP bytes, every
Mach-O signature, team, certificate, architecture and entitlement, stapled
ticket, Gatekeeper and `syspolicy_check`, then runs the packaged smoke against
that extracted app. It emits the verified ZIP, manifest and SHA256SUMS. Publish
those exact bytes only after source-bound GitHub provenance is verified. Do not
mark the desktop prerelease Latest over the legacy package release.

## Recovery and upgrades

This initial workflow has no retained-attempt recovery authority. Exact current
main must remain unchanged through its final readback. If main advances, or a
failure leaves a draft bound to another run or attempt, a rerun fails closed.
Preserve that tag, draft, artifact IDs and receipts. First reconcile any uncertain
Apple submission or GitHub write. Then prepare a reviewed new desktop version
and direct tag at newly checked current main; keep the earlier coordinate as
retained history. Never move the earlier tag, adopt another attempt's draft,
delete its assets, or imply that the failed release completed. A future recovery
route must explicitly admit retained source and attempts before it can be used.

Do not retry an uncertain signing submission blindly. Retain
`notary-attempt.json` and `notary-submission.json` from the failed signing job;
reconcile the exact submission through Apple's supported notarytool. If the
submission ID was never captured, establish its outcome through the owner's
Apple submission history. An uncertain result is not authorization to submit
again. Rejected notarization requires diagnosis and a newly admitted candidate.

Never overwrite a published immutable asset, silently adopt another attempt's
draft, strip quarantine, or disable Gatekeeper to make installation succeed.
There is no automatic updater. Before replacing an installed app, stop its
background service using the existing app, preserve the owner data directory,
replace the app with the verified download, then explicitly start the service.
If service ownership or removal is uncertain, keep the exact plist and receipt
for reconciliation rather than deleting them or issuing a broad launchctl kill.

## Evidence and attribution

Run `bun test apps/macos/distribution/distribution.test.ts` for bounded artifact,
identity, entitlement, archive traversal and link rejection tests. These tests
use synthetic files and no Apple credentials. The regular desktop check includes
the distribution TypeScript and tests; native and signed gates remain additional.

The bounded ZIP implementation is adapted from the MIT-licensed
[Ghostget distribution implementation](https://github.com/hraness/ghostget/tree/main/desktop/distribution),
with Textbutler's root and smaller size bounds. No Ghostget runtime is bundled.
Signing follows [Apple's notarization guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
and [Tauri's macOS signing documentation](https://v2.tauri.app/distribute/sign/macos/).
The Bun entitlement choice is checked by the actual signed runtime probes;
[Bun's executable documentation](https://bun.com/docs/bundler/executables) is
reference material, not permission to add broader exceptions automatically.
