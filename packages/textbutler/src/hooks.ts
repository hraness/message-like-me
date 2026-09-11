export const HOOK_NAMES = ["message.received", "reply.decide", "reply.compose", "reply.before-send", "reply.sent", "memory.updated", "run.failed"] as const;
export type HookName = typeof HOOK_NAMES[number];
export type HookContext = Readonly<{ contactId: string; runId: string; eventId: string; signal: AbortSignal; changedFile?: Readonly<{ path: string; revision: string }> }>;
export type HookResult = Readonly<{ veto?: boolean; note?: string }>;
export type Hook = (context: HookContext) => Promise<HookResult | void>;
export type Extension = Readonly<{ id: string; version: string; hooks: Partial<Record<HookName, Hook>> }>;

export function validateExtension(value: unknown): Extension {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid extension");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 3 || typeof item.id !== "string" || !/^[a-z0-9][a-z0-9.-]{0,79}$/u.test(item.id) || typeof item.version !== "string" || !/^\d+\.\d+\.\d+$/u.test(item.version) || !item.hooks || typeof item.hooks !== "object" || Array.isArray(item.hooks)) throw new Error("Invalid extension identity");
  if (Object.keys(item.hooks).some(name => !(HOOK_NAMES as readonly string[]).includes(name) || typeof (item.hooks as Record<string, unknown>)[name] !== "function")) throw new Error("Invalid extension hook");
  return Object.freeze({ id: item.id, version: item.version, hooks: Object.freeze({ ...item.hooks }) }) as Extension;
}

/** Owner-installed application code only. Never load a module from an agent workspace.
 * Extensions share the daemon's trust and may veto a reply, but cannot grant authority. */
export class Hooks {
  private readonly extensions: Extension[] = [];
  constructor(private readonly timeoutMs = 2_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid hook timeout");
  }
  register(extension: Extension): void {
    const validated = validateExtension(extension);
    if (this.extensions.some(e => e.id === validated.id)) throw new Error("Duplicate extension identity");
    this.extensions.push(validated);
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
