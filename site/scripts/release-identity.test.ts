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

  test("routes installation through the exact public npm release", async () => {
    const siteRoot = resolve(import.meta.dir, "..");
    const repositoryRoot = resolve(siteRoot, "..");
    const packageRelease = await packageVersion(resolve(repositoryRoot, "package.json"));
    const exactInstall = `bun add --global @hraness/message-like-me@${packageRelease}`;
    const [readme, page, changelog] = await Promise.all([
      Bun.file(resolve(repositoryRoot, "README.md")).text(),
      Bun.file(resolve(siteRoot, "app", "page.tsx")).text(),
      Bun.file(resolve(repositoryRoot, "CHANGELOG.md")).text(),
    ]);

    expect(readme).toContain(exactInstall);
    expect(page).toContain(
      "bun add --global @hraness/message-like-me@{SOFTWARE_VERSION}",
    );
    expect(readme).not.toContain("github:hraness/message-like-me#");
    expect(page).not.toContain("github:hraness/message-like-me#");
    expect(readme).not.toContain("is not published to npm");
    expect(changelog).toContain(
      `exact public \`@hraness/message-like-me@${packageRelease}\` npm package`,
    );
    expect(changelog).toContain("same reviewed bytes mirrored in the");
    expect(changelog).toContain("immutable GitHub Release");
  });
});
