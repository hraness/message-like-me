import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const siteRoot = resolve(import.meta.dir, "..");

describe("site typography", () => {
  test("loads the immutable Nebula Sans release for proportional roles", async () => {
    const [css, layout, manifestSource] = await Promise.all([
      readFile(resolve(siteRoot, "app/globals.css"), "utf8"),
      readFile(resolve(siteRoot, "app/layout.tsx"), "utf8"),
      readFile(resolve(siteRoot, "package.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestSource) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies?.["@hraness/design-kit"])
      .toBe("github:hraness/design-kit#v0.3.0");
    expect(layout).toContain("import '@hraness/design-kit/fonts.css';");
    expect(layout).toContain(
      "import '@hraness/design-kit/product-marketing.css';",
    );
    expect(layout.indexOf("@hraness/design-kit/fonts.css"))
      .toBeLessThan(layout.indexOf("./globals.css"));
    expect(layout.indexOf("@hraness/design-kit/product-marketing.css"))
      .toBeLessThan(layout.indexOf("./globals.css"));
    expect(css).toContain('font-family: "Nebula Sans", ui-sans-serif, system-ui');
    expect(css).not.toContain("font-family: Inter");
  });

  test("keeps deliberate serif and mono roles explicit", async () => {
    const css = await readFile(resolve(siteRoot, "app/globals.css"), "utf8");

    expect(css).toContain('Iowan Old Style, Baskerville, "Times New Roman", serif');
    expect(css).toContain("ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
  });
});
