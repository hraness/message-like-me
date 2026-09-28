import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const supportFoundationPin = "github:hraness/support-foundation#8bb514d24b79dc3f305390700ae312cab88e7ad2";
const reviewedInputs: Readonly<Record<string, string>> = {
  "dist/node.js": "af3ecd5fd24c5634c75b5285254ac2ffead0388c3c91eba48da089340885b9c3",
  "dist/index.js": "2ccf18fdc6f1ddbe8c957dd3060447b5f61a498928dd3d18e0e74c3dd2868981",
  "LICENSE": "74b69bf37c8f340c9c2a54d431a15218738d9c463d0e014fa6a8bb8edce4e539"
};
// Bun 1.3.14 output of src/support-runtime.ts, admitted independently with this change.
const reviewedBundleSha256 = "5cec914f62fb7c4c719a994171f9768015553f63d61f00f351df6692be131118";
const sha256 = (source: string | Uint8Array): string => createHash("sha256").update(source).digest("hex");

export function isReviewedSupportRuntime(path: string, source: string): boolean {
  return path === "dist/support-runtime.js" && sha256(source) === reviewedBundleSha256;
}

export async function assertSupportFoundationInputs(root: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { devDependencies?: Record<string, string> };
  if (manifest.devDependencies?.["@hraness/support-foundation"] !== supportFoundationPin) throw new Error("Support foundation pin drifted");
  for (const [path, expected] of Object.entries(reviewedInputs)) {
    if (sha256(await readFile(join(root, "node_modules/@hraness/support-foundation", path))) !== expected) throw new Error(`Support foundation input drifted: ${path}`);
  }
  const license = await readFile(join(root, "node_modules/@hraness/support-foundation/LICENSE"), "utf8");
  const notice = await readFile(join(root, "docs/support-foundation-notice.md"), "utf8");
  if (!notice.includes(license.trim()) || !notice.includes(supportFoundationPin.split("#")[1]!)) throw new Error("Support foundation attribution drifted");
}
