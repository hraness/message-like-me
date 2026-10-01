# Textbutler rebrand

The owner authorized replacing the unused Message Like Me product with
Textbutler at `textbutler.app`. The current rebrand overrides historical product
name, description, and drafts-only marketing instructions below. Describe the
headless daemon and its CLI and guided terminal, contact-scoped memory,
selected coding agent, and disclosed responses. Textbutler has no menu bar
companion or desktop window. Write the homepage and launch post around the
supported product and its benefits. Use `SITE_STATUS` from `app/_lib/site.ts`
for the one concise macOS/setup note; do not add development badges, live-test
caveats, or generic illustration captions. Keep necessary feature and setup
conditions in concise supporting copy beside the claim, and keep qualification,
admission, composition and custody vocabulary off the pages. Verify capabilities
and the supported installation path before making public claims.
Retained Message Like Me source documentation describes the legacy history
reader. Preserve immutable artifact versions and the production delivery gates
below until their reviewed publication-identity migration is complete.

# Contents

- `app/` – the public Textbutler project page, its legacy Message Like Me pages,
  metadata, and visual system.
- `content/blog/` – blog post bodies in Markdown. Post metadata lives in
  `app/_lib/blog-posts.ts` and each post's review record in
  `app/_lib/blog-admissions.ts`; `bun run sync:readme` renders the bodies.
- `public/` – finite site-wide images and browser assets.
- `package.json`, `next.config.ts`, `postcss.config.mjs`, and `bun.lock` – the
  checked native Next.js build deployed from this directory to Vercel.

# Guidelines

- Combine precompiled UI, Design Kit and footer recipes through the shared
  compiler's manifest-checked rule union in `stylex.config.mjs` and PostCSS.
  Import each package's `compiler-foundation.css`; never concatenate its
  standalone `styles.css`, `stylex.css`, or an entry such as `palettes.css`
  that imports those recipes. Keep one union after all foundations. Product
  CSS must not repair shared atomic-class collisions with local breakpoints.
  This site does not author local StyleX recipes; that requires the shared
  compiler's complete application-graph adapter rather than this package-only
  integration.
- Use the shared split hero and split sections to place product proof beside
  the copy on wide screens and after it on phones. Crop phone mockups through
  the `PhoneMock` component's crop prop, preserving device proportions and
  keeping complete example replies above the fade. Keep playback controls
  outside the cropped viewport; export stills and films retain complete devices.
- Provider cards must reflow from icon beside copy to icon above copy when the
  available reading width is tight, including enlarged text. Base wrapping on
  the card’s available width; keep full-size marks and complete copy without
  ellipsis, clipping, or smaller text to force a fit.
- Keep the page informational. It must never accept, upload, transmit, or
  request message history, contact data, study packets, profiles, or drafts.
- Where the site describes the legacy Message Like Me package, keep its
  description exact: “A local-first CLI and Agent Skill for studying private
  messaging history and drafting messages that sound like you.” Route legacy
  installation to the exact public npm version and its immutable GitHub
  artifact mirror.
- Describe the legacy Message Like Me CLI as local-first, bring-your-own-agent,
  source-aware, and drafts-only. Never imply that the site analyzes data or that
  Message Like Me sends messages.
- Share images come only from the shared `@hraness/web-discovery`
  social-image template via the site's single `defineSocialImageSite`
  declaration in `app/_lib/social.ts`. Pages pass copy only (headline,
  description, eyebrow); add no per-site drawing code or static OG images.
- Use synthetic examples only. Do not publish real counts, labels, handles,
  excerpts, identities, private paths, or derived personal profiles.
- Use Bun 1.3.14 for installation and scripts and Node 24 for Next.js. Run
  `bun run check` before publishing. Production builds consume the committed
  generated documentation because the Vercel project root is this directory.
- Keep Vercel Production Branch on `website-production`. The dedicated
  current-`main` production workflow is the sole routine writer of that
  established ref for an immutable annotated release commit in reviewed
  `main` history. A fresh dependency-free, hash-pinned job may mint a
  one-repository `statuses:write` plus `metadata:read` App token only after
  complete history proves either a no-digest range that preserves the
  production baseline's `.github/workflows` tree, or an exact independently
  reviewed v2 receipt and digest for every ordered workflow-tree transition,
  and after the exact npm package and immutable, artifact-complete Latest GitHub
  Release pass external admission.
  The App is the ruleset-pinned source of one exact-SHA success status and has
  no ref-write permission or bypass. Its success token is revoked before the
  writer moves the ref. Before success exists, the exact App context is read
  back as terminal `error`, and the writer-denial proof accepts only one exact
  GH013 violation payload for the protected ref plus one exact `remote: -`
  reason for the context ending `is errored.`. Before exact comparison, normalize
  only one consistent known Git non-TTY display suffix: zero, one, or eight
  ASCII spaces on both semantic remote lines. Reject every other trailing byte,
  suffix length, or mixed framing. Mutable Git progress, transport
  ordering, and helper-label framing are not proof; the fixed writer command
  binds the operation. `is expected`, missing-status, ambiguous, or differently
  bound semantic payloads are not acceptable evidence. The same job's scoped `GITHUB_TOKEN`
  makes one exact leased fast-forward. A fresh status-only token
  then consumes the authorization with a proven terminal
  non-success status and is revoked separately. A workflow-control epoch uses
  the publishing runbook's transition-scoped v2 digest: a no-digest attempt
  fails before key admission and publishes the complete ordered commit and
  workflow-tree inventory; a fresh manual attempt-1 dispatch may carry only the
  independently reviewed exact digest and must recompute it before and after
  environment admission. It never expands the status App, uses a temporary
  broad credential, or moves the ref out of band. Already-exact recovery stays
  read-only and outside the key environment. Treat `main` and pull requests as
  preview sources. If an interrupted writer may leave success current, freeze
  both writer workflows and follow the target-bound, 36-day-inventory,
  65-minute-quarantine terminal cleanup. A hard cancellation may leave no
  receipt and starts a fresh quarantine. Incomplete or absent evidence never
  permits a retry. A
  missing, divergent, force-moved, or manually advanced production ref is a
  hard release failure; follow `../docs/publishing.md` rather than recreating
  or redeploying it.
