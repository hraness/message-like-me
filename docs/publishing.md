# Publish Message Like Me

Message Like Me publishes an immutable, asset-free GitHub Release before its
informational site can enter Vercel Production. The Release workflow is the
only routine writer for the production source branch. It uses the repository's
GitHub Actions token and does not require a personal access token, a Vercel
token, or broader repository permissions.

## Establish the production controls once

Apply these controls in order. Record the exact readbacks in the change review.
Do not merge a product or version change until every control is active.

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
4. Add two active repository rulesets whose sole ref target is
   `refs/heads/website-production`:
   - A no-bypass ruleset blocks creation, deletion, and non-fast-forward
     updates. It prevents recreation or force movement after the bootstrap.
   - A separate update ruleset blocks ordinary updates and gives only GitHub
     Integration `15368` an `always` bypass. Set
     `update_allows_fetch_and_merge=false`. This makes the Release workflow's
     GitHub Actions identity the sole routine fast-forward writer.
5. Add a separate active `main` ruleset requiring pull requests, the exact CI
   checks used by this repository, and protection from deletion and
   non-fast-forward updates. Keep bypasses empty unless a separately reviewed
   recovery procedure proves a narrower actor is required.

After setup, read back the exact Vercel production branch and both GitHub ref
rulesets. The Message Like Me post-control record must prove all of these
assertions together:

- `main` is the exact reviewed merge commit for this control change;
- `website-production` exists at that same commit before its rulesets become
  active;
- the no-bypass ruleset contains only creation, deletion, and
  non-fast-forward protection for that exact ref;
- the update ruleset contains only the update restriction for that exact ref,
  has Integration `15368` as its sole `always` bypass, and reports
  `update_allows_fetch_and_merge=false`;
- the Vercel project reads back
  `link.productionBranch=website-production`, while its project root, build,
  install, Git, domain, environment, and deployment settings remain identical
  to the pre-control snapshot; and
- a later `main` push creates no Vercel Production deployment.

Also read back the separate `main` ruleset and prove its pull-request, exact CI,
deletion, and non-fast-forward requirements. The control change deliberately
retains version `0.8.0` and changes no product claim, dependency, lockfile, or
generated documentation.

Keep the first later product release in a separate pull request based on this
exact control head. That product pull request must not change
`.github/workflows/`, the provider helper, or these controls. This separation
keeps the reviewed control lineage intact and avoids requiring workflow-write
authority for the product replay.

## Publish a stable release

Prepare one stable version commit through a pull request. The root package,
site package, source version, README install target, and generated site content
must agree. The version commit must be the current `main` head when its exact
`v<version>` tag is pushed, and that tag must be the newest stable semantic
version.

The tag-triggered Release workflow then:

1. checks out the exact tag, proves it is the current merged `main` head, and
   runs the complete root, site, generated-file, packed-package, and synthetic
   macOS gates with read-only permissions;
2. takes two stable, exhaustive GraphQL snapshots of at most 500 current
   `Production` deployments, including each deployment's current state and
   `latestStatus`, bracketed by authenticated GitHub server time and exact
   `website-production` ref reads;
3. creates and reads back the exact immutable, asset-free Latest GitHub
   Release;
4. proves `website-production` can fast-forward to the verified release commit,
   sends one non-force update through the plural ref endpoint, and reads the
   singular ref back exactly; and
5. uses a separate read-only job, bounded to 20 minutes, to require exactly one
   new Vercel Production deployment. The deployment and its exhaustive status
   history must bind Vercel bot `35613825`, the exact release SHA, task
   `deploy`, environment `Production`, and a
   `messagelikeme-<deployment>-hraness.vercel.app` URL. Stable terminal tag,
   Release, Latest, workflow-source, ref, inventory, and status readbacks close
   the workflow.

Any ambiguity, concurrent production deployment, missing or changed baseline
item, provider error, terminal failure, identity mismatch, ref race, status
mutation, or timeout fails the release closed.

## Recover provider verification

Use the Release workflow's `workflow_dispatch` input only from the current
`main` head and only for the exact existing Latest tag. Recovery never creates
or replaces a GitHub Release. It requires that Release to remain published,
immutable, asset-free, and Latest before it considers the production ref.

If `website-production` still precedes the release commit, recovery performs
the same checked non-force fast-forward and requires one new provider outcome.
If the ref is already exact, recovery does not write it. It accepts only the
unique latest exact-SHA Production deployment in the stable baseline that
postdates the immutable Release. That newest attempt itself must be
provider-accepted. A newer terminal failure, error, or inactive attempt blocks
recovery instead of allowing an older success to be reused. Recovery then
repeats the terminal authority readbacks. A missing ref is a hard failure and
must not be recreated by the workflow.

When a run fails after the immutable Release exists, preserve its evidence,
correct only the failed control, and use this recovery path. Do not retag,
delete the immutable Release, manually move `website-production`, redeploy from
Vercel, or weaken a ruleset to make the run pass.
