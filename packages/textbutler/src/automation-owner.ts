import { MESSAGES_FDA, recoverySentence } from "./permission-copy.ts";
import { AUTOMATION_BINDING_CHANGED_REASON, AUTOMATION_ACTIONS, automationFailure, automationBindingDigest, automationHash, automationId, parseAutomationEnrollment, parseAutomationGrant, type AutomationFailure, type AutomationConversation,
  type AutomationEnrollment, type AutomationMessage, type AutomationGrant, type AutomationGrantRequest, type AutomationIdentity, type AutomationProvider, type AutomationStatus, type GhostgetAutomationClient } from "../../transport/src/automation.ts";
import type { HistoryMessage } from "./enrollment.ts";

/** Durable recipient identity. Readiness, revision and grants are intentionally separate. */
export type AutomationBinding = Readonly<{ version: 2; enrollmentId: string; identity: AutomationIdentity;
  conversation: AutomationConversation; bindingDigest: string; historyStart?: string; invalidated?: true }>;
export type AutomationCandidate = Readonly<{ identity: AutomationIdentity; conversation: AutomationConversation }>;
export type AutomationDiscoveryStatus = Readonly<{ providers: readonly Readonly<{
  provider: AutomationProvider; state: "complete" | "truncated" | "unavailable"; detail: string; failure?: AutomationFailure;
}>[] }>;
export interface OwnerAutomationPort {
  providers(): readonly AutomationProvider[];
  observedCapabilities(): readonly { status: AutomationStatus; observedAt: number }[];
  start(provider: AutomationProvider, signal: AbortSignal): Promise<void>;
  list(signal: AbortSignal): Promise<readonly AutomationCandidate[]>;
  /** Coverage of the last completed discovery, separate from send readiness. */
  discoveryStatus?(): AutomationDiscoveryStatus;
  enroll(candidate: AutomationCandidate, initializeHistory: boolean, signal: AbortSignal): Promise<{ binding: AutomationBinding; messages: HistoryMessage[] }>;
  validate(binding: AutomationBinding, signal: AbortSignal): Promise<AutomationEnrollment>;
  grant(binding: AutomationBinding, intentId: string, signal: AbortSignal): Promise<AutomationGrant>;
  /** Same validated delegation with owner-supplied tight bounds (action kinds,
   * quota and expiry) for a single explicit owner-initiated send. */
  grantScoped(binding: AutomationBinding, request: AutomationGrantRequest, intentId: string, signal: AbortSignal): Promise<AutomationGrant>;
  grantByIntent(intentId: string, signal: AbortSignal): Promise<AutomationGrant | null>;
  /** `maxStatusAgeMs` lets the automatic reply gate reuse a recent provider
   * status read; owner-initiated checks omit it and always read fresh. */
  grantStatus(binding: AutomationBinding, grantId: string, signal: AbortSignal, maxStatusAgeMs?: number): Promise<AutomationGrant>;
  revoke(id: string, signal?: AbortSignal): Promise<void>;
}
export function parseAutomationBinding(value: unknown): AutomationBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation owner binding");
  const row = value as Record<string, unknown>;
  const group = (row.conversation as { kind?: unknown } | undefined)?.kind === "group";
  const keys = group ? ["bindingDigest", "conversation", "enrollmentId", "historyStart", "identity", "version", ...(row.invalidated === true ? ["invalidated"] : [])].sort().join(",") : "bindingDigest,conversation,enrollmentId,identity,version";
  if (row.version !== 2 || Object.keys(row).sort().join(",") !== keys) throw new Error("Invalid automation owner binding");
  return Object.freeze({ ...automationBinding(parseAutomationEnrollment({ id: row.enrollmentId, identity: row.identity, conversation: row.conversation,
    bindingDigest: row.bindingDigest, revision: 0, ready: false, reason: null }), row.historyStart as string | undefined), ...(row.invalidated === true ? { invalidated: true as const } : {}) });
}
export function automationBinding(enrollment: AutomationEnrollment, historyStart?: string): AutomationBinding {
  const checked = parseAutomationEnrollment(enrollment);
  if (checked.conversation.kind === "group") {
    if (typeof historyStart !== "string" || !Number.isFinite(Date.parse(historyStart)) || new Date(historyStart).toISOString() !== historyStart) throw new Error("A group requires its trusted enrollment history floor");
  } else if (historyStart !== undefined) throw new Error("Direct conversation history is unchanged");
  return Object.freeze({ version: 2, enrollmentId: checked.id, identity: Object.freeze(checked.identity),
    conversation: Object.freeze({ ...checked.conversation, coordinate: Object.freeze(checked.conversation.coordinate), participants: Object.freeze([...checked.conversation.participants]) }), bindingDigest: checked.bindingDigest, ...(historyStart === undefined ? {} : { historyStart }) });
}
export function assertAutomationBinding(expected: AutomationBinding, observed: AutomationEnrollment): void {
  const current = automationBinding(observed, expected.historyStart);
  parseAutomationBinding(expected);
  if (expected.invalidated) throw new Error("This group enrollment was invalidated. Select the group again.");
  if (current.enrollmentId !== expected.enrollmentId || current.bindingDigest !== expected.bindingDigest || !observed.ready && observed.reason === AUTOMATION_BINDING_CHANGED_REASON) throw new Error("Messaging account or conversation changed. Enroll it again explicitly.");
}

/** A local clock floor complements GhostGet's enrollment cursor/ID boundary.
 * The upstream boundary is still required: authored timestamps alone cannot
 * prove the membership under which a message was observed. */
export function scopedAutomationHistory(binding: AutomationBinding, messages: readonly AutomationMessage[]): AutomationMessage[] {
  if (binding.conversation.kind !== "group") return [...messages];
  parseAutomationBinding(binding);
  if (binding.invalidated) throw new Error("This group enrollment was invalidated");
  return messages.filter(message => Date.parse(message.occurredAt) >= Date.parse(binding.historyStart!));
}

/** Owner copy for a provider whose conversations couldn't be listed. An
 * unreadable Messages database is almost always Full Disk Access, which is
 * Textbutler's setting in System Settings, not a Ghostget setting. */
export function discoveryFailureDetail(provider: AutomationProvider, name: string, failure: AutomationFailure): string {
  if (provider === "imessage" && failure.native?.code === "database-unreadable") return recoverySentence(MESSAGES_FDA, "unknown");
  return `${name} conversations are unavailable. Check its connection and sign-in in Ghostget, then refresh.`;
}

/** Trusted owner control path. The model never receives this client or its grants. */
export function createAutomationOwnerPort(options: { client: GhostgetAutomationClient; providers: readonly AutomationProvider[]; now?: () => number }): OwnerAutomationPort {
  const client = options.client, providers = [...options.providers], now = options.now ?? Date.now;
  const statuses = new Map<AutomationProvider, { status: AutomationStatus; observedAt: number }>();
  let discovery: AutomationDiscoveryStatus = { providers: [] };
  const remember = (status: AutomationStatus) => { statuses.set(status.identity.provider, { status: structuredClone(status), observedAt: now() }); };
  if (!providers.length || providers.length > 3 || new Set(providers).size !== providers.length || providers.some(value => value !== "imessage" && value !== "whatsapp" && value !== "beeper")) throw new Error("Invalid owner messaging networks");
  const validate = async (binding: AutomationBinding, signal: AbortSignal) => {
    const expected = parseAutomationBinding(binding); signal.throwIfAborted();
    if (expected.conversation.kind === "group" && (await client.features(signal)).groupConversations?.version !== 1) throw new Error("Group automation is unavailable");
    if (!providers.includes(expected.identity.provider)) throw new Error("Messaging provider is not configured");
    const observed = await client.poll(expected.enrollmentId, signal); signal.throwIfAborted(); assertAutomationBinding(expected, observed);
    if (!observed.ready) throw new Error("Messaging catchup or provider setup is incomplete");
    return observed;
  };
  return {
    providers: () => [...providers],
    observedCapabilities: () => [...statuses.values()].map(value => structuredClone(value)),
    discoveryStatus: () => structuredClone(discovery),
    async start(provider, signal) {
      if (!providers.includes(provider)) throw new Error("Messaging provider is not configured");
      signal.throwIfAborted();
      // Ghostget starts an owned sync process only for WhatsApp. Messages and
      // Beeper already run outside that process and expose readiness via status.
      const status = await (provider === "whatsapp" ? client.start(provider, signal) : client.status(provider, signal)); signal.throwIfAborted();
      remember(status);
      if (status.identity.provider !== provider || !status.connected || !status.events.available) throw new Error("Messaging connection or event stream is unavailable");
    },
    async list(signal) {
      const result: AutomationCandidate[] = [];
      const observed: AutomationDiscoveryStatus["providers"][number][] = [];
      const limit = Math.floor(200 / providers.length);
      discovery = { providers: [] };
      let groups = false, groupFailure: AutomationFailure | undefined;
      try { groups = (await client.features(signal)).groupConversations?.version === 1; }
      catch (error) { signal.throwIfAborted(); groupFailure = automationFailure(error); }
      for (const provider of providers) {
        signal.throwIfAborted();
        const name = provider === "imessage" ? "iMessage" : provider === "whatsapp" ? "WhatsApp" : "Beeper";
        try {
          const page = await client.conversations(provider, limit, signal, groups); signal.throwIfAborted();
          for (const conversation of page.conversations) result.push({ identity: page.identity, conversation });
          observed.push({ provider, state: page.complete && !groupFailure ? "complete" : "truncated",
            ...(groupFailure ? { failure: groupFailure } : {}),
            detail: groupFailure ? `${name} direct conversations are listed. Group discovery is unavailable; check or update GhostGet.` : page.complete ? `${name} conversation list is complete.` : `${name} returned a partial list of up to ${limit} recent conversations. Older conversations may be missing.` });
        } catch (error) {
          signal.throwIfAborted();
          const failure = automationFailure(error);
          observed.push({ provider, state: "unavailable", detail: discoveryFailureDetail(provider, name, failure), failure });
        }
      }
      signal.throwIfAborted(); discovery = { providers: observed }; return result;
    },
    async enroll(candidate, initializeHistory, signal) {
      signal.throwIfAborted();
      if (!providers.includes(candidate.identity.provider) || candidate.identity.provider !== candidate.conversation.coordinate.provider) throw new Error("Messaging candidate is not configured");
      const expectedDigest = automationBindingDigest(candidate.identity, candidate.conversation);
      // A completed upstream enrollment may survive a cancelled local commit. Reuse only
      // the exact identity/conversation; never manufacture a second enrollment or grant.
      const historyStart = candidate.conversation.kind === "group" ? new Date(now()).toISOString() : undefined;
      const existing = (await client.enrollments(signal, candidate.conversation.kind === "group")).filter(enrollment => enrollment.bindingDigest === expectedDigest && enrollment.reason !== AUTOMATION_BINDING_CHANGED_REASON);
      if (existing.length > 1) throw new Error("Ambiguous messaging enrollment");
      const enrollment = existing[0] ?? await client.enroll(candidate.identity.provider, candidate.conversation.coordinate, signal);
      if (enrollment.bindingDigest !== expectedDigest) throw new Error("Messaging identity changed during enrollment");
      const binding = automationBinding(enrollment, historyStart);
      await validate(binding, signal);
      const messages: HistoryMessage[] = [];
      if (initializeHistory && binding.conversation.kind === "single") {
        const history = await client.history(binding.enrollmentId, 200, signal); assertAutomationBinding(binding, history.enrollment);
        for (const message of history.messages) {
          if (message.kind !== "message" || message.text === null || message.direction === "unknown") continue;
          messages.push({ id: message.id, at: Date.parse(message.occurredAt), text: message.text,
            // Butler provenance comes from the send journal (control-service reauthor), not a hardcoded wrap.
            author: message.direction === "incoming" ? "contact" : "owner" });
        }
      }
      signal.throwIfAborted(); return { binding, messages };
    },
    validate,
    async grant(binding, intentId, signal) {
      await validate(binding, signal);
      const status = await client.status(binding.identity.provider, signal); signal.throwIfAborted();
      remember(status);
      if (automationHash(status.identity) !== automationHash(binding.identity) || !status.connected || !status.events.available || !status.actions.text.available) throw new Error("Messaging delegation is unavailable");
      const actions = AUTOMATION_ACTIONS.filter(action => status.actions[action].available);
      return parseAutomationGrant(await client.grant({ enrollmentId: binding.enrollmentId, expectedBindingDigest: binding.bindingDigest,
        actions, expiresAt: new Date(now() + 30 * 86_400_000).toISOString(), maximumActions: 100_000, minimumIntervalMs: 0 }, intentId, signal));
    },
    async grantScoped(binding, request, intentId, signal) {
      await validate(binding, signal);
      const status = await client.status(binding.identity.provider, signal); signal.throwIfAborted();
      remember(status);
      if (automationHash(status.identity) !== automationHash(binding.identity) || !status.connected || !status.events.available) throw new Error("Messaging delegation is unavailable");
      if (automationId(request.enrollmentId) !== binding.enrollmentId || request.expectedBindingDigest !== binding.bindingDigest) throw new Error("Scoped grant changed its recipient");
      const actions = request.actions.map(action => { if (!AUTOMATION_ACTIONS.includes(action) || !status.actions[action].available) throw new Error("Requested action is unavailable"); return action; });
      if (!actions.length || actions.length > 8 || new Set(actions).size !== actions.length) throw new Error("Scoped grant needs 1-8 distinct actions");
      const expiresAt = Date.parse(request.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now() || expiresAt > now() + 30 * 86_400_000
        || !Number.isSafeInteger(request.maximumActions) || request.maximumActions < 1 || request.maximumActions > 100_000
        || !Number.isSafeInteger(request.minimumIntervalMs) || request.minimumIntervalMs < 0 || request.minimumIntervalMs > 86_400_000) throw new Error("Scoped grant bounds are invalid");
      return parseAutomationGrant(await client.grant({ enrollmentId: binding.enrollmentId, expectedBindingDigest: binding.bindingDigest,
        actions, expiresAt: new Date(expiresAt).toISOString(), maximumActions: request.maximumActions, minimumIntervalMs: request.minimumIntervalMs }, intentId, signal));
    },
    grantByIntent: (intentId, signal) => client.grantByIntent(intentId, signal),
    async grantStatus(binding, grantId, signal, maxStatusAgeMs = 0) {
      const expected = parseAutomationBinding(binding);
      const grant = await client.grantStatus(grantId, signal);
      if (grant.enrollmentId !== expected.enrollmentId || grant.expectedBindingDigest !== expected.bindingDigest) throw new Error("Messaging grant changed recipient");
      const status = await client.status(expected.identity.provider, signal, maxStatusAgeMs); signal.throwIfAborted();
      if (automationHash(status.identity) !== automationHash(expected.identity) || !status.connected || !status.events.available) throw new Error("Messaging grant changed provider identity or became unavailable");
      remember(status); return grant;
    },
    revoke: (id, signal) => client.revoke(id, signal),
  };
}
