import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GATEWAY_CREDENTIAL, DEFAULT_LOCAL_BASE_URL, DEFAULT_LOCAL_MODEL, defaultHabitatConfig, defaultLocalModelServed, effectiveHabitat, gatewayKeyPresent, localSearchCredential, parseGatewayKey, saveGatewayKey } from "./default-reply-model.ts";
import { parseFastDriverConfig } from "./fast-driver.ts";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function dataDir() { const root = await realpath(await mkdtemp(join(tmpdir(), "tb-default-model-"))); roots.push(root); await mkdir(join(root, "state"), { mode: 0o700 }); return root; }
const keyPath = (root: string) => join(root, "state", "provider-credentials", DEFAULT_GATEWAY_CREDENTIAL);

test("the out-of-box reply writer is Qwen 3.5 Flash through the gateway, capped at $1 a day", () => {
  const config = defaultHabitatConfig();
  expect(config).toEqual({ enabled: true, driver: { kind: "gateway", model: "alibaba/qwen3.5-flash", credentialFile: "vercel-ai-gateway", dailyBudgetUsd: 1 }, evolutionModel: null, debounceMs: 1500 });
  // The default passes the same strict driver validation as a hand-written host.json.
  expect(parseFastDriverConfig(config.driver)).toEqual(config.driver);
});

test("a saved key is owner-only, replaces an earlier key, and bad keys are refused before storage", async () => {
  const root = await dataDir();
  expect(await gatewayKeyPresent(root)).toBe(false);
  await saveGatewayKey(root, "  vck_first-key\n");
  expect(await readFile(keyPath(root), "utf8")).toBe("vck_first-key\n");
  expect((await lstat(keyPath(root))).mode & 0o777).toBe(0o600);
  expect((await lstat(join(root, "state", "provider-credentials"))).mode & 0o777).toBe(0o700);
  expect(await gatewayKeyPresent(root)).toBe(true);
  await saveGatewayKey(root, "vck_second-key");
  expect(await readFile(keyPath(root), "utf8")).toBe("vck_second-key\n");
  for (const bad of ["", "   \n", "two words", "line\nbreak", "x".repeat(4097)]) expect(() => parseGatewayKey(bad)).toThrow();
  await expect(saveGatewayKey(root, "has space")).rejects.toThrow("one line with no spaces");
  expect(await readFile(keyPath(root), "utf8")).toBe("vck_second-key\n");
  // A key file others can read is not treated as present.
  await chmod(keyPath(root), 0o644);
  expect(await gatewayKeyPresent(root)).toBe(false);
});

test("an explicit host.json habitat wins; otherwise the default runs only with a saved key in an admitted build", async () => {
  const root = await dataDir();
  const off = async () => false;
  const explicit = { ...defaultHabitatConfig(), driver: { kind: "local" as const, model: "synthetic", baseUrl: "http://127.0.0.1:1234/v1" } };
  expect(await effectiveHabitat({ habitat: explicit }, root, false, off)).toEqual({ state: "configured", config: explicit });
  expect(await effectiveHabitat({ habitat: { ...explicit, enabled: false } }, root, true, off)).toEqual({ state: "disabled" });
  expect(await effectiveHabitat({}, root, true, off)).toEqual({ state: "no-key" });
  await saveGatewayKey(root, "vck_key");
  expect(await effectiveHabitat({}, root, true, off)).toEqual({ state: "default", config: defaultHabitatConfig() });
  expect(await effectiveHabitat({}, root, false, off)).toEqual({ state: "unadmitted" });
  // A key never overrides an owner's explicit choice to turn the writer off.
  expect(await effectiveHabitat({ habitat: { ...explicit, enabled: false } }, root, true, off)).toEqual({ state: "disabled" });
});

test("with no gateway key, a loopback server already serving the pinned model becomes the default", async () => {
  const root = await dataDir();
  const on = async () => true;
  expect(await effectiveHabitat({}, root, true, on)).toEqual({ state: "default", config: { enabled: true, driver: { kind: "local", model: DEFAULT_LOCAL_MODEL, baseUrl: DEFAULT_LOCAL_BASE_URL }, evolutionModel: null, debounceMs: 1500 } });
  // An unadmitted build stays silent even when the model is right there.
  expect(await effectiveHabitat({}, root, false, on)).toEqual({ state: "unadmitted" });
  // A saved key still wins: the gateway default keeps replies and search together.
  await saveGatewayKey(root, "vck_key");
  expect(await effectiveHabitat({}, root, true, on)).toEqual({ state: "default", config: defaultHabitatConfig() });
});

test("the local default reuses an existing gateway credential for web search", async () => {
  const root = await dataDir();
  await mkdir(join(root, "state", "provider-credentials"), { mode: 0o700 });
  await writeFile(join(root, "state", "provider-credentials", "habitat-gateway"), "vck_search\n", { mode: 0o600 });
  const selected = await effectiveHabitat({}, root, true, async () => true);
  if (selected.state !== "default") throw Error("unreachable");
  expect(selected.config.driver).toEqual({ kind: "local", model: DEFAULT_LOCAL_MODEL, baseUrl: DEFAULT_LOCAL_BASE_URL, searchCredentialFile: "habitat-gateway" });
  // A world-readable credential is not borrowed.
  await chmod(join(root, "state", "provider-credentials", "habitat-gateway"), 0o644);
  expect(await localSearchCredential(root)).toBeUndefined();
});

test("the local-model probe only accepts a served pinned model over loopback", async () => {
  const list = (ids: string[]) => new Response(JSON.stringify({ object: "list", data: ids.map(id => ({ id, object: "model" })) }), { status: 200 });
  expect(await defaultLocalModelServed(async () => list([DEFAULT_LOCAL_MODEL]))).toBe(true);
  expect(await defaultLocalModelServed(async () => list(["other:model"]))).toBe(false);
  expect(await defaultLocalModelServed(async () => list([]))).toBe(false);
  expect(await defaultLocalModelServed(async () => new Response("nope", { status: 503 }))).toBe(false);
  expect(await defaultLocalModelServed(async () => new Response("{", { status: 200 }))).toBe(false);
  expect(await defaultLocalModelServed(async () => { throw Error("connection refused"); })).toBe(false);
});
