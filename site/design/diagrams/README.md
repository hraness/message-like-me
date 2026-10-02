# Launch diagrams

These are the SlopCamera sources for the TextButler launch diagrams. The rendered
files in `public/diagrams/` are derived from them and are replaced on every render.

```sh
cd site
bun run diagrams             # render every source
bun run diagrams d2-words    # render only the sources whose name starts with d2-words
```

You need SlopCamera 3.9.1 on `PATH` (or set `SLOPCAMERA_BIN`) and the Chromium
installed for the site’s pinned Playwright version. The renderer verifies its
executable, version and launch flags; it never launches system Chrome. Each
source renders four files: `<name>.light.svg`, `<name>.dark.svg`,
`<name>.light@2x.png`, and `<name>.dark@2x.png`.

| Source | Diagram | Use |
| --- | --- | --- |
| `d1-one-message-wide` / `-narrow` | One message, start to finish | How it works, blog section 3, README |
| `d2-words-{local,key,subscription}-wide` / `-narrow` | Where your words go, one file per selector state | Under the reply-writer table, blog section 4 |
| `d3-who-does-what-wide` / `-narrow` | Who does what | Setup, blog section 6 |
| `d4-five-checks` | Five checks before it speaks | Blog section 5 |

Use `-wide` at 900px and wider and `-narrow` below that. Narrow files are 400px wide,
so their text stays readable on a 360px screen. The site's figure component and the
blog/README renderer both do this swap: a Markdown image that points at a `-wide` PNG
with a matching `-narrow` file becomes a `<picture>` with a `(max-width: 899px)` source.

## Layout pattern

- **Wide:** one horizontal band, about 3:1. `d1` is 1000×332 so its 14–16px text
  stays legible when a 70ch blog column scales it down; the others are 1200 wide.
- **Narrow:** 400 wide and no taller than about 700. Stack compact numbered rows
  (badge, bold verb, one muted line) instead of tall cards joined by long arrows.
- **Steps:** at most four, each a one-word verb with a small number badge. Fold side
  effects (the `🤖{ 👀 }` acknowledgment) into the step that causes them.
- **Return paths:** one orthogonal line under the band, never a long diagonal.
- **Messages:** draw the conversation as chat bubbles with tails (received: quiet
  fill, left; sent: accent fill, right) instead of an empty phone outline.

## Files

- `*.diagram.json` holds the positioned SlopCamera source. Edit it directly.
- `slopcamera.config.json` maps SlopCamera tones to the gruvbox palette tokens the site renders (`--card`, `--primary`, `--secondary`, `--line`, `--muted`):

  | Tone | Role | Light / dark from Paper |
  | --- | --- | --- |
  | `neutral` | card | `--card`, `--line`, `--foreground` |
  | `blue` | accent: active path, checked chips, selected destination | `--primary-soft`, `--primary` |
  | `purple` | sent message bubble, selected segment | `--primary` fill, `--primary-foreground` text |
  | `yellow` | quiet fill: unselected chips, selector track, “You” lane | `--secondary` |
  | `orange` | muted: dashed boundaries, secondary text | `--control-border`, `--muted` |
  | `red` | faint: dropped messages, grid | `--line`, `--grid` |
  | `green` | unused (`--success`) | |

- `diagrams.meta.json` holds each render's accessible `<title>` and `<desc>`.

## Id conventions applied by `scripts/render-diagrams.ts`

SlopCamera's schema has no dashed strokes, per-edge widths, or layering, so the
render script applies these conventions:

- `dash-*` shapes get a dashed outline (the Your Mac boundary and optional destinations).
- `ghost-*` shapes get no outline (icon holders and toggle glyphs).
- `under-*` shapes are drawn beneath the connectors (the swimlane fills).
- `thin-*` edges are 1.25px, `dash-*` edges are dashed 1.25px, and every other edge is 1.75px.
- `bubble-in-*` and `bubble-out-*` rects become chat bubbles with a tail at the bottom
  left (received) or bottom right (sent). Use `yellow` for received and `purple` for sent.

Emoji (`🤖{ 👀 }`) render in Chrome from the system emoji font. SlopCamera's own
PNG rasterizer has no emoji font, so the script uses Chrome for the PNGs.

`slopcamera diagram check` reports `small-target`, `too-many-elements`, and a
few `short-arrow` notes. Those come from chips, bubbles, toggles, step badges, the
chevron arrows between adjacent steps, and the D3/D4 hand-off ticks, which are
deliberately small. The step badges and chat avatar also report `label-overflow`, because the
linter measures a one-digit label against an ellipse’s inner box. Every other lint class is clean.
