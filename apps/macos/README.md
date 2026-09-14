# Textbutler menu-bar companion

Textbutler is distributed as a CLI with an unbundled macOS status-item companion.
This directory contains only the Swift source and the explicit build/run helper;
there is no desktop window, app bundle, signing step, or notarization
workflow.

Build the companion explicitly on macOS:

```sh
bun run --cwd apps/macos menubar:build
```

Run the prebuilt binary in the foreground:

```sh
bun run --cwd apps/macos menubar
```

The CLI installs the release-built binary for login startup with
`textbutler menubar install`. Launching never builds source. The companion uses a
per-user singleton lock and exits when the user chooses Quit or sends Ctrl-C.
