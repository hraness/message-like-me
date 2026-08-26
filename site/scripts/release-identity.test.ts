import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { RELEASE_URL, SOFTWARE_VERSION } from "../app/_lib/site.ts";

type PackageIdentity = Readonly<{ version?: unknown }>;

async function packageVersion(path: string): Promise<string> {
  const manifest = await Bun.file(path).json() as PackageIdentity;
  if (typeof manifest.version !== "string") throw new Error(`${path} has no package version`);
  return manifest.version;
}

describe("release identity", () => {
  test("keeps the deployable site aligned with the immutable package release", async () => {
    const siteRoot = resolve(import.meta.dir, "..");
    const repositoryRoot = resolve(siteRoot, "..");
    const [packageRelease, siteRelease] = await Promise.all([
      packageVersion(resolve(repositoryRoot, "package.json")),
      packageVersion(resolve(siteRoot, "package.json")),
    ]);

    expect(siteRelease).toBe(packageRelease);
    expect(SOFTWARE_VERSION).toBe(packageRelease);
    expect(RELEASE_URL).toBe(
      `https://github.com/hraness/message-like-me/releases/tag/v${packageRelease}`,
    );
  });
});
