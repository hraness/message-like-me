import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodeBlock } from "../app/_components/code-block.tsx";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPOSITORY_BLOB_ROOT = "https://github.com/hraness/textbutler/blob/main/";
const REPOSITORY_RAW_ROOT = "https://raw.githubusercontent.com/hraness/textbutler/main/";
const SITE_PUBLIC_PREFIX = "site/public/";

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

function rewriteRelativeTargets(html: string): string {
  return html.replace(/(href|src)="([^"]*)"/gu, (
    attribute,
    name: "href" | "src",
    target: string,
  ) => {
    assertSafeTarget(target);
    if (
      target === ""
      || target.startsWith("#")
      || target.startsWith("/")
      || /^[a-z][a-z0-9+.-]*:/iu.test(decodeCharacterReferences(target).trim())
    ) {
      return attribute;
    }
    // Images the site itself serves (site/public/…) load from this site, so
    // /docs shows them in every preview before they reach main.
    if (name === "src" && target.startsWith(SITE_PUBLIC_PREFIX)) {
      return `${name}="/${target.slice(SITE_PUBLIC_PREFIX.length)}"`;
    }
    const root = name === "src" ? REPOSITORY_RAW_ROOT : REPOSITORY_BLOB_ROOT;
    return `${name}="${root}${target}"`;
  });
}

const PUBLIC_ROOT = resolve(import.meta.dir, "..", "public");

// Local PNGs get their intrinsic CSS size (half the pixels for @2x files) and
// lazy loading, so images reserve their box and the hidden theme copy never loads.
function sizeLocalImages(html: string): string {
  return html.replace(/<img ([^>]*?)src="(\/[^"#]+\.png)(#[^"]*)?"([^>]*?)\s*\/?>/gu, (tag, before: string, path: string, fragment: string | undefined, after: string) => {
    const file = join(PUBLIC_ROOT, decodeURIComponent(path));
    if (!file.startsWith(PUBLIC_ROOT) || !existsSync(file)) return tag;
    const header = readFileSync(file).subarray(0, 24);
    if (header.toString("ascii", 1, 4) !== "PNG") return tag;
    const scale = /@2x\.png$/u.test(decodeURIComponent(path)) ? 2 : /@3x\.png$/u.test(decodeURIComponent(path)) ? 3 : 1;
    const width = Math.round(header.readUInt32BE(16) / scale);
    const height = Math.round(header.readUInt32BE(20) / scale);
    return `<img ${before}src="${path}${fragment ?? ""}"${after} width="${width}" height="${height}" loading="lazy" decoding="async">`;
  });
}

function headingText(html: string): string {
  return decodeCharacterReferences(html.replace(/<[^>]+>/gu, ""))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function githubHeadingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Mark}\p{Number}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

function addHeadingIds(html: string): string {
  const occurrences = new Map<string, number>();
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gu, (_, level: string, body: string) => {
    const base = githubHeadingSlug(headingText(body));
    if (base === "") throw new Error("README contains a heading without a stable fragment ID");
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    const id = occurrence === 0 ? base : `${base}-${occurrence}`;
    return `<h${level} id="${id}">${body}</h${level}>`;
  });
}

function assertFragmentsResolve(html: string): void {
  const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/gu), ([, id]) => id));
  for (const [, encodedFragment] of html.matchAll(/\shref="#([^"]+)"/gu)) {
    let fragment: string;
    try {
      fragment = decodeURIComponent(encodedFragment);
    } catch {
      throw new Error(`README contains an invalid encoded fragment: ${JSON.stringify(encodedFragment)}`);
    }
    if (!ids.has(fragment)) {
      throw new Error(`README fragment has no rendered heading: ${JSON.stringify(fragment)}`);
    }
  }
}

export function renderReadmeHtml(source: string): string {
  const options = {
    noHtmlBlocks: true,
    noHtmlSpans: true,
    tagFilter: true,
  } as const;
  // Recover literal code with the Markdown parser so entity-like text is never
  // decoded twice. Natural-language and directory blocks keep their text hint.
  const codeBlocks: { code: string; language: string }[] = [];
  Bun.markdown.render(source, {
    code(code, metadata) {
      codeBlocks.push({ code, language: metadata?.language ?? "text" });
      return "";
    },
  }, options);
  let blockIndex = 0;
  const html = new HTMLRewriter().on("pre", {
    element(element) {
      const block = codeBlocks[blockIndex++];
      if (block === undefined) throw new Error("README code block parsers disagree");
      element.replace(renderToStaticMarkup(createElement(CodeBlock, block)), { html: true });
    },
  }).transform(Bun.markdown.html(source, options));
  if (blockIndex !== codeBlocks.length) throw new Error("README code block parsers disagree");
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/gu)) {
    const target = match[1];
    if (target !== undefined) assertSafeTarget(target);
  }
  const rendered = sizeLocalImages(rewriteRelativeTargets(addHeadingIds(html)));
  assertFragmentsResolve(rendered);
  return rendered;
}
