import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createGhostgetAutomationProcess, AUTOMATION_CUSTODY_FILE } from "./ghostget-automation-process.ts";
const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
async function options(mode = "normal") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "butler-automation-child-"))); roots.push(root);
  return { executable: fileURLToPath(new URL("../test-fixtures/ghostget-automation.ts", import.meta.url)), runtimeExecutable: process.execPath, custodyDirectory: root, stateHome: join(root, mode), providers: [{ provider: "imessage" as const, authId: "fixture" }] };
}
test("private Ghostget process handshake and verified close release exact custody", async () => {
  const config = await options(); const process = await createGhostgetAutomationProcess(config);
  expect((await lstat(join(config.custodyDirectory, AUTOMATION_CUSTODY_FILE))).isFile()).toBe(true);
  await process.close(); await expect(lstat(join(config.custodyDirectory, AUTOMATION_CUSTODY_FILE))).rejects.toMatchObject({ code: "ENOENT" });
});
test("priority cancellation reaches a child that is waiting on its send result", async () => {
  const process = await createGhostgetAutomationProcess(await options());
  try {
    const controller = new AbortController();
    const submitting = process.client.submit("plan:fixture", "grant:fixture", controller.signal);
    // Queue submission is asynchronous; cancellation after one event-loop turn
    // drives the real child protocol while preserving the original response.
    await new Promise<void>(resolve => setImmediate(resolve)); controller.abort();
    expect(await submitting).toMatchObject({ state: "partial", totalActions: 2, accepted: [{ messageId: "sent:fixture", providerReceiptId: null }] });
  } finally { await process.close(); }
});
test("an invalid child response retains durable custody and blocks another process", async () => {
  const config = await options("wrong-id");
  await expect(createGhostgetAutomationProcess(config)).rejects.toThrow();
  expect((await lstat(join(config.custodyDirectory, AUTOMATION_CUSTODY_FILE))).isFile()).toBe(true);
  await expect(createGhostgetAutomationProcess(config)).rejects.toThrow("recovery");
});
