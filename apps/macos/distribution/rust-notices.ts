import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { command, digest, object, readPhysical, requireValue, sha256 } from "./common.ts";

const TARGET = "aarch64-apple-darwin";
type NoticeFile = { path: string; sha256: string; origin: "crate" | "upstream-grant" | "standard-license" };
export function admitSupplement(value: unknown, pkg: Record<string, unknown>, checksum: string, vcs: unknown, read: (file: string) => Buffer): { files: NoticeFile[]; texts: Map<string, string>; attribution: unknown } {
  const row = object(value);
  requireValue(Object.keys(row).sort().join() === ["name", "version", "crateSha256", "repository", "license", "vcs", "authors", "sources", ...(row.note === undefined ? [] : ["note"])].sort().join(), "Unexpected license supplement field");
  requireValue(row.name === pkg.name && row.version === pkg.version && row.crateSha256 === checksum && row.repository === pkg.repository && row.license === pkg.license && JSON.stringify(row.vcs) === JSON.stringify(vcs) && JSON.stringify(row.authors) === JSON.stringify(pkg.authors ?? []) && (row.note === undefined || typeof row.note === "string" && row.note.length <= 4096), "License supplement is bound to another crate, attribution or source commit");
  const commit = digest(object(object(vcs).git).sha1, 40), repository = String(pkg.repository).replace(/\/$/u, "");
  requireValue(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository) && Array.isArray(row.sources) && row.sources.length > 0 && row.sources.length <= 8, "Invalid supplement source inventory");
  const prefix = `https://raw.githubusercontent.com/${repository.slice("https://github.com/".length)}/${commit}/`, seen = new Set<string>(), texts = new Map<string, string>();
  const files = row.sources.map(raw => {
    const source = object(raw), hash = digest(source.sha256);
    requireValue(Object.keys(source).sort().join() === "bytes,file,kind,sha256,url" && source.file === `${hash}.txt` && typeof source.url === "string" && !seen.has(source.url) && Number.isSafeInteger(source.bytes) && Number(source.bytes) > 0 && Number(source.bytes) <= 262144, "Invalid supplement file");
    const url = source.url;
    requireValue(source.kind === "upstream-grant" ? url.startsWith(prefix) && !url.slice(prefix.length).split("/").some(part => part === ".." || part === "") : source.kind === "standard-license" && ["https://raw.githubusercontent.com/spdx/license-list-data/v3.27.0/text/MIT.txt", "https://www.mozilla.org/media/MPL/2.0/index.txt"].includes(url), "License supplement uses an unreviewed source");
    const bytes = read(String(source.file)); requireValue(bytes.length === source.bytes && sha256(bytes) === hash && !bytes.includes(0), "License supplement bytes differ");
    const text = bytes.toString("utf8"); requireValue(!text.includes("\uFFFD"), "Invalid supplement text"); texts.set(hash, text); seen.add(url);
    return { path: url, sha256: hash, origin: source.kind as "upstream-grant" | "standard-license" };
  });
  requireValue(files.some(file => file.origin === "upstream-grant"), "A standard license cannot replace an original grant");
  return { files, texts, attribution: { vcs: row.vcs, authors: row.authors, note: row.note ?? null } };
}
/** Collects original license/copyright files from Cargo's exact resolved target closure. */
export function rustNotices(metadataValue: unknown, lockBytes: Buffer, readArchive = (name: string, version: string, root: string): Buffer => readPhysical(join(dirname(dirname(dirname(root))), "cache", basename(dirname(root)), `${name}-${version}.crate`), 32 * 1024 * 1024), supplementValues: readonly unknown[] = [], readSupplement = (file: string) => readPhysical(join(import.meta.dir, "notices/rust-supplements", file), 262144)): { markdown: string; manifest: string } {
  const metadata = object(metadataValue), resolution = object(metadata.resolve);
  requireValue(Array.isArray(metadata.packages) && Array.isArray(resolution.nodes) && resolution.nodes.length < 1000, "Cargo license closure is invalid");
  const selected = new Set(resolution.nodes.map(value => String(object(value).id))), lock = object(Bun.TOML.parse(lockBytes.toString("utf8")));
  requireValue(Array.isArray(lock.package), "Cargo lock inventory is invalid");
  const texts = new Map<string, string>(), packages: Record<string, unknown>[] = [], missing: string[] = [], used = new Set<unknown>();
  for (const raw of metadata.packages) {
    const pkg = object(raw); if (!selected.has(String(pkg.id)) || pkg.source === null) continue;
    requireValue(pkg.source === "registry+https://github.com/rust-lang/crates.io-index" && typeof pkg.name === "string" && typeof pkg.version === "string" && typeof pkg.manifest_path === "string" && typeof pkg.license === "string", "Cargo notice source or license is unsupported");
    const locked = lock.package.map(object).filter(value => value.name === pkg.name && value.version === pkg.version && value.source === pkg.source);
    requireValue(locked.length === 1, "Cargo package has no exact lock identity"); const checksum = digest(locked[0]!.checksum);
    const root = dirname(pkg.manifest_path), archive = readArchive(pkg.name, pkg.version, root);
    requireValue(sha256(archive) === checksum, "Cargo archive checksum differs");
    // Cargo registry caches do not always retain .cargo-checksum.json. Admit the
    // original crate archive by its lock checksum and stream files to stdout;
    // tar never extracts anything onto the host filesystem.
    const archiveRoot = `${pkg.name}-${pkg.version}/`, listed = command("/usr/bin/tar", ["-tzf", "-"], { input: archive, maximum: 4 * 1024 * 1024 }).toString("utf8").trimEnd().split("\n");
    requireValue(listed.length > 0 && listed.length <= 50000 && new Set(listed).size === listed.length && listed.every(path => path.startsWith(archiveRoot) && !path.includes("/../") && !/[\u0000-\u001f\u007f]/u.test(path)), "Cargo archive paths are invalid");
    const explicit = typeof pkg.license_file === "string" ? relative(root, resolve(root, pkg.license_file)) : null;
    const paths = listed.filter(path => !path.endsWith("/") && (path.slice(archiveRoot.length) === explicit || path.slice(archiveRoot.length).split("/").some(name => /^(?:licen[cs]es?|copying|copyright|notices?)(?:[._-]|$)/iu.test(name))));
    let attribution: unknown = null;
    if (paths.length === 0) {
      const matches = supplementValues.filter(value => object(value).name === pkg.name && object(value).version === pkg.version);
      if (matches.length === 0) { missing.push(`${pkg.name}@${pkg.version} (${pkg.license}; ${pkg.repository})`); continue; }
      requireValue(matches.length === 1 && listed.includes(`${archiveRoot}.cargo_vcs_info.json`), "Ambiguous supplement or missing crate VCS evidence");
      const vcs = JSON.parse(command("/usr/bin/tar", ["-xOzf", "-", `${archiveRoot}.cargo_vcs_info.json`], { input: archive, maximum: 4096 }).toString("utf8"));
      const supplement = admitSupplement(matches[0], pkg, checksum, vcs, readSupplement); used.add(matches[0]); attribution = supplement.attribution;
      for (const [hash, text] of supplement.texts) texts.set(hash, text);
      packages.push({ name: pkg.name, version: pkg.version, source: pkg.source, checksum, license: pkg.license, sourceDownload: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`, modificationStatus: "unmodified", attribution, files: supplement.files }); continue;
    }
    requireValue(paths.length <= 100, `Oversized original license inventory for ${pkg.name}@${pkg.version}`);
    const files = paths.sort().map(path => {
      const name = path.slice(archiveRoot.length), bytes = command("/usr/bin/tar", ["-xOzf", "-", path], { input: archive, maximum: 1024 * 1024 }), hash = sha256(bytes);
      requireValue(!bytes.includes(0), "Cargo license file is not text");
      const text = bytes.toString("utf8"); requireValue(text.length > 0 && !text.includes("\uFFFD"), "Cargo license text is invalid"); texts.set(hash, text);
      return { path: name, sha256: hash, origin: "crate" };
    });
    packages.push({ name: pkg.name, version: pkg.version, source: pkg.source, checksum, license: pkg.license, sourceDownload: `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`, modificationStatus: "unmodified", attribution, files });
  }
  requireValue(missing.length === 0, `Original license files omitted from crates: ${missing.join(", ")}`);
  requireValue(used.size === supplementValues.length, "License supplements contain unused or duplicate crate entries");
  packages.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"));
  requireValue(packages.length > 0 && texts.size > 0, "Cargo notices are empty");
  let markdown = "# Rust dependency copyright and license notices\n\nNotices from the exact Cargo.lock target closure for Apple Silicon macOS. Build-time crates are included conservatively. Original crate notices, exact historical upstream grants and referenced standard-license texts are separately labeled. Standard text placeholders are preserved and do not assert a missing copyright owner or date. Identical texts are retained once and referenced by SHA-256.\n\nEvery listed dependency uses unmodified upstream source. Obtain its complete corresponding source from the listed source archive and verify the SHA-256 against the package checksum in RUST-LICENSES.json; the archive retains the original source license notices. This includes MPL2.0-covered components, whose source remains governed by that license. Textbutler imposes no additional restriction on that source.\n\n";
  for (const pkg of packages) {
    markdown += `## ${pkg.name} ${pkg.version}\n\nDeclared license: ${pkg.license}. Source: ${pkg.sourceDownload}\n\n`;
    if (pkg.attribution) { const a = object(pkg.attribution); markdown += `Exact upstream VCS: ${JSON.stringify(a.vcs)}. Authors from crate metadata: ${JSON.stringify(a.authors)}.\n\n${a.note ?? "Original upstream notices omitted from the crate are retained below."}\n\n`; }
    for (const file of pkg.files as NoticeFile[]) markdown += `- ${file.origin}: ${file.path} → ${file.sha256}\n`;
    markdown += "\n";
  }
  for (const [hash, text] of [...texts].sort(([a], [b]) => a.localeCompare(b))) markdown += `\n## ${hash}\n\n${text}${text.endsWith("\n") ? "" : "\n"}`;
  requireValue(Buffer.byteLength(markdown) <= 8 * 1024 * 1024, "Cargo notices exceed byte bound");
  return { markdown, manifest: `${JSON.stringify({ schema: "textbutler.rust-notices.v1", target: TARGET, cargoLockSha256: sha256(lockBytes), noticesSha256: sha256(markdown), packages }, null, 2)}\n` };
}
if (import.meta.main) {
  requireValue(process.argv.length === 2 || process.argv.length === 3 && process.argv[2] === "--write", "Expected --write or no arguments");
  const root = resolve(import.meta.dir, "../src-tauri"), notices = join(import.meta.dir, "notices");
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(APPLE_|TAURI_SIGNING_)/u.test(key) && !["GITHUB_TOKEN", "GH_TOKEN"].includes(key))) as Record<string, string>;
  const metadata = JSON.parse(command("cargo", ["metadata", "--offline", "--locked", "--format-version=1", `--filter-platform=${TARGET}`, "--manifest-path", join(root, "Cargo.toml")], { environment, maximum: 16 * 1024 * 1024, timeout: 180_000 }).toString("utf8"));
  const supplement = object(JSON.parse(readPhysical(join(notices, "rust-supplements/manifest.json"), 262144).toString("utf8")));
  requireValue(Object.keys(supplement).sort().join() === "packages,schema" && supplement.schema === "textbutler.rust-license-supplements.v1" && Array.isArray(supplement.packages) && supplement.packages.length <= 100, "Invalid license supplement manifest");
  const result = rustNotices(metadata, readPhysical(join(root, "Cargo.lock"), 1024 * 1024), undefined, supplement.packages);
  for (const [name, content] of [["RUST-LICENSES.md", result.markdown], ["RUST-LICENSES.json", result.manifest]] as const) {
    if (process.argv[2] === "--write") writeFileSync(join(notices, name), content, { mode: 0o644 });
    else requireValue(readFileSync(join(notices, name), "utf8") === content, "Checked Rust license closure differs; regenerate from exact locked Cargo source");
  }
  console.log("Exact locked Rust license closure verified.");
}
