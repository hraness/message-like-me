import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { launches, MAX_LOGIN_ITEM_BYTES } from "@hraness/desktop-foundation/retire";

/** The removed menu companion's login item label. */
export const LEGACY_MENU_LOGIN_ITEM = "app.hraness.companion.textbutler";

/** True only for the removed menu companion's login item: it launches
 * textbutler.mjs with the `menubar` role, or TextButler.app. The installer
 * retires exactly these, so doctor and install share this matcher. */
export function isMenuLoginItem({ text }: { text: string }): boolean {
  return launches(/\/textbutler\.mjs$/u, "menubar")({ label: LEGACY_MENU_LOGIN_ITEM, path: "", text })
    || launches(/\/TextButler\.app\/Contents\/MacOS\/TextButler$/u)({ label: LEGACY_MENU_LOGIN_ITEM, path: "", text });
}

/** "present": a reinstall retires it. "not-ours": something sits at the label
 * that the installer will not touch (a symlink, another user's file, an
 * oversized file, or a plist that is not the menu item). */
export type LegacyLoginItemState = "present" | "not-ours";

/** Read-only: legacy login items at the menu companion's label. Uses the same
 * checks as the retire module (a regular file owned by this user, at most
 * MAX_LOGIN_ITEM_BYTES, opened with O_NOFOLLOW, accepted by isMenuLoginItem),
 * so "present" means a reinstall will retire it. Never boots out or renames. */
export async function legacyLoginItems(home: string, uid: number = process.getuid?.() ?? -1): Promise<{ label: string; state: LegacyLoginItemState }[]> {
  const path = join(home, "Library", "LaunchAgents", `${LEGACY_MENU_LOGIN_ITEM}.plist`);
  let info;
  try { info = await lstat(path); } catch { return []; }
  const notOurs = [{ label: LEGACY_MENU_LOGIN_ITEM, state: "not-ours" as const }];
  if (!info.isFile() || info.size > MAX_LOGIN_ITEM_BYTES || info.uid !== uid) return info.isFile() || info.isSymbolicLink() ? notOurs : [];
  let text: string;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.uid !== uid || opened.ino !== info.ino || opened.dev !== info.dev) return notOurs;
      const { buffer, bytesRead } = await file.read(Buffer.alloc(MAX_LOGIN_ITEM_BYTES + 1), 0, MAX_LOGIN_ITEM_BYTES + 1, 0);
      if (bytesRead > MAX_LOGIN_ITEM_BYTES) return notOurs;
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally { await file.close(); }
  } catch { return notOurs; }
  return [{ label: LEGACY_MENU_LOGIN_ITEM, state: isMenuLoginItem({ text }) ? "present" : "not-ours" }];
}
