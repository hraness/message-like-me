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
  `main` history. A fresh dependency-free, hash-pinned job may mint its
  one-repository release App token and make
  one exact leased fast-forward only after the exact npm package and immutable,
  artifact-complete Latest GitHub Release pass external admission. Already-exact
  recovery stays read-only and outside the
  key environment. Treat `main` and pull requests as preview sources. A
  missing, divergent, force-moved, or manually advanced production ref is a
  hard release failure; follow `../docs/publishing.md` rather than recreating
  or redeploying it.
