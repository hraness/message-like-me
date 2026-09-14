# Textbutler for macOS

Textbutler is distributed and operated as a CLI with an unbundled macOS
menu-bar companion. The CLI owns the daemon, contact settings, scoped memory,
activity, connection setup, agent accounts and global pause. The companion is a
small status item that opens the web dashboard and reports daemon state; it does
not require an app bundle, download, signing, or notarization.

The Tauri 2 settings inspector remains in this repository as an optional local
surface for development and owners who want a larger settings window. It is not
part of the supported release or installation path.

Textbutler is menu-bar first: the compact utility header keeps daemon state,
getting-started guidance, active-contact and account counts, pause/resume,
account setup, status refresh, and the textbutler.app entry point one click
away. The larger inspector remains available for contact memory and detailed
configuration, but it is not required for day-to-day operation. Shared utility
marks use short two-letter labels (`AI`, `Sl`, `Pe`, `Oo`, and `Tb`) so they stay
legible at menu-bar scale.

For a native status item without an app bundle, run `bun run menubar:build` once
and then `bun run menubar`. The run command only launches the existing
`out/textbutler-menubar`; it never invokes Swift, Bun bundling, or a package
manager. It is an unbundled accessory binary with the
short serif `Tb` mark; it reads only the private daemon-socket presence and
opens the fixed `https://textbutler.app/` dashboard. It does not package,
sign, notarize, start, or control the daemon. The Tauri inspector remains the
optional settings surface.

The native entry communicates with the Textbutler daemon at `~/Library/Application Support/Textbutler/daemon.sock`. The control command accepts only the versioned requests in the shared control package. It checks directory/socket ownership and private modes, rejects symlink paths, checks the peer UID, bounds requests and responses to 1 MiB, caps concurrent relays at four, and enforces one absolute four-second connection/write/read deadline. Missing or refused sockets show a disconnected state; malformed responses and permission failures are visible errors. Long owner jobs return a polling receipt so global pause remains available.

A separate lifecycle command supports exactly service status, install and uninstall using fixed bundled runtime paths. The owner first moves the verified app to an Applications folder, checks service ownership, then explicitly installs it. New settings start paused. Uninstalling preserves contacts and memory. An uncertain lifecycle result requires ownership reconciliation; the UI cannot supply process paths, arguments or environment values.

The native webview loads bundled assets only, denies external navigation and new windows, and has explicit control and lifecycle permissions. No shell, filesystem, HTTP, opener, or remote navigation plugin is installed. The daemon validates every request, scope, revision and capability. Memory writes use the content SHA-256 as a conditional revision; settings use the snapshot revision.

## Build and inspect

Use Bun 1.3.14 and the root checkout's installed TypeScript dependency:

```sh
cd apps/macos
bun run check
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo run --manifest-path src-tauri/Cargo.toml --locked
```

The CLI and menu companion do not need a native package build. Route native
Cargo checks through the installed host scheduler when working on the optional
Tauri inspector. `bun run menubar:build` is the only command that compiles the
menu companion; `bun run menubar` requires that prebuilt file and runs it in the
foreground. `native:package` and `native:smoke` remain developer fixtures for
the optional inspector and are not release prerequisites.

## Synthetic interface preview

```sh
bun run build:demo
bun run preview
```

The loopback preview is explicitly synthetic and uses an in-memory control port. It supports contact selection, enable/disable and capacity validation, smart or keyword mode, Codex or Claude, disclosure-symbol validation and preview, editable memory, pause, and activity recording for preview configuration changes. Reloading resets everything. It never reads private data or calls a daemon, agent, messaging service, or network API. Synthetic contacts and activity are excluded from the native build and checked by the build script.

Capability availability comes from the daemon snapshot. Owner-configured iMessage and WhatsApp connections, bounded conversation enrollment, optional history initialization and explicit agent account selection are described in the [runtime documentation](../../packages/textbutler/README.md). Rich actions remain unavailable unless their exact provider reports and admits them; unsupported iMessage app experiences are not simulated as live.

## Local design references

`PRODUCT.md` and `DESIGN.md` record the desktop scope and native utility direction. Ghostget informed the small Tauri-wrapper structure; its source, private runtime, permission state and credentials are not bundled here.
