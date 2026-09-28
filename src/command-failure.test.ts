import { expect, test } from "bun:test";
import { translateContactsError, translateIMessageError } from "./command-failure";
import { CliError } from "./errors";
import { main } from "./cli";
import type { CommandIo } from "./io";

function failure(translate: (error: unknown) => never, code: string): CliError {
  try { translate(Object.assign(new Error("denied"), { code })); }
  catch (error) { if (error instanceof CliError) return error; throw error; }
  throw new Error("expected a failure");
}

test("an unreadable Messages or Contacts source names Full Disk Access and links its pane", () => {
  for (const [translate, what] of [[translateIMessageError, "Messages"], [translateContactsError, "Contacts"]] as const) {
    for (const code of ["EACCES", "EPERM"]) {
      const error = failure(translate, code);
      expect(error.kind).toBe("permission");
      expect(error.exitCode).toBe(5);
      expect(error.message).toBe(`Message Like Me can't read your ${what} data: macOS access is off for the app running this command. `
        + "Turn on your terminal or agent app in System Settings › Privacy & Security › Full Disk Access "
        + "(x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles), then retry.");
    }
  }
});

test("root help carries no Textbutler banner", async () => {
  let stdout = "";
  const io: CommandIo = { stdout: text => { stdout += text; }, stderr: () => undefined, now: () => new Date(0) };
  expect(await main([], io)).toBe(0);
  expect(stdout).toStartWith("Message Like Me ");
  expect(stdout).not.toContain("textbutler");
});
