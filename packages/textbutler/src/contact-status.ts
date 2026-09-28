/** Owner-facing contact status projection. One contact's reply lane and its
 * staged shadow task are projected onto the shared `algal.host-lifecycle.v1`
 * record vocabulary. The projection is strictly read-only data: it never
 * sends, retries or mutates state, and it grants no authority. An "uncertain"
 * record is an instruction to reconcile the journaled intent, never to retry
 * it; message-send authority stays in the existing trusted dispatch path. */
import { buildHostLifecycle, digestCanonical, HOST_LIFECYCLE_CONTRACT, type Digest, type HostLifecycle, type JsonValue } from "@hraness/algal";
import type { ContactSettings } from "./config.ts";
import { inspectHabitatOperations, type HabitatLiveOperation, type HabitatOperation, type HabitatState } from "./contact-habitat.ts";
import { inspectHabitatTaskShadow } from "./habitat-task-shadow.ts";
import type { RunJournal, RunRecord } from "./journal.ts";

export const CONTACT_STATUS_CONTRACT = "textbutler.contact-status.v1" as const;

type LifecycleState = HostLifecycle["state"];
type OperatorAction = HostLifecycle["permittedOperatorActions"][number];

/** Shadow evidence kept beside the lifecycle record. `stale` and the two
 * revisions make a superseded artifact explicit instead of hiding it in a
 * state the shared vocabulary does not have. */
export type ContactShadowStatus = Readonly<{
  status: "empty" | "ready" | "stale";
  stale: boolean;
  artifactDigest: Digest | null;
  archiveDigest: Digest | null;
  previousDigest: Digest | null;
  denied: number;
  stagedOwnerRevision: number | null;
  ownerRevision: number;
  /** Shadow tasks are never selected for live replies; staging cannot change that. */
  activeForReplies: false;
}>;

export type ContactStatusProjection = Readonly<{
  contract: typeof CONTACT_STATUS_CONTRACT;
  contactId: string;
  /** Digest-bound `algal.host-lifecycle.v1` record: data only, no authority. */
  lifecycle: HostLifecycle;
  shadow: ContactShadowStatus;
}>;

const journalHex = (value: string | null): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** The open intent an "uncertain" record must retain. A journaled dispatch
 * plan digest names the exact recorded send intent; without one, a canonical
 * digest of the journaled run or claimed checkpoint identifies the intent
 * honestly. Never retried — reconciliation is the only resolution. */
function pendingIntent(uncertain: readonly RunRecord[], checkpoint: HabitatOperation | undefined, contactId: string): Digest | null {
  const send = uncertain[0];
  if (send !== undefined) {
    if (journalHex(send.planDigest)) return `sha256:${send.planDigest}`;
    return digestCanonical({ kind: "send-intent", contactId: send.contactId, runId: send.id, eventId: send.eventId, state: send.state } as JsonValue);
  }
  if (checkpoint !== undefined) {
    return digestCanonical({ kind: "habitat-checkpoint", contactId, key: checkpoint.checkpointKey ?? checkpoint.id } as JsonValue);
  }
  return null;
}

/** Project one contact's reply lane onto a host-lifecycle record. Reads only
 * the owner's retained state: settings, the journaled habitat snapshot and the
 * journaled send intents. Callers pass the same pause predicate the dispatch
 * path enforces (`settings.paused || !enabled || pausedUntil > now`). */
export function projectContactStatus(
  contact: Pick<ContactSettings, "id" | "enabled" | "pausedUntil">,
  habitat: HabitatState,
  journal: Pick<RunJournal, "uncertainRuns" | "recent">,
  options: Readonly<{ paused: boolean; scopedGrant: boolean; live?: HabitatLiveOperation | undefined; now: number }>,
): ContactStatusProjection {
  const { now } = options;
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid contact status clock");
  const ownerRevision = habitat.ownerRevision ?? 0;
  const shadow = inspectHabitatTaskShadow(habitat.taskShadow, habitat.champion, ownerRevision);
  const uncertain = journal.uncertainRuns(contact.id);
  const operations = inspectHabitatOperations(habitat, now, options.live);
  const uncertainCheckpoint = operations.find(operation => operation.state === "uncertain");
  const runs = journal.recent(contact.id, 200);
  const queued = operations.filter(operation => operation.state === "queued" || operation.state === "waiting").length;
  const active = operations.filter(operation => operation.state === "running").length
    + runs.filter(run => run.state === "running" || run.state === "dispatching").length;
  const suspended = options.paused || !contact.enabled || contact.pausedUntil > now;
  const intent = pendingIntent(uncertain, uncertainCheckpoint, contact.id);
  const latest = runs[0];
  const state: LifecycleState = intent !== null ? "uncertain"
    : suspended ? "suspended"
    : active > 0 ? "running"
    : shadow.status === "ready" || queued > 0 ? "ready"
    : latest !== undefined && (latest.state === "failed" || latest.state === "abandoned") ? "failed"
    : "settled";
  // Only what the owner can actually do through the existing control surface:
  // inspect and pause/resume always follow the suspend state; reconcile exists
  // only while a journaled send intent is open; rollback needs a retained
  // shadow artifact or learned ancestor; stop maps to disabling the contact.
  const actions = new Set<OperatorAction>(["inspect", suspended ? "resume" : "suspend"]);
  if (uncertain.length > 0) actions.add("reconcile");
  if (habitat.taskShadow?.current || habitat.ancestors.length > 0) actions.add("rollback");
  if (contact.enabled) actions.add("stop");
  const lifecycle = buildHostLifecycle({
    contract: HOST_LIFECYCLE_CONTRACT,
    owner: `contact:${contact.id}`,
    generation: ownerRevision,
    state,
    pendingIntent: intent,
    backlog: { queued, active },
    heldAuthority: options.scopedGrant ? ["scoped-messaging-grant"] : [],
    usage: { units: runs.length, charges: 0, unit: "journaled-run" },
    receipt: habitat.taskShadow?.current?.artifact.digest ?? null,
    permittedOperatorActions: [...actions].sort(),
  });
  // Artifact and archive digests are `sha256:`-validated at shadow admission;
  // reading the typed habitat state keeps the projection's digest types exact.
  const current = habitat.taskShadow?.current ?? null;
  const status: ContactShadowStatus["status"] = shadow.status === "ready" ? "ready" : shadow.status === "stale" ? "stale" : "empty";
  return {
    contract: CONTACT_STATUS_CONTRACT,
    contactId: contact.id,
    lifecycle,
    shadow: {
      status,
      stale: status === "stale",
      artifactDigest: current?.artifact.digest ?? null,
      archiveDigest: current === null ? null : current.archiveDigest as Digest,
      previousDigest: habitat.taskShadow?.previous?.artifact.digest ?? null,
      denied: habitat.taskShadow?.denied.length ?? 0,
      stagedOwnerRevision: current?.ownerRevision ?? null,
      ownerRevision,
      activeForReplies: false,
    },
  };
}
