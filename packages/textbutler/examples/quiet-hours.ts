/** Owner-installed application code. Copy into Textbutler/plugins, then list it
 * in extensions.json. Hours are UTC; adapt this to the owner's preferences. */
export default {
  id: "quiet-hours",
  version: "1.0.0",
  hooks: {
    "reply.before-send": async ({ signal }: { signal: AbortSignal }) => {
      signal.throwIfAborted();
      const hour = new Date().getUTCHours();
      if (hour < 8 || hour >= 22) return { veto: true, note: "Quiet hours" };
    },
  },
};
