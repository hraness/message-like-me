import { describe, expect, test } from "bun:test";
import { renderReadmeHtml } from "./readme-html.ts";
import { siteDocumentSource } from "./sync-readme.ts";

describe("renderReadmeHtml", () => {
  test("escapes raw HTML and rewrites repository-relative links and images", () => {
    const html = renderReadmeHtml([
      "<img src=x onerror=alert(1)>",
      "",
      "[Security](SECURITY.md)",
      "",
      "![Architecture](docs/architecture.png)",
      "",
      "```json",
      '{"literal":"&lt;safe&gt;","html":"<script>"}',
      "```",
    ].join("\n"));
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain(
      'href="https://github.com/hraness/textbutler/blob/main/SECURITY.md"',
    );
    expect(html).toContain(
      'src="https://raw.githubusercontent.com/hraness/textbutler/main/docs/architecture.png"',
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain('data-language="json"');
    expect(html).toContain("&amp;lt;safe&amp;gt;");
    expect(html).not.toContain("<script>");
  });

  test("serves the site's own public images from the site", () => {
    const html = renderReadmeHtml("![Hero](site/public/launch/hero%402x.png#gh-light-mode-only)");
    expect(html).toContain('src="/launch/hero%402x.png#gh-light-mode-only"');
  });

  test("serves a wide/narrow diagram pair as one responsive picture", () => {
    const html = renderReadmeHtml("![Flow](site/public/diagrams/d1-one-message-wide.light%402x.png#gh-light-mode-only)");
    expect(html).toContain('<picture><source media="(max-width: 899px)" srcset="/diagrams/d1-one-message-narrow.light%402x.png"');
    expect(html).toContain('src="/diagrams/d1-one-message-wide.light%402x.png#gh-light-mode-only"');
    expect(html).toContain("</picture>");
    const single = renderReadmeHtml("![Checks](site/public/diagrams/d4-five-checks.light%402x.png)");
    expect(single).not.toContain("<picture>");
  });

  test.each([
    "[unsafe](javascript:alert(1))",
    "[unsafe](data:text/html,hello)",
    "[unsafe](java&#x73;cript:alert(1))",
    "[unsafe](//example.com/path)",
  ])("rejects unsafe targets in %s", (source) => {
    expect(() => renderReadmeHtml(source)).toThrow();
  });

  test("allows HTTPS, mail, root-relative, and fragment targets", () => {
    expect(() => renderReadmeHtml(
      "# X\n\n[web](https://example.com) [mail](mailto:test@example.com) [root](/x) [part](#x)",
    )).not.toThrow();
  });

  test("preserves the complete README source for the site", () => {
    const readme = "# Message Like Me\n\n![Architecture](docs/architecture.png)\n";
    expect(siteDocumentSource("README.md", readme)).toBe(readme);
    expect(siteDocumentSource("docs/research.md", readme)).toBe(readme);
    expect(() => siteDocumentSource("", readme)).toThrow("must not be empty");
  });

  test("adds GitHub-compatible unique heading IDs and validates fragments", () => {
    const html = renderReadmeHtml([
      "# Product",
      "",
      "[First](#install-and-first-run) [Second](#install-and-first-run-1)",
      "",
      "## Install and first run",
      "",
      "## Install and first run",
    ].join("\n"));
    expect(html).toContain('<h1 id="product">Product</h1>');
    expect(html).toContain('<h2 id="install-and-first-run">Install and first run</h2>');
    expect(html).toContain('<h2 id="install-and-first-run-1">Install and first run</h2>');
    expect(() => renderReadmeHtml("# Product\n\n[Missing](#missing)"))
      .toThrow('README fragment has no rendered heading: "missing"');
  });
});
