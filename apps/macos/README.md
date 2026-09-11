# Textbutler for macOS

A bundled Tauri 2 webview for contact settings, scoped memory, activity, capability setup, and global pause. The app never starts an agent, launches the daemon, reads Messages or Contacts, or sends a message itself.

The native entry communicates with the separately started Textbutler daemon at `~/Library/Application Support/Textbutler/daemon.sock`. One native command accepts only the versioned control requests in `src/control.ts`. It checks directory/socket ownership and private modes, rejects symlink paths, checks the peer UID, bounds requests and responses to 1 MiB, caps concurrent relays at four, and enforces one absolute four-second connection/write/read deadline. Missing or refused sockets show a disconnected state; malformed responses and permission failures are visible errors. The source CLI can install the daemon as a per-user LaunchAgent; see the runtime README for its explicit lifecycle commands.

The native webview loads bundled assets only, denies external navigation and new windows, and has one explicit `allow-control-request` permission. No shell, filesystem, HTTP, opener, or remote navigation plugin is installed. The daemon remains responsible for validating every request, scope, revision and capability. Memory writes use the content SHA-256 as a conditional revision; settings use the snapshot revision.

## Build and inspect

Use Bun 1.3.14 and the root checkout's installed TypeScript dependency:

```sh
cd apps/macos
bun run check
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo run --manifest-path src-tauri/Cargo.toml --locked
```

Route native Cargo checks/builds through the installed host scheduler when required by the repository instructions. The frontend must be built before Cargo embeds it. The app is source-buildable; signing, notarization, app release packaging and live autonomous messaging qualification remain separate release work.

## Synthetic interface preview

```sh
bun run build:demo
bun run preview
```

The loopback preview is explicitly synthetic and uses an in-memory control port. It supports contact selection, enable/disable and capacity validation, smart or keyword mode, Codex or Claude, disclosure-symbol validation and preview, editable memory, pause, and activity recording for preview configuration changes. Reloading resets everything. It never reads private data or calls a daemon, agent, messaging service, or network API. Synthetic contacts and activity are excluded from the native build and checked by the build script.

Capability availability always comes from the daemon snapshot. No connected transport is fabricated by the preview. Unsupported features such as stickers or iMessage apps remain visible as unavailable until a provider explicitly reports otherwise.

## Local design references

`PRODUCT.md` and `DESIGN.md` record the desktop scope and native utility direction. Ghostget informed the small Tauri-wrapper structure; its source, private runtime, permission state and credentials are not bundled here.
