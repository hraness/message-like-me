import { requireValue } from "../distribution/common.ts";

/** The shipped daemon uses the explicit API adapter. Native coding-agent SDKs
 * remain separately qualified source and must not initialize through a barrel. */
export async function buildRuntimeBundle(entrypoint: string, outdir: string) {
  const build = await Bun.build({ entrypoints: [entrypoint], outdir, naming: "cli.ts", target: "bun", sourcemap: "none", metafile: true,
    // Bun's module-location comments contain source dependency paths. Omit those
    // comments without renaming identifiers or changing expression syntax.
    minify: { whitespace: true, syntax: false, identifiers: false } });
  requireValue(build.success && build.outputs.length === 1 && build.metafile, "Textbutler CLI bundle failed");
  const inputs = Object.keys(build.metafile.inputs);
  requireValue(!inputs.some(path => /(?:^|\/)(?:@anthropic-ai\/claude-agent-sdk(?:\/|$)|claude-sdk\.ts$)/u.test(path)), "Unqualified native agent SDK entered the packaged runtime");
  return { output: build.outputs[0]!, inputs };
}
