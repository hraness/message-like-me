const REPOSITORY_BLOB_ROOT = "https://github.com/hraness/message-like-me/blob/main/";

function decodeCharacterReferences(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/giu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#([0-9]+);?/gu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)))
    .replaceAll("&colon;", ":")
    .replaceAll("&Tab;", "\t")
    .replaceAll("&NewLine;", "\n")
    .replaceAll("&amp;", "&");
}

function assertSafeTarget(encodedTarget: string): void {
  const target = decodeCharacterReferences(encodedTarget);
  const compact = target.trim().replace(/[\u0000-\u0020\u007f]+/gu, "");
  if (compact.startsWith("//")) {
    throw new Error(`README contains a protocol-relative URL: ${JSON.stringify(target)}`);
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(compact)?.[1]?.toLowerCase();
  if (scheme !== undefined && !["http", "https", "mailto"].includes(scheme)) {
    throw new Error(`README contains a disallowed URL scheme: ${JSON.stringify(target)}`);
  }
}

function rewriteRelativeLinks(html: string): string {
  return html.replace(/href="([^"]*)"/gu, (attribute, target: string) => {
    assertSafeTarget(target);
    if (
      target === ""
      || target.startsWith("#")
      || target.startsWith("/")
      || /^[a-z][a-z0-9+.-]*:/iu.test(decodeCharacterReferences(target).trim())
    ) {
      return attribute;
    }
    return `href="${REPOSITORY_BLOB_ROOT}${target}"`;
  });
}

export function renderReadmeHtml(source: string): string {
  const html = Bun.markdown.html(source, {
    noHtmlBlocks: true,
    noHtmlSpans: true,
    tagFilter: true,
  });
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/gu)) {
    const target = match[1];
    if (target !== undefined) assertSafeTarget(target);
  }
  return rewriteRelativeLinks(html);
}
