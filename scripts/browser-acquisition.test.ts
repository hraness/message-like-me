import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { plan, rewrite } from "./browser-acquisition.ts";

const repository = join(import.meta.dir, "..");

describe("apt source mirror normalization", () => {
  let temporary = "";
  let root = "";
  const put = (name: string, content: string) => {
    const path = join(root, name);
    writeFileSync(path, content, "utf8");
    return path;
  };

  beforeEach(() => {
    temporary = mkdtempSync(join(tmpdir(), "textbutler-browser-acquisition-"));
    root = temporary;
    mkdirSync(join(root, "sources.list.d"));
  });
  afterEach(() => {
    rmSync(temporary, { recursive: true, force: true });
  });

  test("deb822 stanzas preserve signatures, bytes, and stay idempotent", () => {
    const original = "Types: deb\r\nURIs:http://azure.archive.ubuntu.com/ubuntu\r\n https://azure.archive.ubuntu.com/ubuntu/ https://security.ubuntu.com/ubuntu # http://azure.archive.ubuntu.com/ubuntu\r\nSuites: noble noble-security\r\nSigned-By: /keys/ubuntu.gpg";
    const path = put("sources.list.d/ubuntu.sources", original);
    const expected = original.replace("URIs:http://azure.archive.ubuntu.com/ubuntu", "URIs:https://archive.ubuntu.com/ubuntu").replace(" https://azure.archive.ubuntu.com/ubuntu/ ", " https://archive.ubuntu.com/ubuntu/ ");
    expect(plan(root)).toEqual([[path, expected]]);
    expect(readFileSync(path, "utf8")).toBe(original);
    writeFileSync(path, expected, "utf8");
    expect(plan(root)).toEqual([]);
  });

  test("legacy entries keep exact hosts, comments, options, and foreign sources", () => {
    const original = "# deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb [arch=amd64 signed-by=/keys/key.gpg] http://azure.archive.ubuntu.com/ubuntu noble main # http://azure.archive.ubuntu.com/ubuntu\ndeb-src https://azure.archive.ubuntu.com/ubuntu/ noble main\ndeb https://azure.archive.ubuntu.com.evil/ubuntu noble main\ndeb http://azure.archive.ubuntu.com/ubuntu-extra noble main\ndeb https://packages.example.org/ubuntu noble main\n";
    const path = put("sources.list", original);
    const expected = original.replace("] http://azure.archive.ubuntu.com/ubuntu", "] https://archive.ubuntu.com/ubuntu").replace("deb-src https://azure.archive.ubuntu.com/ubuntu/", "deb-src https://archive.ubuntu.com/ubuntu/");
    expect(plan(root)).toEqual([[path, expected]]);
  });

  test("matches Python BOM, line-anchor, and whitespace semantics", () => {
    const bom = put("sources.list", "\ufeffdeb http://azure.archive.ubuntu.com/ubuntu noble main\n");
    expect(plan(root)).toEqual([]);
    rmSync(bom);

    const loneCarriageReturn = "deb http://azure.archive.ubuntu.com/ubuntu noble main\rdeb http://azure.archive.ubuntu.com/ubuntu noble main\n";
    const legacy = put("sources.list", loneCarriageReturn);
    expect(plan(root)).toEqual([[legacy, "deb https://archive.ubuntu.com/ubuntu noble main\rdeb http://azure.archive.ubuntu.com/ubuntu noble main\n"]]);
    rmSync(legacy);

    put("sources.list.d/ubuntu.sources", "Types: deb\nURIs:\n\x1chttp://azure.archive.ubuntu.com/ubuntu\nSuites: noble\n");
    expect(plan(root)).toEqual([]);
  });

  test("disabled stanzas stay untouched and only the runner mirror list is followed", () => {
    const source = put("sources.list.d/ubuntu.sources", "");
    for (const value of ["no", "FALSE", "off", "without", "disable", "0", "00", "-0x00", "+0"]) {
      writeFileSync(source, `URIs: http://azure.archive.ubuntu.com/ubuntu mirror+file:/etc/apt/apt-mirrors.txt\nEnabled:\n ${value}\n`, "utf8");
      expect(plan(root)).toEqual([]);
    }
    for (const value of ["yes", "1", "0x1", "-1", "default"]) {
      writeFileSync(source, `URIs: http://azure.archive.ubuntu.com/ubuntu\nEnabled: ${value}\n`, "utf8");
      expect(plan(root)).toEqual([[source, `URIs: https://archive.ubuntu.com/ubuntu\nEnabled: ${value}\n`]]);
    }
    writeFileSync(source, "URIs: https://security.ubuntu.com/ubuntu\nX-Note: http://azure.archive.ubuntu.com/ubuntu\n", "utf8");
    expect(plan(root)).toEqual([]);
    writeFileSync(source, "URIs: mirror+file:/etc/apt/apt-mirrors.txt\nEnabled: yes\n", "utf8");
    const original = "# http://azure.archive.ubuntu.com/ubuntu\r\nhttp://azure.archive.ubuntu.com/ubuntu/\tpriority:1 arch:amd64\r\nhttps://security.ubuntu.com/ubuntu/\tpriority:2\r\n";
    const mirror = put("apt-mirrors.txt", original);
    const expected = original.replace("http://azure.archive.ubuntu.com/ubuntu/\t", "https://archive.ubuntu.com/ubuntu/\t");
    expect(plan(root)).toEqual([[mirror, expected]]);
    writeFileSync(mirror, expected, "utf8");
    expect(plan(root)).toEqual([]);
    writeFileSync(mirror, original, "utf8");
    writeFileSync(source, "URIs: mirror+file:/etc/passwd mirror+file:/etc/apt/../apt-mirrors.txt\n", "utf8");
    expect(plan(root)).toEqual([]);
    rmSync(source);
    put("sources.list", "deb mirror+file:/etc/apt/apt-mirrors.txt noble main\n");
    expect(plan(root)).toEqual([[mirror, expected]]);
  });

  test("every input is validated before any write", () => {
    const original = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n";
    const source = put("sources.list", original);
    const invalid = join(root, "sources.list.d", "invalid.sources");
    symlinkSync(source, invalid);
    expect(() => plan(root)).toThrow("Not an ordinary file");
    expect(readFileSync(source, "utf8")).toBe(original);
    rmSync(invalid);
    mkdirSync(invalid);
    expect(() => plan(root)).toThrow("Not an ordinary file");
    rmSync(invalid, { recursive: true });
    writeFileSync(invalid, new Uint8Array([0xff]));
    expect(() => plan(root)).toThrow();
    expect(readFileSync(source, "utf8")).toBe(original);
    rmSync(invalid);
    writeFileSync(source, `${original}deb mirror+file:/etc/apt/apt-mirrors.txt noble main\n`, "utf8");
    expect(() => plan(root)).toThrow("Not an ordinary file");
    symlinkSync(source, join(root, "apt-mirrors.txt"));
    expect(() => plan(root)).toThrow("Not an ordinary file");
    expect(() => rewrite(original, ".txt")).toThrow("Unsupported source format");
  });

  test("directory symlinks are rejected", () => {
    const linked = join(root, "linked");
    symlinkSync(root, linked, "dir");
    expect(() => plan(linked)).toThrow("Not an ordinary directory");
    const parts = join(root, "sources.list.d");
    rmSync(parts, { recursive: true });
    symlinkSync(root, parts, "dir");
    expect(() => plan(root)).toThrow("Not an ordinary directory");
  });
});

test("every browser dependency acquisition normalizes mirrors and bounds apt in order", () => {
  const commands = [
    ["ci.yml", "bun node_modules/playwright-core/cli.js install --with-deps --no-shell chromium"],
    ["verify-production.yml", "bun node_modules/playwright-core/cli.js install --with-deps chromium"],
  ];
  for (const [file, command] of commands) {
    const workflow = readFileSync(join(repository, ".github/workflows", file!), "utf8");
    const blocks = workflow.split(/(?=^      - )/m).filter((block) => block.includes("install --with-deps"));
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    const ordered = ["set -euo pipefail", 'sudo "$(command -v bun)" ../scripts/browser-acquisition.ts', 'config=/etc/apt/apt.conf.d/99-browser-acquisition', 'sudo test ! -e "$config"', 'sudo test ! -L "$config"', "trap 'sudo rm -f \"$config\"' EXIT", 'Acquire::http::Timeout "20";', 'Acquire::https::Timeout "20";', 'Acquire::Retries "1";', command!];
    let cursor = -1;
    for (const token of ordered) {
      const next = block.indexOf(token);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
    expect(block).toContain("working-directory: site");
    expect(workflow.match(/install --with-deps/g)).toHaveLength(1);
  }
  const manifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  expect(manifest.scripts.test).toBe("bun test ./src ./scripts");
  const ci = readFileSync(join(repository, ".github/workflows/ci.yml"), "utf8");
  expect(ci).toContain("run: bun run test");
  expect(ci.split("    name: Required\n")[1]).toContain("needs: [changes, check, test, textbutler, site, macos_fixtures]");
  const installIndex = ci.indexOf("Install the pinned candidate browser");
  expect(installIndex).toBeGreaterThan(-1);
  expect(installIndex).toBeLessThan(ci.indexOf("Check the committed informational site in Chromium"));
  expect(ci.indexOf("TEXTBUTLER_BROWSER_EXECUTABLE")).toBeGreaterThan(installIndex);
  const production = readFileSync(join(repository, ".github/workflows/verify-production.yml"), "utf8");
  expect(production).not.toContain("actions/cache/");
  expect(production.split("    name: Required\n")[1]).toContain("needs: browser");
});
