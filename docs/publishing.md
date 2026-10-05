# Publish TextButler

## TextButler informational-site delivery

The informational TextButler website deploys through the Vercel Git
integration like every other Hraness site: `main` is the production branch,
merges to `main` build and publish automatically, and pull requests produce
previews. There is no separate promotion ref, writer workflow, status
authority, or manual dispatch in the routine path. Source repository identity
is the canonical `hraness/textbutler` with unchanged numeric repository ID
`1342143606`.

This site route grants no package publication, native app release, provider
qualification, or live message authority. The legacy tagged package route and
its exact-byte/npm checks remain unchanged.

## Repository identity migration

The repository rename keeps numeric GitHub repository ID `1342143606` and the
existing GitHub Apps, rulesets, protected refs, status contexts, environment
reviewers, workflow IDs, Vercel project, and production branch unchanged. The
canonical source identity for new release and promotion runs is
`hraness/textbutler`; an old-name redirect is not authority for a new run.
The npm name `@hraness/message-like-me`, its tag namespace, the
`messagelikeme` command, wire schemas, and historical release receipts remain
unchanged. `@hraness/agentmixer` publishes independently from the
`hraness/agentmixer` repository under its own `v*` tag namespace; this
repository consumes it only as a pinned immutable release artifact. Do not
rewrite an existing tag, npm version, or provenance statement.

Merge this version-neutral control migration independently before the next
product/version change. Refresh the complete administrative controls census
and independently review the exact helper/workflow changes. Before tagging,
read back each applicable npm trusted publisher and require canonical repository
`hraness/textbutler`, its existing exact workflow filename and permission set.
An old publisher identity blocks publication; do not fall back to a personal
token or weaken its policy. Any needed provider reconciliation is a separate
inspected operation. Historical versions retain their original provenance and
are not evidence for a new canonical-repository publication.

Any needed provider reconciliation is a separate inspected operation.

## Legacy package publication

Message Like Me builds one exact public package tarball, validates those bytes
on macOS and Linux, and publishes the same tarball plus `SHA256SUMS` to an
immutable GitHub Release. Only then does it publish that tarball to npm through
trusted publishing. Its informational site can enter Vercel Production only
after both public coordinates pass admission. The tag workflow never receives
the production-ref writer key. A separate current-`main` workflow admits the
external npm and GitHub artifacts, then advances the production source after
the Release succeeds. A dedicated private Hraness GitHub App signs one
exact-commit status; the same protected job's scoped GitHub Actions token makes
the leased ref move only while the matching App-sourced success is current.

No personal access token, deploy key, Vercel token, or repository-administration
permission belongs in either workflow.

Routine production promotion needs no human confirmation. The current-main
source, public artifacts, complete workflow history, App authority, writer
denial, expected-old lease, and provider readback are machine gates. An agent
may perform the independent review and exact dispatch required for a changed
workflow-control epoch; that review precedes dispatch.

## AgentMixer package consumption

`@hraness/agentmixer` is published independently from the `hraness/agentmixer`
repository; its tag namespace, release workflow, provenance identity, and npm
trusted publisher live there and are governed by that repository's runbook.
This repository consumes it only as a pinned, immutable GitHub Release
tarball. Upgrading the pin is a reviewed `package.json`/`bun.lock` change
against an already-admitted upstream release; it never re-runs, rewrites, or
co-signs an upstream release.

## Publish a stable release

Prepare one stable version commit through a pull request. The root package,
site package, source version, README install target, and generated site content
must agree. Create its exact annotated `v<version>` tag only after that commit
has passed review and entered `main`; the tag commit must remain an ancestor of
current `main`, and the tag must be the newest stable semantic version. Later
reviewed `main` descendants do not invalidate the immutable release authority.
The first automated trusted-publisher version must be newer than the manual
`v0.8.0` bootstrap coordinate, whether npm currently maps only `legacy` or both
`legacy` and `latest` to `0.8.0`.

The version commit also adds `## <version> - <date>` to the top of
`CHANGELOG.md`, with a summary paragraph followed by one bullet per
change. That section becomes the Release page. The page is titled
`Textbutler v<version>`; its body is the summary, `## Changes`, and generated
`## Install` and `## Verify` sections, and it ends with the identity record
`<!-- Automated public release of @hraness/message-like-me@<version> from
v<version>. -->`. The GitHub Release writer reads `CHANGELOG.md` at the
verified commit and fails before creating the release when the section is
missing, empty, or still says Unreleased. Every later admission reads the
identity from the last `<!-- ` marker, requires the body to end with `-->`,
and requires the notes above it to match the page rendered from its checkout's
`CHANGELOG.md` byte for byte, so an edited page fails admission. Releases
through `v0.8.21` were published with the title `Message Like Me v<version>`
and the identity sentence as their whole body; admission still accepts that
exact legacy page for those versions only.

The tag-triggered Release workflow:

1. checks out only the requested tag at depth one with tags and persisted
   credentials disabled. Before importing anything else, the checkout must
   contain exactly that local tag ref. A dependency-free helper takes separate
   fixed-URL snapshots of exact `refs/heads/main` and canonical
   `git ls-remote --refs --tags ... refs/tags/v*` output. The combined governed
   inventory is at most 64 KiB and 500 rows and rejects malformed object IDs, non-fully-qualified
   or unexpected refs, duplicate rows, and noncanonical order. Historical
   lightweight stable tags participate in newest-version ordering, but the
   requested tag itself must be one direct annotated tag object whose embedded
   name is exact and whose target is the checked commit. The helper removes
   stale `FETCH_HEAD`, then fetches only fully qualified current `main` into
   `refs/remotes/origin/main` and the requested tag into its same-name local tag
   with `--no-tags`, no configured refspec, no force, no submodules, and no
   `FETCH_HEAD` write. A shallow checkout is unshallowed through only those two
   governed refspecs. The post-import ref set must be exactly those two names and
   both objects must equal the first remote advertisement. The helper rejects
   tag-of-tag and lightweight requested tags, proves the release commit is a
   reviewed ancestor of exact advertised current `main`, and requires an
   identical terminal remote snapshot. The workflow then runs
   the complete root, site, generated-file,
   packed-package, and synthetic macOS gates with read-only permissions;
2. creates one npm tarball and `SHA256SUMS`, preserves those exact bytes as a
   30-day workflow artifact, preserves separate numeric-ID-bound artifacts
   containing only the reviewed dependency-free npm writer and GitHub Release
   writer closures. Both closures are copied from regular non-symlink files into
   fresh runner-temporary roots and checked against exact file inventories before
   any repository code or dependency executes. Every local writer import names its
   `.ts` source explicitly. The workflow also installs the unchanged tarball on
   macOS and Linux;
3. gives only the GitHub publication job `contents: write`. That job performs no
   repository checkout or dependency install. Its SHA-pinned Bun and numeric-ID
   artifact actions are part of the privileged TCB. The GitHub token is scoped only to the final
   dependency-free publisher step. The writer artifact
   was assembled from the verified release source by the read-only verification
   job and is bound by its numeric ID and digest. That publisher revalidates the remote
   annotated tag object and reviewed-`main` ancestry, creates or safely resumes
   one deterministic draft, uploads only the tarball and checksum, publishes it
   as Latest, and requires the Release to read back immutable with exact names,
   sizes, digests, and bytes. An ambiguous or non-exact residual draft fails
   closed;
4. uses a separate read-only job with pinned Sigstore dependencies to prove the
   immutable Latest GitHub Release and workflow artifact are byte-identical.
   It records its actual run ID and attempt. If the npm version already exists,
   it must contain those exact bytes and its SLSA invocation plus Fulcio
   extension `.21` must bind the same workflow run ID at a positive attempt no
   later than that preflight attempt; and
5. gives only the no-checkout npm publication job `id-token: write`. Its
   SHA-pinned Bun, Node, and numeric-ID artifact actions are part of the
   privileged TCB; it installs no repository dependencies before invoking the
   reviewed dependency-free writer. Any later positive attempt of the same run
   may publish a still-absent
   version. If an earlier attempt made the exact version visible before its job
   completed, a later writer performs no mutation and defers acceptance to the
   final read-only provenance gate. A same-attempt absent-to-existing race fails
   closed. The writer records whether it published or observed existing bytes,
   plus its actual run ID and attempt. Final admission requires that exact
   attempt for a publication, or the same run at a positive attempt no later
   than the bounded observation attempt. It also verifies exact npm version and
   Latest integrity, MIT license, SHA-1, SHA-512, GitHub byte parity, and the
   Sigstore bundle's exact repository, workflow, tag, commit, run ID, attempt,
   Fulcio subject, certificate extensions, transparency log, and certificate
   transparency evidence.

The immutable annotated tag object, not mutable Release `target_commitish`
metadata or another branch hint, is the release authority once the tag exists.
Every reviewed-main comparison binds the exact base commit, merge base,
`status`, canonical integer `ahead_by` (zero only for identical, positive for
ahead), zero `behind_by`, and terminal `commits[-1].sha` for an ahead response
to a branch ref that is read before and after the comparison.
The workflow never treats an optional `head_commit` response field as authority.
Re-running or completing a failed workflow never retags,
deletes an immutable Release, changes tarball bytes, or accepts provenance from
another run. GitHub publication always precedes npm, preventing a mutable or
incomplete repository Release from stranding an npm version.

The tag workflow has no environment, App credential, provider baseline,
production-ref mutation, or provider-outcome job. The website deploys on
`main` independently of releases.
