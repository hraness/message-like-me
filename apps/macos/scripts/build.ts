import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const mode = process.argv.includes("--demo") ? "demo" : "native";
const out = resolve(root, "out", mode);
await mkdir(out, { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(root, `src/${mode}-main.ts`)], outdir: out, naming: "app.js", target: "browser", minify: true });
if (!result.success) throw new AggregateError(result.logs, "Desktop frontend build failed.");
await copyFile(resolve(root, "src/styles.css"), resolve(out, "styles.css"));
await writeFile(resolve(out, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Textbutler${mode === "demo" ? " — Synthetic preview" : ""}</title><link rel="stylesheet" href="./styles.css"></head><body><div id="app"></div><script type="module" src="./app.js"></script></body></html>`);
if (mode === "native") {
  const source = await Bun.file(resolve(out, "app.js")).text();
  for (const marker of ["synthetic-alex", "Sample contact · iMessage", "Preview change saved", "createDemoPort"]) {
    if (source.includes(marker)) throw new Error(`Synthetic preview implementation reached native output: ${marker}`);
  }
}
console.log(`Built Textbutler ${mode} webview: ${out}`);
