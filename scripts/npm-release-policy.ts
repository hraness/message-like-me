function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

async function boundedJson(response: Response, label: string): Promise<unknown> {
  const maximumBytes = 64 * 1_024;
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) throw new Error(`${label} response body exceeded its bound.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error(`${label} did not return JSON.`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error(`${label} returned no response body.`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximumBytes) throw new Error(`${label} response body exceeded its bound.`);
      chunks.push(item.value);
    }
  } finally {
    try { await reader.cancel(); } catch { /* parsing result remains authoritative */ }
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

export function registryVersionUrl(packageName: string, version: string): string {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
    throw new Error("The public package name must be a normalized npm scope coordinate.");
  }
  if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error("The public package version must be semantic.");
  }
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;
}

export async function registryVersionIntegrity(
  response: Response,
  packageName: string,
  version: string,
): Promise<string | null> {
  const payload = await registryVersionMetadata(response, packageName, version);
  if (payload === null) return null;
  const dist = record(payload.dist, `${packageName}@${version} registry version dist`);
  if (typeof dist.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(dist.integrity)) {
    throw new Error(`${packageName}@${version} registry version returned an invalid immutable integrity.`);
  }
  return dist.integrity;
}

export async function registryVersionMetadata(
  response: Response,
  packageName: string,
  version: string,
): Promise<Record<string, unknown> | null> {
  const label = `${packageName}@${version} registry version`;
  if (response.status === 404) {
    const payload = await boundedJson(response, label);
    const absent = payload === "Not Found"
      || payload === `version not found: ${version}`
      || (
        typeof payload === "object"
        && payload !== null
        && !Array.isArray(payload)
        && Object.keys(payload).length === 1
        && ["Not Found", "Not found"].includes(String((payload as Record<string, unknown>).error))
      );
    if (!absent) {
      throw new Error(`${label} returned an invalid missing-version response.`);
    }
    return null;
  }
  if (response.status !== 200) throw new Error(`${label} returned HTTP ${String(response.status)}.`);
  const payload = record(await boundedJson(response, label), label);
  if (payload.name !== packageName || payload.version !== version) {
    throw new Error(`${label} returned the wrong package coordinate.`);
  }
  return payload;
}
