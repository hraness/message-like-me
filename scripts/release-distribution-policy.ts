type JsonRecord = Record<string, unknown>;

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const STABLE_TAG = /^v((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))$/u;
const OIDC_CONFIG_ID = /^oidc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const publicPackageName = "@hraness/message-like-me";
export const publicRepository = "hraness/message-like-me";

export function releaseVersionForCurrentAdmission(
  manifestValue: unknown,
  verifiedTag: string,
): string {
  const manifest = record(manifestValue, "current-main release admission manifest");
  if (manifest.name !== publicPackageName || manifest.license !== "MIT") {
    throw new Error("Current-main release admission code has the wrong public package or license identity.");
  }
  const match = STABLE_TAG.exec(verifiedTag);
  if (match?.[1] === undefined) throw new Error("Verified release tag is not one canonical stable version.");
  return match[1];
}

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function text(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

export function releaseArchiveName(version: string): string {
  text(version, SEMVER, "release version");
  return `hraness-message-like-me-${version}.tgz`;
}

export type NpmReleaseCoordinate = Readonly<{
  integrity: string;
  shasum: string;
  tarball: string;
}>;

export function parseNpmRelease(
  value: unknown,
  version: string,
  options: Readonly<{ requireProvenance: boolean }> = { requireProvenance: true },
): NpmReleaseCoordinate {
  text(version, SEMVER, "npm release version");
  const release = record(value, "npm release");
  if (release.name !== publicPackageName || release.version !== version || release.license !== "MIT") {
    throw new Error(`npm ${publicPackageName}@${version} has the wrong package identity or license.`);
  }
  const dist = record(release.dist, "npm release dist");
  const expectedTarball = `https://registry.npmjs.org/@hraness/message-like-me/-/message-like-me-${version}.tgz`;
  if (dist.tarball !== expectedTarball) throw new Error("npm release tarball URL is not canonical.");
  const coordinate = Object.freeze({
    integrity: text(dist.integrity, SHA512_INTEGRITY, "npm release integrity"),
    shasum: text(dist.shasum, SHA1, "npm release SHA-1"),
    tarball: expectedTarball,
  });
  if (options.requireProvenance) {
    const npmUser = record(release._npmUser, "npm trusted publisher identity");
    const trustedPublisher = record(npmUser.trustedPublisher, "npm trusted publisher");
    const attestations = record(dist.attestations, "npm release provenance attestations");
    const provenance = record(attestations.provenance, "npm release provenance");
    const expectedAttestationUrl =
      `https://registry.npmjs.org/-/npm/v1/attestations/@hraness%2fmessage-like-me@${version}`;
    if (
      provenance.predicateType !== "https://slsa.dev/provenance/v1"
      || attestations.url !== expectedAttestationUrl
      || npmUser.name !== "GitHub Actions"
      || npmUser.email !== "npm-oidc-no-reply@github.com"
      || trustedPublisher.id !== "github"
      || typeof trustedPublisher.oidcConfigId !== "string"
      || !OIDC_CONFIG_ID.test(trustedPublisher.oidcConfigId)
    ) {
      throw new Error("npm release trusted-publisher provenance is missing or invalid.");
    }
  }
  return coordinate;
}

export type GitHubReleaseAsset = Readonly<{
  browserDownloadUrl: string;
  digest: string;
  id: number;
  name: string;
  size: number;
}>;

export type GitHubReleaseCoordinate = Readonly<{
  checksum: GitHubReleaseAsset;
  tarball: GitHubReleaseAsset;
}>;

function parseAsset(value: unknown, expectedName: string, tag: string): GitHubReleaseAsset {
  const asset = record(value, `GitHub Release asset ${expectedName}`);
  const expectedUrl = `https://github.com/${publicRepository}/releases/download/${tag}/${expectedName}`;
  if (asset.name !== expectedName || asset.state !== "uploaded" || asset.browser_download_url !== expectedUrl) {
    throw new Error(`GitHub Release asset ${expectedName} has the wrong identity or state.`);
  }
  return Object.freeze({
    browserDownloadUrl: expectedUrl,
    digest: text(asset.digest, SHA256_DIGEST, `GitHub Release asset ${expectedName} digest`),
    id: positiveInteger(asset.id, `GitHub Release asset ${expectedName} id`),
    name: expectedName,
    size: positiveInteger(asset.size, `GitHub Release asset ${expectedName} size`),
  });
}

export function parseGitHubRelease(
  value: unknown,
  version: string,
): GitHubReleaseCoordinate {
  text(version, SEMVER, "GitHub release version");
  const tag = `v${version}`;
  const release = record(value, "GitHub Release");
  if (
    release.tag_name !== tag
    || release.name !== `Message Like Me ${tag}`
    || release.body !== `Automated public release of ${publicPackageName}@${version} from ${tag}.`
    || release.draft !== false
    || release.prerelease !== false
    || release.immutable !== true
  ) {
    throw new Error(`GitHub Release ${tag} is not exact, published, and immutable.`);
  }
  if (!Array.isArray(release.assets) || release.assets.length !== 2) {
    throw new Error(`GitHub Release ${tag} must contain exactly two immutable artifacts.`);
  }
  const byName = new Map(release.assets.map((asset) => {
    const item = record(asset, "GitHub Release asset");
    return [item.name, asset] as const;
  }));
  if (byName.size !== 2) throw new Error(`GitHub Release ${tag} contains duplicate asset names.`);
  const archiveName = releaseArchiveName(version);
  const tarball = parseAsset(byName.get(archiveName), archiveName, tag);
  const checksum = parseAsset(byName.get("SHA256SUMS"), "SHA256SUMS", tag);
  return Object.freeze({ checksum, tarball });
}

export function assertReleaseAssetBytes(
  coordinate: GitHubReleaseCoordinate,
  tarballBytes: Uint8Array,
  checksumBytes: Uint8Array,
  sha256: (bytes: Uint8Array) => string,
): void {
  const tarballDigest = sha256(tarballBytes);
  const checksumDigest = sha256(checksumBytes);
  if (
    coordinate.tarball.size !== tarballBytes.byteLength
    || coordinate.tarball.digest !== `sha256:${tarballDigest}`
    || coordinate.checksum.size !== checksumBytes.byteLength
    || coordinate.checksum.digest !== `sha256:${checksumDigest}`
  ) throw new Error("GitHub Release asset size or digest does not match its immutable bytes.");
  const expectedChecksum = `${tarballDigest}  ${coordinate.tarball.name}\n`;
  if (new TextDecoder("utf-8", { fatal: true }).decode(checksumBytes) !== expectedChecksum) {
    throw new Error("SHA256SUMS does not describe the exact GitHub Release tarball.");
  }
}
