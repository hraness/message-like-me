# Publish Message Like Me

Message Like Me builds one exact public package tarball, validates those bytes
on macOS and Linux, and publishes the same tarball plus `SHA256SUMS` to an
immutable GitHub Release. Only then does it publish that tarball to npm through
trusted publishing. Its informational site can enter Vercel Production only
after both public coordinates pass admission. The tag workflow never receives
the production-ref writer key. A separate current-`main` workflow admits the
external npm and GitHub artifacts, then advances the production source after
the Release succeeds using a short-lived token from a dedicated private Hraness
GitHub App.

No personal access token, deploy key, Vercel token, or repository-administration
permission belongs in either workflow.

## Establish the production controls once

Apply these controls in order. Record the exact readbacks in the change review.
Do not merge a product or version change until every control and the persistent
writer canary are complete.

The read-only Message Like Me pre-control snapshot on 2026-08-29 is:

- authoritative `main` is
  `167738fcc40e523d2696e2ff2bdbe29d502ba7df`;
- `refs/heads/website-production` is absent;
- the repository ruleset inventory is exactly empty;
- Vercel project `prj_K7VHB2ELASGF1OxTCxG8bfxOEoQJ` reports
  `link.productionBranch=main`; and
- its Production deployment for that exact `main` SHA is `READY` and
  `PROMOTED`.

The persisted Message Like Me Sites identifier
`appgprj_6a88baf1c6388191af90b2e1d7b846ee` is not accessible in the current
Sites workspace. Preserve it unchanged. Use the canonical Vercel control plane
for this rollout and do not create a replacement Sites project.

1. Merge the version-neutral release-control change from the reviewed current
   `main` head. Confirm the merged tree is the reviewed tree and all required
   checks passed.
2. Create the missing `website-production` ref once at that exact merged
   control commit. This bootstrap is the only manual creation of the ref.
3. In the signed-in Vercel project settings for project
   `prj_K7VHB2ELASGF1OxTCxG8bfxOEoQJ`, change Production Branch from `main` to
   `website-production`. The supported project PATCH does not expose this
   field, so use the signed-in provider UI and then perform an exact project
   GET readback. Require `link.productionBranch` to equal
   `website-production`. Preserve the existing project root, build command,
   install command, Git connection, domains, environment, and deployment
   settings.
4. Register one private Hraness-owned GitHub App dedicated to Message Like Me
   production-ref advancement. Give the App exactly repository permissions
   `Contents: Read and write` and implicit `Metadata: Read`, with no
   organization permission. Install it on `hraness` with selected-repository
   access to exactly `hraness/message-like-me`. Record its numeric App ID,
   client ID, numeric installation ID, App slug, and the repository's numeric
   ID `1342143606`. These are distinct identities. Read the repository ID from
   GitHub's authenticated repository API and do not substitute a name at the
   token-mint boundary.
5. Create environment `production-ref-writer-key`. Limit deployment branches
   to selected branch `main` only. Require reviewer `@0thernet` and leave
   prevent-self-review disabled for this owner-operated release path. Do not add
   a custom deployment-protection-rule App. Store the private key only as
   environment secret `MLM_RELEASE_APP_PRIVATE_KEY`; store checked variables
   `MLM_RELEASE_APP_CLIENT_ID`, `MLM_RELEASE_APP_ID`,
   `MLM_RELEASE_APP_INSTALLATION_ID`, and `MLM_RELEASE_APP_SLUG` in that
   environment. Store the tag Release workflow's exact numeric workflow ID as
   repository variable `MLM_RELEASE_WORKFLOW_ID`, where the unprivileged
   trigger-verification job can read it. The privileged workflow declares
   `environment: { name: production-ref-writer-key, deployment: false }`, so
   admission and secret policy do not create a GitHub Deployment that would
   pollute the exhaustive Vercel Production inventory.
6. Add two active repository rulesets whose sole permanent ref target is
   `refs/heads/website-production`:
   - A no-bypass ruleset blocks creation, deletion, and non-fast-forward
     updates. It prevents recreation or force movement after the bootstrap.
   - A separate update ruleset blocks ordinary updates and gives the dedicated
     release App's exact numeric App ID one `always` bypass with actor type
     `Integration`. Set `update_allows_fetch_and_merge=false`. Do not use the
     client ID, installation ID, bot user ID, GitHub Actions Integration
     `15368`, `exempt`, a human identity, or a generic deploy-key bypass.
7. Add a separate active `main` ruleset requiring pull requests, code-owner
   review for `/.github/workflows/**`, the exact CI checks used by this
   repository, and protection from deletion and non-fast-forward updates. Keep
   bypasses empty.
8. Keep active no-bypass ruleset `Immutable version tags` scoped exactly to
   `refs/tags/v*`, with only update and deletion restrictions. It allows a new
   stable tag to be created but prevents an existing release tag from moving or
   disappearing. Read back `current_user_can_bypass=never` before release.
9. Enable immutable releases for the repository. Immediately before creating
   each version tag, use owner-admin access out of band to require the repository
   immutable-releases endpoint to report `enabled=true`; record whether owner
   policy also reports `enforced_by_owner`. The Actions token cannot perform
   this administrative read. The workflow must still prove the resulting
   published Release reports `immutable=true` before npm can run.
10. Ensure `@hraness/message-like-me` exists publicly under the Hraness npm
   scope, then configure its sole trusted publisher as GitHub Actions repository
   `hraness/message-like-me`, workflow file `release.yml`, with `npm publish`
   permission. The one-time registry bootstrap may publish only the exact
   already-reviewed `v0.8.0` package bytes under a non-Latest `legacy` dist-tag;
   every later release must use OIDC from the checked workflow. Once trusted
   publishing is proven, disallow traditional token publication for the
   package. This manual `v0.8.0` registry seed is historical bootstrap only: it
   remains outside Latest and is not expected to acquire trusted-publisher
   metadata retroactively. Do not rerun its tag or invoke the automated Release
   workflow for `v0.8.0`. After the version-neutral control change merges,
   prepare a separate product pull request for a version newer than `0.8.0`;
   that new version is the first automated OIDC release and becomes Latest.
   Never retag or reuse `v0.8.0`. The public repository and package must retain
   automatic npm provenance for every automated release.

After setup, use owner-admin access out of band to read back the exact Vercel
production branch, environment, variables, secret names, complete App
installation, and all GitHub ref rulesets. Never give that administrative
credential or evidence collector to the release workflow. Its narrowed App
token proves only its own effective identity, repository, permission, and
expiry closure. The Message Like Me post-control record must prove all of these
assertions together:

- `main` is the exact reviewed merge commit for this control change;
- `website-production` exists at that same commit before its rulesets become
  active;
- the no-bypass ruleset contains only creation, deletion, and
  non-fast-forward protection for that exact ref;
- the stable-tag ruleset targets only `refs/tags/v*`, contains only update and
  deletion restrictions, has no bypass actors, and reports
  `current_user_can_bypass=never`;
- the update ruleset contains only the update restriction for that exact ref,
  has the dedicated App's numeric ID as its sole `Integration` `always` bypass,
  and reports `update_allows_fetch_and_merge=false`;
- the App installation reports `repository_selection=selected`, account
  `hraness`, exactly `contents:write` plus `metadata:read`, and an exhaustive
  `/installation/repositories` set of exactly
  `{hraness/message-like-me}` with repository ID `1342143606`;
- `production-ref-writer-key` admits only `main`, requires the expected
  reviewer, exposes only the expected key and checked variables, and has no
  custom deployment-protection rules;
- the Vercel project reads back
  `link.productionBranch=website-production`, while its project root, build,
  install, Git, domain, environment, and deployment settings remain identical
  to the pre-control snapshot; and
- a later `main` push creates no Vercel Production deployment.

Also read back the separate `main` ruleset and prove its pull-request,
code-owner, exact CI, deletion, and non-fast-forward requirements. The control
change deliberately retains version `0.8.0` and changes no product claim,
dependency, lockfile, or generated documentation.

### Prove the writer bypass before product release

Do not infer the bypass from configuration alone. Before the first product
release, precreate persistent ref
`refs/heads/website-production-writer-canary` at the reviewed control commit.
Apply separate active rulesets with the same no-bypass protections and the same
App-only update rule to that exact canary ref. Under a separately reviewed,
owner-operated procedure, mint the same repository-scoped App token and make
one fast-forward advancement to a reviewed descendant with an explicit
nonempty expected-old
`--force-with-lease`. A personal token or deploy key is not an acceptable
probe. A bare lease, remote-tracking lease, `--force`, empty expected-old,
creation, deletion, wildcard, or multi-ref push is not acceptable evidence.

Capture canonical ruleset and rule-suite evidence that binds the probe ref,
numeric App ID, App slug, installation ID, before SHA, after SHA, operation
time, and originating run. The successful suite must report result `bypass`
for the App's `always` bypass while the ordinary update rule itself reports a
failed evaluation. Separately prove an ordinary writer cannot make the same
update. Keep the canary ref and its dedicated rulesets active after the proof so
the evidence remains reproducible. The no-bypass deletion rule deliberately
forbids deleting it; do not attempt deletion or temporarily remove protection.
Read back that the production rulesets still target only
`refs/heads/website-production` and the canary rulesets still target only the
persistent canary ref.

Keep the first later product release in a separate pull request based on this
exact control head. That product pull request must not change
`.github/workflows/`, `.github/CODEOWNERS`, the provider helpers, or these
controls. This separation keeps the reviewed control lineage intact.

## Publish a stable release

Prepare one stable version commit through a pull request. The root package,
site package, source version, README install target, and generated site content
must agree. Create its exact annotated `v<version>` tag only after that commit
has passed review and entered `main`; the tag commit must remain an ancestor of
current `main`, and the tag must be the newest stable semantic version. Later
reviewed `main` descendants do not invalidate the immutable release authority.
The first automated trusted-publisher version must be newer than the manual
non-Latest `v0.8.0` bootstrap coordinate.

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
production-ref mutation, or provider-outcome job. A tag cannot enter
`production-ref-writer-key` because that environment admits only `main`.

After the full Release succeeds on any positive run attempt, its completed
`workflow_run` starts `Promote website production` from current default-branch
code. Every promotion checkout uses the exact current-main workflow SHA at
depth one with tags and persisted credentials disabled. Release content is
read from the separately imported and verified annotated-tag commit; tagged
workflow or helper code never executes. Treat the entire upstream payload as
untrusted. Require the exact
repository, checked numeric Release workflow ID, workflow name and path,
upstream event `push`, positive run ID and attempt, successful conclusion,
stable tag, annotated-tag target, downstream workflow SHA, and reviewed `main`
ancestry to agree. The current workflow source must still be exact current
`main`; the immutable release commit may be an earlier reviewed ancestor. A
manual `workflow_dispatch` with an untrusted release-tag input exists only for
recovery. Both paths use the same checks. That workflow:

1. runs the same fixed-URL, bounded, double-snapshot ref helper from an exact,
   depth-one, no-tag, no-credential current-`main` checkout whose initial local
   ref set is empty. The helper imports only exact main into
   `refs/remotes/origin/main` and the requested tag into its same-name local tag,
   requires `GITHUB_SHA` to equal advertised current main, and separately binds
   the direct annotated tag's peeled release commit to the successful Release
   run. Its post-import ref set must be exactly those two governed refs. It then
   proves the workflow file, `GITHUB_REF`, current default
   branch, annotated tag object, reviewed ancestry, root and site versions,
   exact npm
   version and Latest integrity, provenance, immutable artifact-complete Latest
   Release, checksum, and release authority all resolve to the same immutable
   release commit and tarball;
2. takes two stable, exhaustive GraphQL snapshots of at most 500 current
   `Production` deployments, including each deployment's current state and
   `latestStatus`, bracketed by authenticated GitHub server time and exact
   `website-production` ref reads;
3. enters `production-ref-writer-key` with `deployment:false` only when the
   baseline and a separate read-only preflight prove that the ref must advance.
   The fresh secret-bearing job installs no dependencies; immediately before
   reading the key it verifies hard-coded SHA-256 pins for the three reviewed
   built-in `.mjs` helpers. A checked local helper signs a
   bounded RS256 App JWT, authenticates the exact App ID, client ID, slug, and
   organization owner, then reads the checked installation ID and requires its
   selected `hraness` account plus exact `contents:write` and `metadata:read`
   permission closure. It then POSTs one token request with literal
   `repository_ids: [1342143606]` and only those permissions;
4. fails closed unless the mint response contains exactly that numeric
   repository, selected-repository scope, those two permissions, and a
   canonical expiry within the authenticated one-hour response window. It
   masks the token before use and keeps it out of workflow outputs. The
   token-scoped callback ends immediately after the one leased Git push. After
   that callback it sends exactly one nonredirecting `DELETE /installation/token`,
   requires an HTTP 204 with absent or canonical-zero `Content-Length` and zero
   body bytes, and then observes the exact selected-repository authority until
   two stable HTTP 401 responses prove convergence. A mutation failure and a
   revocation or convergence failure are both retained;
5. sandwiches the fresh writer job with separate read-only immutable Release,
   Latest, annotated-tag, reviewed-ancestry, public-artifact, and workflow-source
   admissions; proves `website-production` can fast-forward; then fetches only
   `refs/tags/<verified-tag>` from the fixed HTTPS repository at depth one,
   with tag following and submodule recursion disabled. It peels
   `FETCH_HEAD^{commit}` without checking out or executing tagged code and
   requires the result to equal `verified_sha` before using authenticated Git
   to push exactly
   `<verified-sha>:refs/heads/website-production` with
   `--force-with-lease=refs/heads/website-production:<expected-old-sha>`. The
   token stays out of URLs, argv, and Git config behind a bounded temporary
   `GIT_ASKPASS` helper, prompting is disabled, global and system configuration
   are disabled, hooks and tags are disabled, cleanup is trapped, and a stale
   lease fails without mutation. Read-only singular REST ref reads before the
   push use the job's read-only GitHub Actions token. The exact post-push ref
   read and independent current-`main` workflow-source revalidation do not
   begin until the App-token wrapper returns after its `onRevoked` callback has
   accepted the sanitized convergence receipt. An indeterminate revocation
   therefore prevents every post-read; and
6. uses a separate read-only job, bounded to 20 minutes, to require exactly one
   new Vercel Production deployment. The deployment and its exhaustive status
   history must bind Vercel bot `35613825`, the exact release SHA, task
   `deploy`, environment `Production`, and a
   `messagelikeme-<deployment>-hraness.vercel.app` URL. Stable terminal tag,
   Release, Latest, workflow-source, ref, inventory, and status readbacks close
   the workflow.

The successful DELETE and every accepted HTTP 200 or 401 observation require a
canonical GitHub `Date` strictly before the minted token's exact `expires_at`.
The monotonic completion of the DELETE anchors a separate 30-second half-open
request-start window `[start, deadline)`: a response completing exactly at the
deadline remains eligible, while a later completion fails. The helper may read
`/installation/repositories` at no more than the ten absolute offsets 0, 250,
500, 1,000, 2,000, 4,000, 8,000, 16,000, 24,000, and 29,000 milliseconds. A
missed slot is skipped rather than retried or shifted, and request, body, and
sleep latency all consume the same window. App identity, installation, mint,
DELETE, and observation bodies are streamed under a 1 MiB cap and scrubbed
after parsing. Every HTTP 200 must still describe
the exact singleton selected `hraness/message-like-me` repository with ID
`1342143606`. Acceptance requires two distinct scheduled HTTP 401 reads. A 200
after a 401, only one 401, any other status, a redirect, malformed or oversized
body, transport or timing ambiguity, or failure to converge within the window
fails closed. `propagationObserved=false` means the first two probes were the
stable denial pair; `true` means one or more exact authorized 200 responses
preceded the final two denials. This 30-second bound is a Message Like Me
operational ceiling, not a claim about GitHub's revocation-propagation SLA. The
action is never retried, the full App path is capped at fourteen REST requests,
and the exact production-ref post-read cannot begin until convergence has been
reported through the sanitized revocation receipt.

Any ambiguity, concurrent production deployment, missing or changed baseline
item, provider error, terminal failure, identity mismatch, ref race, status
mutation, or timeout fails the promotion closed.

Public npm and GitHub artifact admission, including the cryptographic npm
provenance audit, is repeated before the provider baseline, immediately before
and after either production-ref path, and before and after the terminal provider
outcome. A moved npm Latest tag, missing provenance, changed registry integrity,
changed immutable Release coordinate, or byte mismatch fails the current phase
closed.

## Recover provider verification

Recovery uses the same `Promote website production` workflow dispatch from the
exact current reviewed `main` workflow source while the separately peeled
annotated release commit remains in `main` history. Current-main source and
release bytes are revalidated independently before and after provider work. It
requires the
exact existing npm version and immutable artifact-complete Latest Release. It
never creates, replaces, or edits an npm version or GitHub Release.

If `website-production` still precedes the release commit, recovery performs
the same checked explicit-lease fast-forward and requires one new provider outcome.
If the ref is already exact, the baseline marks advancement false, skips the
entire `production-ref-writer-key` job, and mints no App token. A separate
read-only job accepts only the unique latest exact-SHA Production deployment in
the stable baseline that postdates the immutable Release. That newest attempt
itself must be provider-accepted. A newer terminal failure, error, or inactive
attempt blocks recovery instead of allowing an older success to be reused.
Recovery then repeats the terminal authority readbacks. A missing ref is a hard
failure and must not be recreated by the workflow.

When a tag run fails after its exact draft or immutable Release exists, preserve
its evidence and rerun that same workflow. Re-running only failed jobs is
supported: successful preflight or publisher outputs retain their own actual
attempt coordinate, while a later writer may only publish still-absent bytes or
observe exact existing bytes without mutation. The run may safely complete only
the same tag, commit, deterministic draft, and tarball; npm provenance must bind
the same run ID and an allowed actual positive attempt. Correct only the failed
control and use the website recovery path after public admission succeeds. Do
not retag, delete the immutable Release or exact residual draft, manually move
`website-production`, redeploy from Vercel, or weaken a ruleset to make the run
pass.
