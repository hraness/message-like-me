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
Public material on this site never references or links Message Like Me, its
package, its commands, or `messagelikeme.com`; that prototype is retired. Its
former pages (`/sources`, `/methodology`, `/research`) return a real 404,
because no current page answers their questions; add no page, link, redirect,
FAQ, metadata, or `llms.txt` entry for it. `retiredPageRedirects` in
`next.config.ts` keeps a permanent redirect only where the destination answers
the same question, such as `/compare/poke` to the comparison hub.

# Contents

- `app/` – the public TextButler project page, its docs, about, blog, and
  comparison pages, metadata, and visual system.
- `content/blog/` – blog post bodies in Markdown. Post metadata lives in
  `app/_lib/blog-posts.ts` and each post's review record in
  `app/_lib/blog-admissions.ts`; `bun run sync:readme` renders the bodies.
- `public/` – finite site-wide images and browser assets.
- `package.json`, `next.config.ts`, `postcss.config.mjs`, and `bun.lock` – the
  checked native Next.js build deployed from this directory to Vercel.
- Keep site app and test imports inside this deployment root. Film-specific
  tests belong in `../video/film.test.ts`; shared renderer assertions live in
  `scripts/phone-scene-assertions.ts`.

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
- For system-default server-rendered documents, set `data-palette` and the
  semantic `hraness-palette` class, omit `data-theme` and concrete
  `getDesignPaletteTheme` classes, and let the shared palette foundation choose
  light or dark before JavaScript. Use concrete theme classes only with a
  matching explicit `data-theme`. Keep frame-safe previews readable in both
  system appearances with scripting disabled.
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
- Never imply that the site analyzes, stores, or receives message data.
- Share images come only from the shared `@hraness/web-discovery`
  social-image template via the site's single `defineSocialImageSite`
  declaration in `app/_lib/social.ts`. Pages pass copy only (headline,
  description, eyebrow); add no per-site drawing code or static OG images.
- Use synthetic examples only. Do not publish real counts, labels, handles,
  excerpts, identities, private paths, or derived personal profiles.
- Use Bun 1.3.14 for installation and scripts and Node 24 for Next.js. Run
  `bun run check` before publishing. Production builds consume the committed
  generated documentation because the Vercel project root is this directory.
- Vercel's production branch is `main` like every other Hraness site: the
  GitHub integration deploys `main` to production automatically and pull
  requests produce previews. There is no separate promotion ref, writer
  workflow, canary, or status-authority step, and no manual deploy or dispatch
  in the routine path.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
