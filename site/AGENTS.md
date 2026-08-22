# Contents

- `app/` – the public Message Like Me project page, metadata, and visual system.
- `public/` – finite site-wide images and browser assets.
- `.openai/hosting.json` – the Sites project identity and logical bindings.
- `package.json`, `vite.config.ts`, and `bun.lock` – the checked Vinext build.

# Guidelines

- Keep the page informational. It must never accept, upload, transmit, or
  request message history, contact data, study packets, profiles, or drafts.
- Keep the canonical product description exact: “A local-first CLI and Agent
  Skill for studying private messaging history and drafting messages that sound
  like you.” Route installation to the immutable GitHub release.
- Describe the CLI as local-first, bring-your-own-agent, source-aware, and
  drafts-only. Never imply that the site analyzes data or that Message Like Me
  sends messages.
- Use synthetic examples only. Do not publish real counts, labels, handles,
  excerpts, identities, private paths, or derived personal profiles.
- Use Bun 1.3.14 for installation and scripts. Run Vinext and ESLint through
  the declared Node 22-or-newer runtime; Bun can complete a Vinext build without
  emitting the application route. Run `bun run build` before publishing.
