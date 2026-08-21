import { describe, expect, test } from "bun:test";
import { renderReadmeHtml } from "./readme-html.ts";

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
});
