/**
 * Lets the film render the site's CSS-module components outside Next.js.
 *
 * Next hashes `.module.css` class names; Bun's runtime does not load them at
 * all. This plugin maps each class to a stable `tbf-<name>` and returns the
 * matching stylesheet, so the film uses the same component markup and styles
 * the site does.
 */
import { readFileSync } from "node:fs";
import { plugin } from "bun";

const PREFIX = "tbf-";
const sheets = new Map<string, string>();

/** Prefixes class selectors, leaving strings, url() values and numbers alone. */
export function scopeCss(css: string): string {
  const kept: string[] = [];
  const hold = (match: string) => `\u0000${String(kept.push(match) - 1)}\u0000`;
  const masked = css
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/gu, hold)
    .replace(/"[^"]*"|'[^']*'/gu, hold);
  const scoped = masked.replace(/\.(-?[A-Za-z_][\w-]*)/gu, (_, name: string) => `.${PREFIX}${name}`);
  return scoped.replace(/\u0000(\d+)\u0000/gu, (_, index: string) => kept[Number(index)]!);
}

plugin({
  name: "textbutler-film-css-modules",
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/u }, ({ path }) => {
      if (!sheets.has(path)) sheets.set(path, scopeCss(readFileSync(path, "utf8")));
      return {
        loader: "js",
        contents: `export default new Proxy({}, { get: (_, key) => typeof key === "string" ? ${JSON.stringify(PREFIX)} + key : undefined });`,
      };
    });
    build.onLoad({ filter: /\.css$/u }, () => ({ loader: "js", contents: "export default {};" }));
  },
});

/** Every CSS module the rendered components loaded, scoped to match their markup. */
export function moduleCss(): string {
  return [...sheets.values()].join("\n");
}
