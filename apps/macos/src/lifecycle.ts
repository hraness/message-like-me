export const LIFECYCLE_PROTOCOL = "textbutler.lifecycle.v1" as const;
export type LifecycleCommand = "status" | "install" | "uninstall";
export interface LifecycleResult {
  ok: boolean;
  status: "completed" | "unavailable" | "indeterminate";
  installation: "absent" | "installed" | "conflict" | "indeterminate" | "unsupported" | null;
  service: "not-loaded" | "loaded" | "running" | "unknown";
  detail: string;
}
export interface DesktopLifecyclePort { request(command: LifecycleCommand): Promise<LifecycleResult> }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native lifecycle response");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Invalid native lifecycle detail");
  return value;
}
export function parseLifecycleResult(value: unknown): LifecycleResult {
  const row = record(value);
  if (row.protocol !== LIFECYCLE_PROTOCOL || typeof row.ok !== "boolean" || !["completed", "unavailable", "indeterminate"].includes(String(row.status))) throw new Error("Incompatible native lifecycle response");
  if (row.status !== "completed") {
    if (row.ok || row.result !== undefined) throw new Error("Invalid native lifecycle failure");
    return { ok: false, status: row.status as "unavailable" | "indeterminate", installation: null, service: "unknown", detail: text(row.message) };
  }
  const result = record(row.result), agent = record(result.launchAgent);
  if (typeof result.ok !== "boolean" || row.ok !== result.ok || agent.label !== "app.textbutler.daemon" || result.automaticReplies !== "unavailable" || agent.automaticReplies !== "unavailable"
    || !["absent", "installed", "conflict", "indeterminate", "unsupported"].includes(String(agent.installation))
    || !["not-loaded", "loaded", "running", "unknown"].includes(String(agent.service))) throw new Error("Unexpected native service identity");
  return { ok: row.ok, status: "completed", installation: agent.installation as LifecycleResult["installation"], service: agent.service as LifecycleResult["service"], detail: text(agent.detail) };
}
export const nativeLifecyclePort: DesktopLifecyclePort = {
  async request(command) {
    if (!window.__TAURI__) return { ok: false, status: "unavailable", installation: null, service: "unknown", detail: "Open the installed Textbutler Mac app to manage the background service." };
    return parseLifecycleResult(await window.__TAURI__.core.invoke("lifecycle_request", { request: { protocol: LIFECYCLE_PROTOCOL, command } }));
  },
};
