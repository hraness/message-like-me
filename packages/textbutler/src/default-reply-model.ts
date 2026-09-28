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
/** The out-of-box local route: an OpenAI-compatible server on loopback that
 * already serves the pinned model — no key needed. Detection is one bounded
 * probe at daemon start; it never installs or downloads anything. */
export const DEFAULT_LOCAL_MODEL = "qwen3:4b-instruct-2507-q4_K_M";
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:11434/v1";
const MAX_KEY_BYTES = 4096;

export function defaultHabitatConfig(): HabitatHostConfig {
  return Object.freeze({
    enabled: true,
    driver: Object.freeze({ kind: "gateway" as const, model: DEFAULT_REPLY_MODEL.id as "alibaba/qwen3.5-flash", credentialFile: DEFAULT_GATEWAY_CREDENTIAL, dailyBudgetUsd: 1 }),
    evolutionModel: null,
    debounceMs: 1500,
  });
}

function defaultLocalHabitatConfig(searchCredentialFile: string | undefined): HabitatHostConfig {
  return Object.freeze({
    enabled: true,
    driver: Object.freeze({ kind: "local" as const, model: DEFAULT_LOCAL_MODEL, baseUrl: DEFAULT_LOCAL_BASE_URL,
      ...(searchCredentialFile === undefined ? {} : { searchCredentialFile }) }),
    evolutionModel: null,
    debounceMs: 1500,
  });
}

/** One bounded probe: the pinned model must appear in the server's own model
 * list. Any refusal, redirect, timeout or unexpected body leaves it off. */
export async function defaultLocalModelServed(fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${DEFAULT_LOCAL_BASE_URL}/models`, { signal: AbortSignal.timeout(1500), redirect: "error" });
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text) > 262_144) return false;
    const body: unknown = JSON.parse(text);
    const data = typeof body === "object" && body !== null && "data" in body ? (body as { data: unknown }).data : undefined;
    return Array.isArray(data) && data.some(entry => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === DEFAULT_LOCAL_MODEL);
  } catch { return false; }
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

/** An existing gateway credential a local reply driver can reuse for web
 * search: the explicit "habitat-gateway" file first, then the default name. */
export async function localSearchCredential(dataDir: string): Promise<string | undefined> {
  try {
    await assertOwnedPath(credentialDirectory(dataDir), { kind: "directory", canonical: true, ownerOnly: true });
    for (const name of ["habitat-gateway", DEFAULT_GATEWAY_CREDENTIAL]) {
      try { await assertOwnedPath(join(credentialDirectory(dataDir), name), { kind: "file", exactMode: 0o600, links: 1 }); return name; }
      catch { /* try the next credential name */ }
    }
  } catch { /* no credential directory */ }
  return undefined;
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
 * otherwise the default Qwen route once its key is saved, otherwise the pinned
 * local model when a loopback server already serves it. The default never
 * blocks startup: an unadmitted source build simply runs without it. */
export async function effectiveHabitat(host: Readonly<{ habitat?: HabitatHostConfig }>, dataDir: string, admitted: boolean, probeLocal: () => Promise<boolean> = defaultLocalModelServed): Promise<EffectiveHabitat> {
  if (host.habitat !== undefined) return host.habitat.enabled ? { state: "configured", config: host.habitat } : { state: "disabled" };
  if (await gatewayKeyPresent(dataDir)) return admitted ? { state: "default", config: defaultHabitatConfig() } : { state: "unadmitted" };
  if (await probeLocal()) return admitted ? { state: "default", config: defaultLocalHabitatConfig(await localSearchCredential(dataDir)) } : { state: "unadmitted" };
  return { state: "no-key" };
}
