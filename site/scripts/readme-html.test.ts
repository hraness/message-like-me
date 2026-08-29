import { describe, expect, test } from "bun:test";
import { renderReadmeHtml } from "./readme-html.ts";
import { siteDocumentSource, SKILLS_SH_README_BADGE } from "./sync-readme.ts";

describe("renderReadmeHtml", () => {
  test("escapes raw HTML and rewrites repository-relative links", () => {
    const html = renderReadmeHtml("<img src=x onerror=alert(1)>\n\n[Security](SECURITY.md)");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain(
      'href="https://github.com/hraness/message-like-me/blob/main/SECURITY.md"',
    );
    expect(html).not.toContain("<img");
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
      "[web](https://example.com) [mail](mailto:test@example.com) [root](/x) [part](#x)",
    )).not.toThrow();
  });

  test("keeps the repository badge out of the CSP-bound site document", () => {
    const readme = `# Message Like Me\n\n${SKILLS_SH_README_BADGE}\n\nIntroduction.\n`;
    expect(siteDocumentSource("README.md", readme)).toBe(
      "# Message Like Me\n\nIntroduction.\n",
    );
    expect(siteDocumentSource("docs/research.md", readme)).toBe(readme);
    expect(() => siteDocumentSource("README.md", "# Message Like Me\n"))
      .toThrow("official skills.sh repository badge");
  });
});
