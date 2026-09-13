import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "bun:test";

const workflow = readFileSync(join(import.meta.dir, "../../..", ".github/workflows/desktop-preview.yml"), "utf8");
const signer = readFileSync(join(import.meta.dir, "preview-sign.ts"), "utf8");

test("preview workflow is owner-dispatched from main and has no publication permissions", () => {
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("github.actor_id == '894119'");
  expect(workflow).toContain("environment: desktop-signing");
  expect(workflow).not.toContain("contents: write");
  expect(workflow).not.toContain("id-token: write");
  expect(workflow).not.toContain("attestations: write");
  expect(workflow).not.toContain("notarytool");
  expect(workflow).not.toContain("release");
});

test("preview signer cannot consume notarization credentials or invoke notarization", () => {
  expect(signer).toContain("APPLE_CERTIFICATE_BASE64");
  expect(signer).toContain("APPLE_CERTIFICATE_PASSWORD");
  expect(signer).not.toContain("APPLE_NOTARY_APPLE_ID");
  expect(signer).not.toContain("APPLE_NOTARY_APP_PASSWORD");
  expect(signer).not.toContain("notarytool");
  expect(signer).toContain('status: "not-run"');
  expect(signer).toContain('stapled: false');
});
