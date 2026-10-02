import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { absoluteUrl, CANONICAL_PAGE_PATHS, SITE_NAME, SITE_ORIGIN } from "../app/_lib/site.ts";

import manifest from "../app/manifest.ts";
import { metadata } from "../app/layout.tsx";

describe("release identity", () => {
  test("uses TextButler identity without advertising a web messaging app", () => {
    expect(SITE_NAME).toBe("TextButler");
    expect(SITE_ORIGIN).toBe("https://textbutler.app");
    expect(new URL(String(metadata.metadataBase)).origin).toBe(SITE_ORIGIN);
    expect(metadata.applicationName).toBe(SITE_NAME);
    for (const path of CANONICAL_PAGE_PATHS) expect(new URL(absoluteUrl(path)).origin).toBe(SITE_ORIGIN);
    expect(manifest().name).toBe(SITE_NAME);
    expect(manifest().display).toBe("browser");
  });

  test("never offers the retired history package as a TextButler install", async () => {
    const siteRoot = resolve(import.meta.dir, "..");
    const repositoryRoot = resolve(siteRoot, "..");
    const [readme, page] = await Promise.all([
      Bun.file(resolve(repositoryRoot, "README.md")).text(),
      Bun.file(resolve(siteRoot, "app", "page.tsx")).text(),
    ]);
    for (const copy of [readme, page]) {
      expect(copy).not.toContain("bun add --global");
      expect(copy).not.toContain("@hraness/message-like-me");
    }
  });
});
