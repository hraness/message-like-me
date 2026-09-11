import { CONTROL_PROTOCOL, disconnectedSnapshot, parseControlResponse, type DesktopControlPort } from "./control.ts";

declare global { interface Window { __TAURI__?: { core: { invoke(command: string, args: Record<string, unknown>): Promise<unknown> } } } }

export const nativePort: DesktopControlPort = {
  async request(request) {
    if (!window.__TAURI__) {
      if (request.command === "snapshot") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: disconnectedSnapshot("Open the bundled macOS app to connect to the local daemon.") };
      return { protocol: CONTROL_PROTOCOL, ok: false, code: "disconnected", message: "The native control channel is unavailable." };
    }
    const response = parseControlResponse(await window.__TAURI__.core.invoke("control_request", { request }));
    if (!response.ok && response.code === "disconnected" && request.command === "snapshot") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "snapshot", snapshot: disconnectedSnapshot(response.message) };
    if (response.ok && response.kind === "snapshot" && response.snapshot.connection === "demo") throw new Error("The native daemon cannot return synthetic preview data.");
    return response;
  },
};
