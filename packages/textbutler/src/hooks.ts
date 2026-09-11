export type HookName = "message.received" | "reply.decide" | "reply.compose" | "reply.before-send" | "reply.sent" | "memory.updated" | "run.failed";
export type HookContext = Readonly<{ contactId: string; runId: string; eventId: string; signal: AbortSignal }>;
export type HookResult = Readonly<{ veto?: boolean; note?: string }>;
export type Hook = (context: HookContext) => Promise<HookResult | void>;
export type Extension = Readonly<{ id: string; version: string; hooks: Partial<Record<HookName, Hook>> }>;

/** Owner-installed application code only. Never load a module from an agent workspace.
 * Extensions share the daemon's trust and may veto a reply, but cannot grant authority. */
export class Hooks {
  private readonly extensions: Extension[] = [];
  constructor(private readonly timeoutMs = 2_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid hook timeout");
  }
  register(extension: Extension): void {
    if (!/^[a-z0-9][a-z0-9.-]{0,79}$/u.test(extension.id) || this.extensions.some(e => e.id === extension.id) || !/^\d+\.\d+\.\d+$/u.test(extension.version)) throw new Error("Invalid extension identity");
    this.extensions.push(Object.freeze({ ...extension, hooks: Object.freeze({ ...extension.hooks }) }));
  }
  async emit(name: HookName, context: HookContext): Promise<HookResult> {
    for (const extension of this.extensions) {
      const hook = extension.hooks[name];
      if (!hook) continue;
      if (context.signal.aborted) throw new Error("Run cancelled");
      const controller = new AbortController();
      const abort = () => controller.abort();
      context.signal.addEventListener("abort", abort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          hook(Object.freeze({ ...context, signal: controller.signal })),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error(`Hook timed out: ${extension.id}`)); }, this.timeoutMs);
          }),
        ]);
        if (context.signal.aborted) throw new Error("Run cancelled");
        if (result?.veto) return { veto: true, note: typeof result.note === "string" ? result.note.slice(0, 400) : "Extension veto" };
      } finally {
        if (timer) clearTimeout(timer);
        context.signal.removeEventListener("abort", abort);
        controller.abort();
      }
    }
    return {};
  }
}
