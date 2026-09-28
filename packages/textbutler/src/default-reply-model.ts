import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { publishPrivateFile } from "@hraness/local-custody/atomic-publish";
import { assertOwnedPath } from "@hraness/local-custody/private-paths";
import type { HabitatHostConfig } from "./host-config.ts";

/** The out-of-box reply model: Qwen 3.5 Flash through the owner's own Vercel
 * AI Gateway key. Saving a key under this name is the only setup needed; an
 * explicit `habitat` block in host.json always takes precedence. */
export const DEFAULT_GATEWAY_CREDENTIAL = "vercel-ai-gateway";
export const DEFAULT_REPLY_MODEL = Object.freeze({ id: "alibaba/qwen3.5-flash", label: "Qwen 3.5 Flash", via: "Vercel AI Gateway" });
const MAX_KEY_BYTES = 4096;

export function defaultHabitatConfig(): HabitatHostConfig {
  return Object.freeze({
    enabled: true,
    driver: Object.freeze({ kind: "gateway" as const, model: DEFAULT_REPLY_MODEL.id as "alibaba/qwen3.5-flash", credentialFile: DEFAULT_GATEWAY_CREDENTIAL, dailyBudgetUsd: 1 }),
    evolutionModel: null,
    debounceMs: 1500,
  });
}

const credentialDirectory = (dataDir: string): string => join(dataDir, "state", "provider-credentials");

/** True only for an owner-only regular key file in an owner-only directory. */
export async function gatewayKeyPresent(dataDir: string): Promise<boolean> {
  try {
    await assertOwnedPath(credentialDirectory(dataDir), { kind: "directory", canonical: true, ownerOnly: true });
    await assertOwnedPath(join(credentialDirectory(dataDir), DEFAULT_GATEWAY_CREDENTIAL), { kind: "file", exactMode: 0o600, links: 1 });
    return true;
  } catch { return false; }
}

/** A gateway key is one printable token; anything else is refused before it is stored. */
export function parseGatewayKey(value: string): string {
  const key = value.trim();
  if (key.length === 0) throw new Error("No key was provided.");
  if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES || !/^[\x21-\x7e]+$/u.test(key)) throw new Error("That doesn't look like a Vercel AI Gateway key: it should be one line with no spaces.");
  return key;
}

/** Stores the key owner-only (directory 0700, file 0600), replacing any earlier key atomically. */
export async function saveGatewayKey(dataDir: string, value: string): Promise<void> {
  const key = parseGatewayKey(value);
  const directory = credentialDirectory(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await assertOwnedPath(directory, { kind: "directory", canonical: true, ownerOnly: true });
  await publishPrivateFile(directory, DEFAULT_GATEWAY_CREDENTIAL, `${key}\n`);
}

export type EffectiveHabitat =
  | Readonly<{ state: "configured" | "default"; config: HabitatHostConfig }>
  | Readonly<{ state: "disabled" | "no-key" | "unadmitted" }>;

/** Which reply writer the daemon runs: an explicit host.json block as written,
 * otherwise the default Qwen route once its key is saved. The default never
 * blocks startup: an unadmitted source build simply runs without it. */
export async function effectiveHabitat(host: Readonly<{ habitat?: HabitatHostConfig }>, dataDir: string, admitted: boolean): Promise<EffectiveHabitat> {
  if (host.habitat !== undefined) return host.habitat.enabled ? { state: "configured", config: host.habitat } : { state: "disabled" };
  if (!await gatewayKeyPresent(dataDir)) return { state: "no-key" };
  return admitted ? { state: "default", config: defaultHabitatConfig() } : { state: "unadmitted" };
}
