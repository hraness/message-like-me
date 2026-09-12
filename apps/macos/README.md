# Textbutler for macOS

A bundled Tauri 2 webview for contact settings, scoped memory, activity, connection setup, agent accounts and global pause. The installed app can explicitly manage its bundled background service; the daemon owns agent and messaging operations.

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

Route native Cargo checks/builds through the installed host scheduler. The frontend must be built before Cargo embeds it. `bun run native:package` builds the complete unsigned app with pinned Bun and compiled CLI; `bun run native:smoke` checks the relocated runtime against synthetic state. The [distribution procedure](distribution/README.md) defines the separate signed, notarized, provenance-verified desktop release. Source builds and synthetic tests do not establish live provider qualification.

## Synthetic interface preview

```sh
bun run build:demo
bun run preview
```

The loopback preview is explicitly synthetic and uses an in-memory control port. It supports contact selection, enable/disable and capacity validation, smart or keyword mode, Codex or Claude, disclosure-symbol validation and preview, editable memory, pause, and activity recording for preview configuration changes. Reloading resets everything. It never reads private data or calls a daemon, agent, messaging service, or network API. Synthetic contacts and activity are excluded from the native build and checked by the build script.

Capability availability comes from the daemon snapshot. Owner-configured iMessage and WhatsApp connections, bounded conversation enrollment, optional history initialization and explicit agent account selection are described in the [runtime documentation](../../packages/textbutler/README.md). Rich actions remain unavailable unless their exact provider reports and admits them; unsupported iMessage app experiences are not simulated as live.

## Local design references

`PRODUCT.md` and `DESIGN.md` record the desktop scope and native utility direction. Ghostget informed the small Tauri-wrapper structure; its source, private runtime, permission state and credentials are not bundled here.
