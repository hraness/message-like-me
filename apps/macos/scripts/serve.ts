import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../out/demo");
const port = Number(process.env.TEXTBUTLER_PREVIEW_PORT ?? "4317");
const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const pathname = new URL(request.url).pathname;
  const name = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!["index.html", "app.js", "styles.css"].includes(name)) return new Response("Not found", { status: 404 });
  const file = Bun.file(resolve(root, name));
  if (!await file.exists()) return new Response("Build the synthetic preview first with bun run build:demo.", { status: 503 });
  return new Response(file, { headers: { "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } });
} });
console.log(`Textbutler synthetic preview: ${server.url}`);
