import { afterEach, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_GATEWAY_CREDENTIAL, defaultHabitatConfig, effectiveHabitat, gatewayKeyPresent, parseGatewayKey, saveGatewayKey } from "./default-reply-model.ts";
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
  const explicit = { ...defaultHabitatConfig(), driver: { kind: "local" as const, model: "synthetic", baseUrl: "http://127.0.0.1:1234/v1" } };
  expect(await effectiveHabitat({ habitat: explicit }, root, false)).toEqual({ state: "configured", config: explicit });
  expect(await effectiveHabitat({ habitat: { ...explicit, enabled: false } }, root, true)).toEqual({ state: "disabled" });
  expect(await effectiveHabitat({}, root, true)).toEqual({ state: "no-key" });
  await saveGatewayKey(root, "vck_key");
  expect(await effectiveHabitat({}, root, true)).toEqual({ state: "default", config: defaultHabitatConfig() });
  expect(await effectiveHabitat({}, root, false)).toEqual({ state: "unadmitted" });
  // A key never overrides an owner's explicit choice to turn the writer off.
  expect(await effectiveHabitat({ habitat: { ...explicit, enabled: false } }, root, true)).toEqual({ state: "disabled" });
});
