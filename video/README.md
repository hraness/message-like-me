# TextButler launch film source

The published film comes from `story/story.config.ts`. It keeps the site's
dark palette and the coding-agent setup prompt. Its iMessage conversation is
captured from the site's `PhoneMock`, using the same immutable
`@hraness/textmockups` renderer and stylesheet as the website. Numbers and
status come from `site/app/launch/facts.ts`; every person is made up.

The older Slopcamera `launch-film` template remains available for draft work:

```sh
bun install
bun build.ts                  # out/film.html, out/scene.json, captions, beats (16:9)
bun build.ts --aspect 1:1     # square cut
bun build.ts --aspect 9:16    # native portrait cut
./node_modules/.bin/slopcamera html still  --input out/scene.json --at 2,10,18.5,27,36 --out out/stills
./node_modules/.bin/slopcamera html render --input out/scene.json --json > out/export.json
```

Renders land under `artifacts/` (ignored); `out/export.json` names the MP4.

For the published story, install the locked site and video dependencies, then
use the pinned Playwright browser rather than the native Slopcamera runtime:

```sh
PLAYWRIGHT_SKIP_BROWSER_GC=1 bun node_modules/playwright-core/cli.js install chromium
host-run --mode=shared --lane=browser --label=textbutler-story-phone -- bun run capture:story-phone
host-run --mode=shared --lane=compute --label=textbutler-film-check -- bun run check
host-run --mode=shared --lane=browser --label=textbutler-film-preview -- bun run capture:stills
host-run --mode=shared --lane=browser --label=textbutler-film -- bun run capture:publish
```

The phone capture writes `story/shared-phone.png` and its source record; commit
both with changes to the conversation. The preview writes frames under
`story/out/stills/`. The publish capture requires that exact phone image and
renderer version, checks complete device framing, renders the full film,
verifies its codec, size and duration, and copies the MP4 and poster to the
site's existing launch paths. `published-film.json` records the film, poster
and phone hashes; the site tests verify those bytes. It never launches
installed Chrome or activates the native-runtime exception. Legacy draft
captures cannot replace the published story.
