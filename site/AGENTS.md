# Contents

- `app/` – the public Message Like Me project page, metadata, and visual system.
- `public/` – finite site-wide images and browser assets.
- `package.json`, `next.config.ts`, `postcss.config.mjs`, and `bun.lock` – the
  checked native Next.js build deployed from this directory to Vercel.

# Guidelines

- Keep the page informational. It must never accept, upload, transmit, or
  request message history, contact data, study packets, profiles, or drafts.
- Keep the canonical product description exact: “A local-first CLI and Agent
  Skill for studying private messaging history and drafting messages that sound
  like you.” Route installation to the exact public npm version and its
  immutable GitHub artifact mirror.
- Describe the CLI as local-first, bring-your-own-agent, source-aware, and
  drafts-only. Never imply that the site analyzes data or that Message Like Me
  sends messages.
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
  complete history proves every newly reachable commit preserves the
  production baseline's `.github/workflows` tree and the exact npm package and
  immutable, artifact-complete Latest GitHub Release pass external admission.
  The App is the ruleset-pinned source of one exact-SHA success status and has
  no ref-write permission or bypass. Its success token is revoked before the
  same job's scoped `GITHUB_TOKEN` makes one exact leased fast-forward. A fresh
  status-only token then consumes the authorization with a proven terminal
  non-success status and is revoked separately. A workflow-control
  epoch uses the separately approved bootstrap, permanent App downgrade, and
  key rotation in the publishing runbook. Already-exact recovery stays
  read-only and outside the key environment. Treat `main` and pull requests as
  preview sources. If an interrupted writer may leave success current, freeze
  both writer workflows and follow the target-bound, 36-day-inventory,
  65-minute-quarantine terminal cleanup. A hard cancellation may leave no
  receipt and starts a fresh quarantine. Incomplete or absent evidence never
  permits a retry. A
  missing, divergent, force-moved, or manually advanced production ref is a
  hard release failure; follow `../docs/publishing.md` rather than recreating
  or redeploying it.
