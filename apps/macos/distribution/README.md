# Retired Textbutler app distribution

Textbutler is distributed as a CLI with an unbundled macOS menu-bar companion.
The supported user path does not download, install, sign, notarize, or launch a
`.app` bundle. Install the package with Bun/npm, then run:

```sh
textbutler menubar
textbutler menubar install
textbutler menubar status
textbutler menubar uninstall
```

`textbutler menubar` runs the shipped prebuilt companion in the foreground and
holds a per-user singleton lock. `install` copies that same binary to
`~/Library/Application Support/Textbutler/bin/textbutler-menubar` and registers
a per-user LaunchAgent with `RunAtLoad=true` and no `KeepAlive`. Launching the
CLI never invokes Bun, Swift, Cargo, Tauri, or a package manager to build code.

The former Tauri app workflow is retained only as historical source for old
receipts and is disabled in
[`.github/workflows/desktop-release.yml`](../../../.github/workflows/desktop-release.yml).
It must not be dispatched for current releases. The signing, notarization,
Gatekeeper, and `.app` verification helpers under this directory are likewise
legacy-only and are not part of the CLI release gate.

## Building a companion for development

Builds are explicit and run by maintainers on macOS:

```sh
bun run --cwd apps/macos menubar:build
```

The resulting Mach-O is a development artifact. A release assembler must place
a reviewed, architecture-matched companion binary in the package's release
payload before publishing. If that binary is absent, `textbutler menubar`
fails closed with an install guidance error; it never falls back to source or a
debug build.

The Tauri inspector remains optional developer tooling for contact settings. It
is not required to run the daemon or the menu companion and has no release or
notarization status.
