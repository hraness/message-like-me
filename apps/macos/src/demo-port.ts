/** Synthetic browser preview. This module must never enter the native bundle. */
import { CONTROL_PROTOCOL, DEFAULT_CONTACT_SETTINGS, disconnectedSnapshot, validateContactSettings, type ContactSettings, type DesktopControlPort, type DesktopSnapshot } from "./control.ts";

export function createDemoPort(): DesktopControlPort {
  const state: DesktopSnapshot = {
    ...disconnectedSnapshot(), connection: "demo", detail: "Synthetic preview. Changes stay in this page and reset when it closes.",
    settings: { paused: false, activeContactLimit: 5 },
    contacts: [
      { id: "synthetic-alex", name: "Alex Morgan", subtitle: "Sample contact · iMessage", settings: { ...structuredClone(DEFAULT_CONTACT_SETTINGS), enabled: true } },
      { id: "synthetic-sam", name: "Sam Rivera", subtitle: "Sample contact · iMessage", settings: { ...structuredClone(DEFAULT_CONTACT_SETTINGS), enabled: true, provider: "claude" } },
      { id: "synthetic-jamie", name: "Jamie Chen", subtitle: "Sample contact · iMessage", settings: { ...structuredClone(DEFAULT_CONTACT_SETTINGS), responseMode: "keyword" } },
      { id: "synthetic-taylor", name: "Taylor Brooks", subtitle: "Sample contact · iMessage", settings: structuredClone(DEFAULT_CONTACT_SETTINGS) },
    ],
    activity: [],
  };
  const memories = new Map(state.contacts.map(contact => [contact.id, `# ${contact.name}\n\nThis is synthetic example memory for the interface preview.\n\n## Guidance\n- Be helpful and concise.\n- Ask when an answer depends on information you do not have.\n- Keep the owner's active conversations uninterrupted.\n\n## Remembered context\nNo real conversation has been imported.\n`]));
  const revision = async (content: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))].map(value => value.toString(16).padStart(2, "0")).join("");
  const snapshot = () => ({ protocol: CONTROL_PROTOCOL, ok: true as const, kind: "snapshot" as const, snapshot: structuredClone(state) });
  const failure = (code: "invalid-request" | "capacity" | "conflict", message: string) => ({ protocol: CONTROL_PROTOCOL, ok: false as const, code, message });
  return { async request(request) {
    if (request.command === "snapshot" || request.command === "activity.list") return snapshot();
    if (request.command === "owner.job.read") return failure("invalid-request", "This synthetic preview has no background job.");
    if (request.command === "provider.accounts.check") return failure("invalid-request", "This synthetic preview does not connect provider accounts.");
    if (request.command === "messaging.start") return failure("invalid-request", "This synthetic preview does not connect messaging providers.");
    if (request.command === "conversations.list") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "conversations", detail: "Synthetic examples only. No Messages or Contacts data was read.", candidates: state.contacts.some(contact => contact.id === "synthetic-casey") ? [] : [
      { id: "synthetic-candidate-casey", name: "Casey Jordan", subtitle: "Sample one-to-one conversation", eligible: true, reason: "Ready to add" },
      { id: "synthetic-candidate-group", name: "Weekend plans", subtitle: "Sample group conversation", eligible: false, reason: "Group conversations are not supported" },
    ] };
    if (request.command === "contact.enroll") {
      if (request.expectedRevision !== state.revision) return failure("conflict", "Settings changed. Refresh before adding a contact.");
      if (request.candidateId !== "synthetic-candidate-casey" || state.contacts.some(contact => contact.id === "synthetic-casey")) return failure("invalid-request", "Choose an available sample conversation.");
      state.contacts.push({ id: "synthetic-casey", name: "Casey Jordan", subtitle: "Sample contact · iMessage", settings: structuredClone(DEFAULT_CONTACT_SETTINGS) });
      memories.set("synthetic-casey", "# Casey Jordan\n\nSynthetic preview memory. No real conversation was imported.\n"); state.revision++;
      return { protocol: CONTROL_PROTOCOL, ok: true, kind: "enrolled", snapshot: structuredClone(state), contactId: "synthetic-casey", historyInitialized: request.initializeHistory, historyCount: 0, historyOmittedCount: 0, historyShortenedCount: 0 };
    }
    const contact = "contactId" in request ? state.contacts.find(contact => contact.id === request.contactId) : null;
    if ("contactId" in request && !contact) return failure("invalid-request", "This sample contact no longer exists.");
    if (request.command === "contact.memory.read") return { protocol: CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: request.contactId, revision: await revision(memories.get(request.contactId) ?? ""), content: memories.get(request.contactId) ?? "" };
    if (request.command !== "contact.memory.write" && request.expectedRevision !== state.revision) return failure("conflict", "Settings changed. Reload before saving again.");
    if (request.command === "contact.settings.update" && contact) {
      const error = validateContactSettings(request.settings); if (error) return failure("invalid-request", error);
      if (request.settings.enabled && !contact.settings.enabled && state.contacts.filter(contact => contact.settings.enabled).length >= state.settings.activeContactLimit) return failure("capacity", "The active contact limit is reached. Disable a contact or raise the limit.");
      contact.settings = structuredClone(request.settings as ContactSettings);
    } else if (request.command === "global.settings.update") {
      const limit = request.settings.activeContactLimit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) return failure("invalid-request", "Choose a contact limit between 1 and 50.");
      if (limit < state.contacts.filter(contact => contact.settings.enabled).length) return failure("capacity", "Disable contacts before lowering the limit below the active count.");
      state.settings = structuredClone(request.settings);
    } else if (request.command === "contact.memory.write") {
      if (request.expectedRevision !== await revision(memories.get(request.contactId) ?? "")) return failure("conflict", "Memory changed. Reload before saving again.");
      if (request.content.length > 65_536) return failure("invalid-request", "Keep memory below 65,536 characters.");
      memories.set(request.contactId, request.content);
      state.activity.unshift({ id: `synthetic-memory-${state.activity.length + 1}`, at: new Date().toISOString(), contactId: request.contactId, title: "Preview memory saved", detail: "Only the synthetic contact memory changed." });
      return { protocol: CONTROL_PROTOCOL, ok: true, kind: "memory", contactId: request.contactId, revision: await revision(request.content), content: request.content };
    }
    state.revision++;
    state.activity.unshift({ id: `synthetic-event-${state.revision}`, at: new Date().toISOString(), contactId: contact?.id ?? null, title: "Preview change saved", detail: "Only this synthetic preview changed. No message or agent action occurred." });
    return snapshot();
  } };
}
