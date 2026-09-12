import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRuntimeBundle } from "./runtime-bundle.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await realpath(await mkdtemp(join(tmpdir(), "tb-bundle-"))); roots.push(root); return root; }

test("actual packaged entry retains the API SDK without native SDK initialization or source paths", async () => {
  const root = await fixture(), entry = fileURLToPath(new URL("./runtime-entry.ts", import.meta.url));
  const bundle = await buildRuntimeBundle(entry, root), source = await bundle.output.text();
  expect(bundle.inputs.some(path => path.includes("@anthropic-ai/sdk/"))).toBe(true);
  expect(bundle.inputs.some(path => path.includes("claude-agent-sdk") || path.endsWith("/claude-sdk.ts"))).toBe(false);
  expect(source).not.toContain("node_modules/"); expect(source).not.toContain("/Users/"); expect(source).not.toContain(root);
});

test("packaged build refuses a broad barrel that initializes the native SDK", async () => {
  const root = await fixture(), entry = join(root, "entry.ts"), barrel = fileURLToPath(new URL("../../../packages/agentrouter/src/index.ts", import.meta.url));
  await writeFile(entry, `import { AgentRouter } from ${JSON.stringify(barrel)}; export const probe = AgentRouter;\n`);
  await expect(buildRuntimeBundle(entry, join(root, "out"))).rejects.toThrow("Unqualified native agent SDK");
});
