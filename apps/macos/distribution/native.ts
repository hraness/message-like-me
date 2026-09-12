import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BUN_ENTITLEMENTS, command, IDENTIFIER, inventory, object, requireValue, VERSION } from "./common.ts";

export const entitlements = (path: string): Readonly<Record<string, boolean>> => path === "Contents/Resources/textbutler-runtime/textbutler-bun" ? BUN_ENTITLEMENTS : {};
export const plist = (values: Readonly<Record<string, boolean>>): string => `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${Object.entries(values).map(([key, value]) => `<key>${key}</key><${value ? "true" : "false"}/>`).join("")}</dict></plist>`;
export function nativePaths(app: string): string[] {
  const paths = inventory(app).filter(file => file.macho).map(file => file.path).sort();
  requireValue(paths.join(",") === "Contents/MacOS/textbutler-desktop,Contents/Resources/textbutler-runtime/textbutler-bun", "Unexpected native code in Textbutler bundle"); return paths;
}
function inspectSignature(path: string, args = ["--display", "--verbose=4"]): string {
  const result = spawnSync("/usr/bin/codesign", [...args, path], { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }, timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 65_536 });
  requireValue(result.error === undefined && result.status === 0 && result.signal === null, "Cannot inspect native signature"); return Buffer.concat([result.stdout, result.stderr]).toString("utf8");
}
export function assertSignature(path: string, team: string, identifier?: string): void {
  const details = inspectSignature(path);
  requireValue(details.split("\n").includes(`TeamIdentifier=${team}`) && /^Authority=Developer ID Application: .+$/mu.test(details) && /^Timestamp=.+$/mu.test(details)
    && /^CodeDirectory .*flags=0x[0-9a-f]+\([^\n]*runtime[^\n]*\)/mu.test(details) && !/^Signature=adhoc$/mu.test(details) && (identifier === undefined || details.split("\n").includes(`Identifier=${identifier}`)), "Developer ID, timestamp, hardened runtime, team, or identifier differs");
}
export function verifySignedBundle(app: string, team: string, identity: string): void {
  for (const [field, value] of Object.entries({ CFBundleIdentifier: IDENTIFIER, CFBundleShortVersionString: VERSION, CFBundleVersion: VERSION, CFBundleExecutable: "textbutler-desktop", LSMinimumSystemVersion: "14.5" })) {
    requireValue(command("/usr/libexec/PlistBuddy", ["-c", `Print :${field}`, join(app, "Contents/Info.plist")]).toString("utf8").trim() === value, "Signed bundle metadata differs");
  }
  command("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]); assertSignature(app, team, IDENTIFIER);
  for (const path of nativePaths(app)) {
    const absolute = join(app, path); assertSignature(absolute, team); command("/usr/bin/codesign", ["--verify", "--strict", absolute]);
    requireValue(command("/usr/bin/lipo", ["-archs", absolute]).toString("utf8").trim() === "arm64", "Native architecture differs");
    const scratch = mkdtempSync(join(tmpdir(), "textbutler-signature-"));
    try { command("/usr/bin/codesign", ["--display", "--extract-certificates", join(scratch, "cert"), absolute]); requireValue(createHash("sha1").update(readFileSync(join(scratch, "cert0"))).digest("hex") === identity, "Developer ID leaf differs"); }
    finally { rmSync(scratch, { recursive: true, force: true }); }
    const text = inspectSignature(absolute, ["--display", "--entitlements", ":-"]), start = text.indexOf("<?xml"), end = text.indexOf("</plist>");
    const actual = start < 0 ? {} : object(JSON.parse(command("/usr/bin/plutil", ["-convert", "json", "-o", "-", "-"], { input: text.slice(start, end + 8) }).toString("utf8")));
    requireValue(JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(entitlements(path)).sort()), "Unexpected hardened-runtime exception");
  }
  command("/usr/bin/xcrun", ["stapler", "validate", app]);
  command("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
  command("/usr/bin/syspolicy_check", ["distribution", app], { timeout: 120_000 });
}
