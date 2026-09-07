# Command runtime and private publication

`runCommand(argv, io)` remains the Promise boundary used by the CLI. It runs one
Effect scope for a complete command. `command-program.ts` owns command ordering;
`CommandPlatform` supplies named native operations, the injected clock and output,
and scoped stores. A store exposes only declared operations, never the SQLite
handle. Each successful acquisition closes exactly once. Close failures preserve
the former `finally` precedence over a command failure.

All SQLite transaction callbacks remain synchronous. Ingestion, source overlap,
corpus revisions, HMAC identities, metrics, profile provenance, canonical digests,
and the versioned handoff contracts continue to use their existing domain code.
There is no parallel SQL mutation, network capability, agent invocation, message
sending, or retry added by this runtime.

Command programs declare their success, failure, and required services. Expected
failures retain the original error as a cause in the closed `CommandFailure`
union. Native adapters translate source-specific failures at the same boundaries
as before. The runtime has a narrow compatibility bridge for existing pure
validators that throw `CliError`; other defects remain defects. CLI text, stdout
formatting and exit-code selection are unchanged. The paired skill installer adds
the bounded residual diagnostics described below.

## Publication and receipt recovery

A private file and its SQLite receipt are separate durable operations. A scope
owns a pending publication until the command explicitly retains it. Two-file
evaluation output retains both files only after both publications succeed. A
failure publishing the second file rolls back the first only when its custody
can still be proven; an existing second destination is never overwritten.

Study and handoff publication runs receipt recording and recovery without an
interruption boundary. If recording fails, a read-only exact-binding check reports
one of four states:

- `absent`: the receipt is absent, so cleanup may remove the owned publication.
- `committed`: the exact receipt exists; keep the publication.
- `different`: a receipt with that identity has different bindings; keep it.
- `unproven`: confirmation failed; keep it for inspection.

In particular, handoff recording may commit and then fail reading its audit. That
failure must not delete the handoff. An output-stream failure after a successful
receipt also leaves the publication intact. These paths preserve the original
CLI failure message and exit code. Internal callers can inspect
`PrivatePublicationError.publications` for immutable, body-free path and byte
digests, receipt state, and cleanup outcome. The report is not printed on stdout
and creates no retry authority.

Native publication creates an exclusive private staging file, syncs it, links it
without overwriting the destination, removes its own staging link, and syncs the
directory. Custody is held privately by the native adapter and is derived from
the created inode. Cleanup checks physical directory identity, ownership, modes,
link count, file identity, size, timestamps, and content digest. Digest reads use a
fixed-size buffer and stop at the captured size plus one byte, even if a file grows. It opens without
following symlinks and has no asynchronous yield between its final identity check
and unlink. Observed substitutions and unprovable state remain untouched.

This is not a filesystem-and-SQLite transaction or a kernel conditional unlink.
A separate process running as the same user can still race the final path check;
Effect and TypeScript do not remove that operating-system limitation. Directory
sync failures after removal are reported as `removed-unconfirmed`. The runtime
never claims that uncertain cleanup succeeded.

## Paired skill installation

The existing command runtime directly composes the fixed `message-like-me` and
`ensoul` installer. Its program owns preflight, exclusive directory lock, private
transaction directory, copies, backups, both publish renames, recovery, cleanup,
and output. Both publish acknowledgements commit the pair immediately. Backup
cleanup, path confirmation, or stdout failure afterward never rolls it back.
There is no automatic retry or additional runtime. Admitted native work and
sequential recovery remain masked until the actual filesystem promises settle.

Before creating missing installation parents, read-only preflight rejects
conflicts, observed source/target overlap, symlinked installation parents, and
nonphysical source entries. Project anchors resolve existing aliases first;
missing project directories are then created in order beneath the observed
physical ancestor. Requested paths allow 4,096 UTF-8 bytes and at most 64 missing
project components. These directories are retained on later failure. Each
skill inventory permits at most 64 entries, eight levels, 256 KiB per file, and
2 MiB total. These bounds also apply to the old directory on forced replacement.
Copied types, bytes, and digests must match the admitted source before publication.
Copies explicitly refuse existing entries. A cooperating installer's existing
lock is never reclaimed; an ambiguous acquisition is left for inspection.

Before publication and cleanup the adapter rechecks observed physical parents
and entry identities. Recovery runs in reverse pair order; independent actions
continue after cleanup failure. Restoration requires an absent destination and
the observed backup. Cleanup removes individually observed leaves and then empty
directories, retaining unknown or substituted entries. Creating missing parent
directories is not rolled back. This is observation-bound custody, not a kernel
conditional unlink, cross-process atomic visibility, hostile same-user race
immunity, or crash recovery.

Clean success stdout is unchanged. Residual cleanup or a postcommit output
failure adds one stderr warning containing only fixed skill, phase, and commit
state labels. Private cleanup causes remain internal. The original primary
rejection, including `undefined`, `null`, or `false`, wins over cleanup and a
failed warning writer. A successful install with failed warning output instead
reports that output failure; it does not repeat installation.

## Enforced architecture and distribution

`bun run check:effect` uses the repository's TypeScript compiler API and the
reviewed policy in `scripts/check-effect-architecture.ts`. Only `commands.ts`
may execute a runtime; native calls belong in `command-platform.ts` or
`command-artifacts.ts`, or `skill-install-platform.ts`. The installer model and
program compose under that same command owner. The checker rejects unclassified Effect modules,
floating Effects, erased channels, unsafe assertions, failure-discard shortcuts,
suppressions, and selected ambient I/O. Its paired fixtures cover common aliases.
It does not prove purity, linear lifetime safety, domain correctness, foreign
cancellation, or every possible JavaScript indirection. Consequential lifecycle,
publication, native-reader, and contract tests remain required.

Effect 3.22.1 is a pinned build dependency bundled into `dist/cli.js`; its
[MIT license](effect-license.txt) ships with the package. The five
public protocol JavaScript entries and their declaration graphs build separately
and expose no Effect dependency. `bun run check:public-graphs` verifies their
transitive built graphs. The full `bun run check` also keeps typecheck, all tests,
skill validation, the standalone privacy and local-only scan, fresh-build byte
comparison, and an isolated packed-consumer install. Release and synthetic
macOS gates remain governed by the existing publication runbook.
