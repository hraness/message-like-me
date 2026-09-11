# Bundled runtime notices

Textbutler's source is MIT licensed; its license is included in the app.

The checked Rust crate notice artifacts are not yet generated. The current
inventory stops because `alloc-stdlib` 0.2.4 declares BSD-3-Clause but omits its
original license file from the crate archive. The generator collects omitted
notices and fails closed; no generic or unverified license is substituted.
Resolve every omitted notice from reviewed upstream evidence, generate and
verify `RUST-LICENSES.md` and `RUST-LICENSES.json`, then run the exact-source native
package gates before distribution. Packaging intentionally requires both files.

The unmodified Bun1.3.14 runtime is distributed alongside the compiled CLI.
`BUN-LICENSE.md` is the complete upstream notice file at
https://github.com/oven-sh/bun/blob/bun-v1.3.14/LICENSE.md.
The exact corresponding source is available at that tag; its WebKit source and
relinking instructions are included in the notice. Textbutler's script remains
separate from Bun and is distributed as editable JavaScript.

Once generated, `RUST-LICENSES.md` retains the original license and copyright files from the
Cargo.lock dependency closure for `aarch64-apple-darwin`, including build-time
crates conservatively. `RUST-LICENSES.json` binds each crate version, package
checksum and original file digest. The generator reads original files from the
cached crate archive after verifying its exact Cargo.lock checksum.
`rust-notices.ts` verifies the checked
closure before packaging; regenerate it after a lockfile change.

The native app is built with Rust1.97.1. Its standard-library copyright notice
and MIT/Apache license files are retained from that exact toolchain. Corresponding
source is available at https://github.com/rust-lang/rust/tree/1.97.1.
The optional Claude API runtime uses the MIT-licensed Anthropic API SDK and
Zod; their complete installed license files are copied into each app build.
No Claude Code native executable or Ghostget runtime is distributed here.
