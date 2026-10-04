# TextButler launch film source

The launch film, rebuilt from source with the Slopcamera `launch-film`
template. The product surfaces are the site's own mockup components
(`site/app/mockups` and `site/app/_components/phone`), and every number and
the status line come from `site/app/launch/facts.ts` through `facts.ts`.
Every person in it is made up.

```sh
bun install
bun build.ts                  # out/film.html, out/scene.json, captions, beats (16:9)
bun build.ts --aspect 1:1     # square cut
bun build.ts --aspect 9:16    # native portrait cut
./node_modules/.bin/slopcamera html still  --input out/scene.json --at 2,10,18.5,27,36 --out out/stills
./node_modules/.bin/slopcamera html render --input out/scene.json --json > out/export.json
```

Renders land under `artifacts/` (ignored); `out/export.json` names the MP4.

The site film is generated from these sources, including the same
`@hraness/textmockups` phone and stylesheet used on the site. The phone stays
fully framed during its scene and fades out before the camera moves across the
Mac-side panels.

For ordinary browser captures, install the site and video dependencies, then
use the pinned Playwright browser rather than the native Slopcamera runtime:

```sh
PLAYWRIGHT_SKIP_BROWSER_GC=1 bun node_modules/playwright-core/cli.js install chromium
bun run check
host-run --mode=shared --lane=browser --label=textbutler-film-preview -- bun run capture:stills
host-run --mode=shared --lane=browser --label=textbutler-film -- bun run capture:publish
```

The first capture writes preview frames under `out/stills/`. The publish
capture checks complete phone framing, renders the full film, verifies its
codec, size and duration, and copies the MP4 and poster to the site's existing
launch paths. `published-film.json` records their hashes and renderer version;
the site tests verify those bytes. It never launches installed Chrome or
activates the native-runtime exception.
