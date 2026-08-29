# Publish Message Like Me

Message Like Me publishes an immutable, asset-free GitHub Release before its
informational site can enter Vercel Production. The tag workflow never receives
the production-ref writer key. A separate current-`main` workflow advances the
production source after the Release succeeds, using a short-lived token from a
dedicated private Hraness GitHub App.

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
must agree. The version commit must be the current `main` head when its exact
`v<version>` tag is pushed, and that tag must be the newest stable semantic
version.

The tag-triggered Release workflow:

1. checks out the exact tag, proves it is the current merged `main` head, and
   runs the complete root, site, generated-file, packed-package, and synthetic
   macOS gates with read-only permissions; and
2. uses only the job-scoped GitHub Actions token in its short publish job to
   create and read back the exact immutable, asset-free Latest GitHub Release.

The tag workflow has no environment, App credential, provider baseline,
production-ref mutation, or provider-outcome job. A tag cannot enter
`production-ref-writer-key` because that environment admits only `main`.

After the immutable Release succeeds on its first run attempt, its completed
`workflow_run` starts `Promote website production` from current default-branch
code. Treat the entire upstream payload as untrusted. Require the exact
repository, checked numeric Release workflow ID, workflow name and path,
upstream event `push`, first attempt, successful conclusion, stable tag, head
SHA, downstream workflow SHA, and current `main` to agree. A manual
`workflow_dispatch` with an untrusted release-tag input exists only for
recovery. Both paths use the same checks. That workflow:

1. proves its workflow file, `GITHUB_REF`, `GITHUB_SHA`, current default branch,
   tag, root and site versions, immutable asset-free Latest Release, and
   release target all resolve to the same current `main` commit;
2. takes two stable, exhaustive GraphQL snapshots of at most 500 current
   `Production` deployments, including each deployment's current state and
   `latestStatus`, bracketed by authenticated GitHub server time and exact
   `website-production` ref reads;
3. enters `production-ref-writer-key` with `deployment:false` only when the
   baseline proves that the ref must advance. A checked local helper signs a
   bounded RS256 App JWT, authenticates the exact App ID, client ID, slug, and
   organization owner, then reads the checked installation ID and requires its
   selected `hraness` account plus exact `contents:write` and `metadata:read`
   permission closure. It then POSTs one token request with literal
   `repository_ids: [1342143606]` and only those permissions;
4. fails closed unless the mint response contains exactly that numeric
   repository, selected-repository scope, those two permissions, and a
   canonical expiry within the authenticated one-hour response window. It
   masks the token before use, keeps it out of workflow outputs, and revokes it
   through `DELETE /installation/token` in the same operation's `finally`
   boundary. A mutation failure and a revocation failure are both retained;
5. sandwiches the mutation with immutable Release, Latest, tag, current-`main`,
   and workflow-source readbacks; proves `website-production` can fast-forward;
   then uses authenticated Git over a fixed HTTPS remote to push exactly
   `<verified-sha>:refs/heads/website-production` with
   `--force-with-lease=refs/heads/website-production:<expected-old-sha>`. The
   token stays out of URLs, argv, and Git config behind a bounded temporary
   `GIT_ASKPASS` helper, prompting is disabled, global and system configuration
   are disabled, hooks and tags are disabled, cleanup is trapped, and a stale
   lease fails without mutation. Read-only singular REST ref reads before and
   after the push use the job's read-only GitHub Actions token; and
6. uses a separate read-only job, bounded to 20 minutes, to require exactly one
   new Vercel Production deployment. The deployment and its exhaustive status
   history must bind Vercel bot `35613825`, the exact release SHA, task
   `deploy`, environment `Production`, and a
   `messagelikeme-<deployment>-hraness.vercel.app` URL. Stable terminal tag,
   Release, Latest, workflow-source, ref, inventory, and status readbacks close
   the workflow.

Any ambiguity, concurrent production deployment, missing or changed baseline
item, provider error, terminal failure, identity mismatch, ref race, status
mutation, or timeout fails the promotion closed.

## Recover provider verification

Recovery uses the same `Promote website production` workflow dispatch from the
exact release commit while that commit is still current `main`. It requires the
exact existing immutable Latest Release. It never creates, replaces, or edits a
GitHub Release.

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

When a run fails after the immutable Release exists, preserve its evidence,
correct only the failed control, and use this recovery path. Do not retag,
delete the immutable Release, manually move `website-production`, redeploy from
Vercel, or weaken a ruleset to make the run pass.
