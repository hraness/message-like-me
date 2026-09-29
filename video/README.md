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

The site still embeds the earlier hand-made film
(`site/public/launch/textbutler-launch.mp4`). This source does not replace it
yet: the product stage frames the phone partly off camera while it moves
across the Mac-side panels, so it needs a layout pass before its cuts ship.
