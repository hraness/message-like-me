import { expect, test } from "bun:test";
import { LIFECYCLE_PROTOCOL, parseLifecycleResult } from "./lifecycle.ts";
const response = () => ({ protocol: LIFECYCLE_PROTOCOL, ok: true, status: "completed", result: { ok: true, launchAgent: { label: "app.textbutler.daemon", installation: "installed", service: "loaded", detail: "Service installed", automaticReplies: "unavailable" }, automaticReplies: "unavailable" } });
test("native lifecycle accepts only the Textbutler service result", () => {
  expect(parseLifecycleResult(response())).toMatchObject({ ok: true, installation: "installed", service: "loaded" });
  const other = response(); other.result.launchAgent.label = "other.service"; expect(() => parseLifecycleResult(other)).toThrow();
  const contradicted = response(); contradicted.result.ok = false; expect(() => parseLifecycleResult(contradicted)).toThrow();
  const drift = response(); drift.result.launchAgent.installation = "enabled"; expect(() => parseLifecycleResult(drift)).toThrow();
});
test("unknown native outcomes stay unknown without fabricating installed status", () => {
  expect(parseLifecycleResult({ protocol: LIFECYCLE_PROTOCOL, ok: false, status: "indeterminate", message: "Check service status" })).toEqual({ ok: false, status: "indeterminate", installation: null, service: "unknown", detail: "Check service status" });
  expect(() => parseLifecycleResult({ protocol: LIFECYCLE_PROTOCOL, ok: true, status: "indeterminate", message: "unknown" })).toThrow();
  expect(() => parseLifecycleResult({ protocol: LIFECYCLE_PROTOCOL, ok: false, status: "indeterminate", result: response().result, message: "unknown" })).toThrow();
});
