import { CONTROL_PROTOCOL, type ControlRequest, type ControlResponse, type DesktopControlPort, type DesktopSnapshot } from "./control.ts";
/** Poll only an owner job issued by this request. Each native exchange retains its own deadline. */
export async function requestWithJobs(port: DesktopControlPort, request: ControlRequest, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), onJob?: () => void): Promise<ControlResponse> {
  let response = await port.request(request);
  const jobId = response.ok && response.kind === "job" ? response.jobId : null;
  if (jobId) onJob?.();
  for (let poll = 0; response.ok && response.kind === "job"; poll++) {
    if (response.jobId !== jobId) throw new Error("The daemon returned a different owner job.");
    if (poll >= 300) throw new Error("The Messages read is taking too long. Reload before retrying a change.");
    await wait(500);
    response = await port.request({ protocol: CONTROL_PROTOCOL, command: "owner.job.read", jobId: response.jobId });
  }
  return response;
}

/** A late owner-job receipt must never undo a more recent global pause. */
export function newerSnapshot(current: DesktopSnapshot, incoming: DesktopSnapshot): DesktopSnapshot {
  return incoming.revision >= current.revision ? incoming : current;
}

/** Preserve the owner's captured pause intent across one concurrent settings commit. */
export async function requestPause(port: DesktopControlPort, snapshot: DesktopSnapshot, paused: boolean): Promise<ControlResponse> {
  const update = (current: DesktopSnapshot) => port.request({ protocol: CONTROL_PROTOCOL, command: "global.settings.update", expectedRevision: current.revision, settings: { ...current.settings, paused } });
  const response = await update(snapshot);
  if (response.ok || response.code !== "conflict") return response;
  const fresh = await port.request({ protocol: CONTROL_PROTOCOL, command: "snapshot" });
  if (!fresh.ok) return fresh;
  if (fresh.kind !== "snapshot") throw new Error("The daemon returned an unexpected pause readback.");
  if (fresh.snapshot.settings.paused === paused) return fresh;
  return update(fresh.snapshot);
}
