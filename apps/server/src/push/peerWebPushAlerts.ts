/**
 * Which changes on a linked environment's threads send a phone push. A phone subscribes on
 * one server only, so this server polls its links' thread listings (`t3_thread_list`) and
 * announces for them. Pure, so the rules can be tested without a peer; WebPushNotifier
 * feeds it each poll.
 */
import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

import {
  decideThreadAlert,
  NOTHING_ANNOUNCED,
  observeThreadAlert,
  type WebPushAlertKind,
  type WebPushAlertObservation,
} from "./webPushAlerts.ts";

/** The fields of a `t3_thread_list` item the alerts read. */
export interface PeerAlertThread {
  readonly threadId: string;
  readonly title: string;
  readonly status: string;
  readonly latestRunId: string | null;
  readonly settled: boolean;
  readonly snoozed: boolean;
  readonly parentThreadId: string | null;
  readonly relationshipToParent: "fork" | "subagent" | null;
  readonly delegatedFrom?: unknown;
  /** Absent when nothing waits, and from peers that predate it. */
  readonly pendingRequest?: { readonly requestId: string; readonly kind: string } | undefined;
  readonly createdAt: string;
}

/** What this server remembers about one linked environment's threads. */
export interface PeerAlertMemory {
  /** False until the first listing, which only records what is already there. */
  seeded: boolean;
  /** The newest thread creation that listing held, by the peer's own clock. */
  seededThrough: string | null;
  /** The last occasion seen per top-level thread; see decideThreadAlert. */
  readonly remembered: Map<string, string>;
  /** The last request announced for each subagent, which asks on its top-level thread. */
  readonly childRequests: Map<string, string>;
  readonly heldCompletions: Map<string, { readonly identity: string; readonly dueAt: number }>;
}

export const makePeerAlertMemory = (): PeerAlertMemory => ({
  seeded: false,
  seededThrough: null,
  remembered: new Map(),
  childRequests: new Map(),
  heldCompletions: new Map(),
});

export interface PeerAlert {
  /** The top-level thread to open, which for a subagent's question is not the asker. */
  readonly threadId: string;
  readonly threadTitle: string;
  readonly kind: WebPushAlertKind;
}

/** A request the user answers; an auth refresh is the provider's own business. */
const userRequest = (thread: PeerAlertThread) =>
  thread.pendingRequest !== undefined && thread.pendingRequest.kind !== "auth_refresh"
    ? thread.pendingRequest
    : undefined;

const requestKind = (kind: string): WebPushAlertKind =>
  kind === "user_input" ? "input" : "approval";

/**
 * The awareness phase a listing implies, as projectThreadAwarenessV2 works it out here. The
 * listing already reports background work that holds a finished turn as `waiting`, so such
 * a turn is announced once that work is done, not when its reply lands.
 */
export function peerThreadPhase(thread: PeerAlertThread): AgentAwarenessPhase | null {
  const request = userRequest(thread);
  if (request !== undefined) {
    return request.kind === "user_input" ? "waiting_for_input" : "waiting_for_approval";
  }
  switch (thread.status) {
    case "preparing":
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    // Settled work is hidden, as the projection hides it.
    case "completed":
      return thread.settled ? null : "completed";
    case "failed":
      return thread.settled ? null : "failed";
    default:
      return null;
  }
}

export function observePeerThreadAlert(thread: PeerAlertThread): WebPushAlertObservation | null {
  const request = userRequest(thread);
  return observeThreadAlert({
    // Linked environments list no archived threads.
    thread: {
      archivedAt: null,
      latestRunId: thread.latestRunId,
      pendingRuntimeRequest:
        request === undefined ? null : { id: request.requestId, kind: request.kind },
      status: thread.status,
    },
    phase: peerThreadPhase(thread),
    snoozed: thread.snoozed,
  });
}

const MAX_REMEMBERED_PEER_ENTRIES = 2_000;

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, limit = MAX_REMEMBERED_PEER_ENTRIES) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

const isSubagent = (thread: PeerAlertThread) => thread.relationshipToParent === "subagent";

/** The listed top-level thread above a subagent, or null when it is not in the listing. */
function topLevelOf(
  child: PeerAlertThread,
  byId: ReadonlyMap<string, PeerAlertThread>,
): PeerAlertThread | null {
  const seen = new Set<string>([child.threadId]);
  let current: PeerAlertThread | undefined = child;
  while (current !== undefined && isSubagent(current)) {
    const parentId: string | null = current.parentThreadId;
    if (parentId === null || seen.has(parentId)) return null;
    seen.add(parentId);
    current = byId.get(parentId);
  }
  return current ?? null;
}

/**
 * Applies one listing to `memory` and returns what to announce, with the time a held
 * completion is due for another look (null when none is held). The first listing only
 * records: whatever is already waiting or finished was there before this server watched.
 */
export function stepPeerAlerts(
  memory: PeerAlertMemory,
  threads: ReadonlyArray<PeerAlertThread>,
  nowMillis: number,
  completionConfirmMillis: number,
): { readonly alerts: ReadonlyArray<PeerAlert>; readonly recheckAt: number | null } {
  if (!memory.seeded) {
    for (const thread of threads) {
      if (memory.seededThrough === null || thread.createdAt > memory.seededThrough) {
        memory.seededThrough = thread.createdAt;
      }
      if (isSubagent(thread)) {
        const request = userRequest(thread);
        if (request !== undefined)
          setBounded(memory.childRequests, thread.threadId, request.requestId);
        continue;
      }
      setBounded(
        memory.remembered,
        thread.threadId,
        observePeerThreadAlert(thread)?.identity ?? NOTHING_ANNOUNCED,
      );
    }
    memory.seeded = true;
    return { alerts: [], recheckAt: null };
  }

  const byId = new Map(threads.map((thread) => [thread.threadId, thread]));
  const alerts: Array<PeerAlert> = [];
  let recheckAt: number | null = null;
  const recheckBy = (dueAt: number) => {
    recheckAt = recheckAt === null ? dueAt : Math.min(recheckAt, dueAt);
  };

  for (const thread of threads) {
    if (isSubagent(thread)) {
      const request = userRequest(thread);
      if (request === undefined || memory.childRequests.get(thread.threadId) === request.requestId)
        continue;
      setBounded(memory.childRequests, thread.threadId, request.requestId);
      const topLevel = topLevelOf(thread, byId);
      if (topLevel === null) continue;
      alerts.push({
        threadId: topLevel.threadId,
        threadTitle: topLevel.title,
        kind: requestKind(request.kind),
      });
      continue;
    }

    // A thread the seed never saw is new since then, unless it is older than the seed's
    // newest: one that was archived, or past the listing's end, and is back in view.
    const previous =
      memory.remembered.get(thread.threadId) ??
      (memory.seededThrough === null || thread.createdAt > memory.seededThrough
        ? NOTHING_ANNOUNCED
        : undefined);
    const observation = observePeerThreadAlert(thread);
    const decision = decideThreadAlert(previous, observation);
    if (decision.notify === "completed" && observation !== null) {
      // A finished run can pick up again at once, so it is announced only if it still
      // stands a little later.
      const held = memory.heldCompletions.get(thread.threadId);
      if (held?.identity !== observation.identity) {
        const dueAt = nowMillis + completionConfirmMillis;
        memory.heldCompletions.set(thread.threadId, { identity: observation.identity, dueAt });
        recheckBy(dueAt);
        continue;
      }
      if (nowMillis < held.dueAt) {
        recheckBy(held.dueAt);
        continue;
      }
    }
    memory.heldCompletions.delete(thread.threadId);
    if (decision.remember !== undefined) {
      setBounded(memory.remembered, thread.threadId, decision.remember);
    }
    if (decision.notify === null) continue;
    // Work delegated from another environment reports its end to the thread that asked for
    // it, which announces its own; only its questions need the user here.
    const ended = decision.notify === "completed" || decision.notify === "failed";
    if (ended && thread.delegatedFrom != null) continue;
    alerts.push({ threadId: thread.threadId, threadTitle: thread.title, kind: decision.notify });
  }
  return { alerts, recheckAt };
}
