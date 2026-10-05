import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

const AZURE = /^https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu(\/?)$/;
const RUNNER_LIST = "mirror+file:/etc/apt/apt-mirrors.txt";
const DISABLED_VALUES = new Set(["no", "false", "off", "without", "disable"]);
const DISABLED_NUMERIC = /^[+-]?(?:0+|0x0+)$/;
const PYTHON_SPACE = /[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/u;
const FIELD_HEADER = /^([^\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000:]+):/;
const LEGACY_ENTRY = /(^|(?<=\n))[ \t]*deb(?:-src)?[ \t]+(?:\[[^\]\r\n]*\][ \t]+)?([^\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000#]+)/g;
const MIRROR_ENTRY = /(^|(?<=\n))[ \t]*([^\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000#]+)/g;
const LINE_BOUNDARY = /\r\n|[\n\r\u000B\f\u001C-\u001E\u0085\u2028\u2029]/g;
const TOKEN = /[^\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;

type Span = readonly [number, number];

function* splitLines(text: string): Generator<string> {
  let start = 0;
  for (const match of text.matchAll(LINE_BOUNDARY)) {
    const end = match.index + match[0].length;
    yield text.slice(start, end);
    start = end;
  }
  if (start < text.length) yield text.slice(start);
}

function isPythonSpace(character: string | undefined): boolean {
  return character !== undefined && PYTHON_SPACE.test(character);
}

function pythonTrimStart(text: string): string {
  let index = 0;
  while (isPythonSpace(text[index])) index += 1;
  return text.slice(index);
}

function pythonTrim(text: string): string {
  let start = 0;
  let end = text.length;
  while (isPythonSpace(text[start])) start += 1;
  while (end > start && isPythonSpace(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

export function uriSpans(text: string, suffix: string): Span[] {
  if (suffix !== ".list" && suffix !== ".sources") {
    throw new Error("Unsupported source format");
  }
  if (suffix === ".list") {
    const spans: Span[] = [];
    for (const match of text.matchAll(LEGACY_ENTRY)) {
      const group = match[2]!;
      spans.push([match.index + match[0].length - group.length, match.index + match[0].length]);
    }
    return spans;
  }
  const result: Span[] = [];
  let pending: Span[] = [];
  let enabled: string[] = [];
  let field: string | null = null;
  let offset = 0;

  const finish = () => {
    const value = enabled.join(" ").toLowerCase();
    if (!DISABLED_VALUES.has(value) && !DISABLED_NUMERIC.test(value)) {
      result.push(...pending);
    }
  };

  for (const line of splitLines(text)) {
    if (pythonTrim(line) === "") {
      finish();
      pending = [];
      enabled = [];
      field = null;
    } else if (!pythonTrimStart(line).startsWith("#")) {
      let start = 0;
      if (!isPythonSpace(line[0])) {
        const header = FIELD_HEADER.exec(line);
        field = header ? header[1]!.toLowerCase() : null;
        start = header ? header[0].length : 0;
      }
      if (field === "uris" || field === "enabled") {
        for (const token of line.slice(start).matchAll(TOKEN)) {
          if (token[0].startsWith("#")) break;
          if (field === "uris") {
            pending.push([offset + start + token.index, offset + start + token.index + token[0].length]);
          } else {
            enabled.push(token[0]);
          }
        }
      }
    }
    offset += line.length;
  }
  finish();
  return result;
}

export function replaceUris(text: string, spans: readonly Span[]): string {
  for (const [start, end] of [...spans].reverse()) {
    const match = AZURE.exec(text.slice(start, end));
    if (match) {
      text = `${text.slice(0, start)}https://archive.ubuntu.com/ubuntu${match[1]!}${text.slice(end)}`;
    }
  }
  return text;
}

export function rewrite(text: string, suffix: string): string {
  return replaceUris(text, uriSpans(text, suffix));
}

function ordinaryDirectory(path: string): void {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    stats = null;
  }
  if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Not an ordinary directory: ${path}`);
  }
}

function ordinaryFile(path: string): string {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    stats = null;
  }
  if (stats === null || stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Not an ordinary file: ${path}`);
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
}

export function plan(root: string): Array<[string, string]> {
  ordinaryDirectory(root);
  const parts = join(root, "sources.list.d");
  let partsStats;
  try {
    partsStats = lstatSync(parts);
  } catch {
    partsStats = null;
  }
  if (partsStats !== null) ordinaryDirectory(parts);
  const paths = (partsStats !== null && partsStats.isDirectory()
    ? readdirSync(parts).filter((name) => name.endsWith(".list") || name.endsWith(".sources")).sort()
    : []
  ).map((name) => join(parts, name));
  const main = join(root, "sources.list");
  try {
    lstatSync(main);
    paths.unshift(main);
  } catch {
    // No top-level sources.list to inspect.
  }
  const changes: Array<[string, string]> = [];
  let runnerList = false;
  for (const path of paths) {
    const text = ordinaryFile(path);
    const spans = uriSpans(text, extname(path));
    runnerList ||= spans.some(([start, end]) => text.slice(start, end) === RUNNER_LIST);
    const updated = replaceUris(text, spans);
    if (updated !== text) changes.push([path, updated]);
  }
  if (runnerList) {
    const path = join(root, "apt-mirrors.txt");
    const text = ordinaryFile(path);
    const spans: Span[] = [];
    for (const match of text.matchAll(MIRROR_ENTRY)) {
      const group = match[2]!;
      spans.push([match.index + match[0].length - group.length, match.index + match[0].length]);
    }
    const updated = replaceUris(text, spans);
    if (updated !== text) changes.push([path, updated]);
  }
  return changes;
}

if (import.meta.main) {
  const changes = plan("/etc/apt");
  for (const [path, content] of changes) {
    writeFileSync(path, content, "utf8");
    console.log(`Normalized Azure archive URIs in ${basename(path)}`);
  }
  console.log(`Updated ${changes.length} files; APT signing configuration preserved`);
}
