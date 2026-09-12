# Bundled runtime notices

Textbutler's source is MIT licensed; its license is included in the app.

The checked Rust crate notice artifacts cover 253 packages in the locked target
closure. Eighteen crate archives omit their notice files; `rust-supplements/`
retains their exact historical upstream grants and attribution, with each source
bound to the crate checksum and recorded VCS commit. Referenced standard license
texts are separately labeled. They do not invent missing copyright owners or
dates. Packaging requires and verifies both generated notice files.

The unmodified Bun1.3.14 runtime is distributed alongside the compiled CLI.
`BUN-LICENSE.md` is the complete upstream notice file at
https://github.com/oven-sh/bun/blob/bun-v1.3.14/LICENSE.md.
The exact corresponding source is available at that tag; its WebKit source and
relinking instructions are included in the notice. Textbutler's script remains
separate from Bun and is distributed as editable JavaScript.

`RUST-LICENSES.md` retains the original license and copyright files from the
Cargo.lock dependency closure for `aarch64-apple-darwin`, including build-time
crates conservatively. `RUST-LICENSES.json` binds each crate version, package
checksum, original file digest and any separately labeled upstream supplement.
The generator reads original files from the
cached crate archive after verifying its exact Cargo.lock checksum.
`rust-notices.ts` verifies the checked
closure before packaging; regenerate it after a lockfile change. This is an
attribution assembly, not a universal legal certification. The generated notice
includes exact unmodified source-download coordinates and checksum instructions,
including for MPL-covered dependencies.

The native app is built with Rust1.97.1. Its standard-library copyright notice
and MIT/Apache license files are retained from that exact toolchain. Corresponding
source is available at https://github.com/rust-lang/rust/tree/1.97.1.
The optional Claude API runtime uses the MIT-licensed Anthropic API SDK and
Zod; their complete installed license files are copied into each app build.
No Claude Code native executable or Ghostget runtime is distributed here.
