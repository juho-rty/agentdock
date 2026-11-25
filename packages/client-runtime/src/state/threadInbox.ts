// @effect-diagnostics globalTimers:off - Shelf placement timers run in web and native clients, outside an Effect runtime.
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import { toSortableTimestamp } from "./threadSort.ts";
import { effectiveSnoozed, hasUnseenRunFailure } from "./threadSettled.ts";

type WorkingThreadInput = Pick<
  EnvironmentThreadShell,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "interactionMode"
  | "latestRun"
  | "runtime"
>;

export function isThreadWorking(thread: WorkingThreadInput): boolean {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return false;
  if (thread.pendingSubagentRequest != null) return false;
  if (!threadRuntimeIsActive(thread.runtime) && thread.runtime?.status !== "idle") return false;
  const run = thread.latestRun;
  const runSettled =
    run !== null &&
    run.status !== "preparing" &&
    run.status !== "queued" &&
    run.status !== "starting" &&
    run.status !== "running" &&
    run.status !== "waiting" &&
    thread.runtime?.activeRunId !== run.runId;
  return !(thread.interactionMode === "plan" && thread.hasActionableProposedPlan && runSettled);
}

/**
 * A thread its own client is launching reads as preparing until its first run lands.
 * The server commits the thread before its run, so the list would otherwise place it twice.
 */
export function asLaunchingThread<T extends EnvironmentThreadShell>(thread: T): T {
  if (thread.latestRun !== null || thread.runtime !== null) return thread;
  return {
    ...thread,
    runtime: {
      status: "preparing",
      activeRunId: null,
      providerInstanceId: thread.providerInstanceId,
      providerName: null,
      lastError: null,
      updatedAt: thread.updatedAt,
    },
  };
}

type InboxThreadInput = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "createdAt" | "unsettledAt" | "latestRun"
>;

export function sortInboxThreadsByReturn<T extends InboxThreadInput>(
  threads: readonly T[],
  observedReturnAt?: (thread: T) => number | undefined,
): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        toSortableTimestamp(thread.createdAt) ?? 0,
        toSortableTimestamp(thread.unsettledAt ?? undefined) ?? 0,
        toSortableTimestamp(thread.latestRun?.requestedAt ?? undefined) ?? 0,
        toSortableTimestamp(thread.latestRun?.completedAt ?? undefined) ?? 0,
        observedReturnAt?.(thread) ?? 0,
      ),
    ]),
  );
  return sortNewestFirst(threads, timestamps);
}

type WorkingSortInput = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "createdAt" | "latestRun" | "latestUserAuthoredMessageAt"
>;

export function sortWorkingThreadsBySend<T extends WorkingSortInput>(threads: readonly T[]): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        toSortableTimestamp(thread.createdAt) ?? 0,
        toSortableTimestamp(
          (thread.latestUserAuthoredMessageAt === undefined
            ? thread.latestRun?.requestedAt
            : thread.latestUserAuthoredMessageAt) ?? undefined,
        ) ?? 0,
      ),
    ]),
  );
  return sortNewestFirst(threads, timestamps);
}

export type ThreadAttentionPriorityInput = Pick<
  EnvironmentThreadShell,
  | "id"
  | "environmentId"
  | "createdAt"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestRun"
  | "runtime"
> & {
  readonly pendingSubagentRequest?: EnvironmentThreadShell["pendingSubagentRequest"];
  readonly pendingGuestMessageCount?: number | undefined;
  readonly lastVisitedAt?: string | null | undefined;
  readonly unsettledAt?: string | null | undefined;
  readonly latestUserAuthoredMessageAt?: string | null | undefined;
  readonly pendingBackgroundTasks?: EnvironmentThreadShell["pendingBackgroundTasks"] | undefined;
};

function hasUnreadDoneRun(thread: ThreadAttentionPriorityInput): boolean {
  const completedAt = thread.latestRun?.completedAt;
  if (!completedAt) return false;
  const status = thread.latestRun?.status;
  if (status === "interrupted" || status === "cancelled" || status === "failed") return false;
  const completedAtMs = toSortableTimestamp(completedAt);
  if (completedAtMs === null) return false;
  if (!thread.lastVisitedAt) return false;
  const lastVisitedAtMs = toSortableTimestamp(thread.lastVisitedAt);
  if (lastVisitedAtMs === null) return true;
  return completedAtMs > lastVisitedAtMs;
}

/** Ranks attention (`3`), working (`2`), and unread done (`1`) threads above idle/read (`0`). */
export function resolveThreadAttentionPriority(
  thread: ThreadAttentionPriorityInput,
): 0 | 1 | 2 | 3 {
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.pendingSubagentRequest != null ||
    (thread.pendingGuestMessageCount ?? 0) > 0
  ) {
    return 3;
  }
  if (
    hasUnseenRunFailure(thread) ||
    (thread.runtime?.status === "failed" && thread.latestRun === null)
  ) {
    return 3;
  }
  const run = thread.latestRun;
  const runSettled =
    run !== null &&
    run.status !== "preparing" &&
    run.status !== "queued" &&
    run.status !== "starting" &&
    run.status !== "running" &&
    run.status !== "waiting" &&
    thread.runtime?.activeRunId !== run.runId;
  if (thread.interactionMode === "plan" && thread.hasActionableProposedPlan && runSettled) {
    return 3;
  }
  if (
    thread.runtime !== null &&
    ["preparing", "queued", "starting", "running", "waiting"].includes(thread.runtime.status)
  ) {
    return 2;
  }
  // Waiting on background work (a build, a delegate) is still in progress, not done.
  if (backgroundWorkHoldsCompletion(thread.pendingBackgroundTasks ?? [])) {
    return 2;
  }
  if (hasUnreadDoneRun(thread)) {
    return 1;
  }
  return 0;
}

function attentionSortTimestampMs(thread: ThreadAttentionPriorityInput): number {
  return Math.max(
    toSortableTimestamp(thread.createdAt) ?? 0,
    toSortableTimestamp(thread.unsettledAt ?? undefined) ?? 0,
    toSortableTimestamp(thread.latestUserAuthoredMessageAt ?? undefined) ?? 0,
    toSortableTimestamp(thread.latestRun?.requestedAt ?? undefined) ?? 0,
    toSortableTimestamp(thread.latestRun?.startedAt ?? undefined) ?? 0,
    toSortableTimestamp(thread.latestRun?.completedAt ?? undefined) ?? 0,
  );
}

/** Places priority threads at the top; `stickyPriorityKey` holds a just-opened unread row until navigation. */
export function prioritizeAttentionThreads<T extends ThreadAttentionPriorityInput>(
  threads: readonly T[],
  options?: {
    readonly resolvePriority?: (thread: T) => 0 | 1 | 2 | 3;
    readonly stickyPriorityKey?: string | null;
  },
): T[] {
  if (threads.length < 2) return [...threads];
  const resolvePriority = options?.resolvePriority ?? resolveThreadAttentionPriority;
  const stickyKey = options?.stickyPriorityKey ?? null;
  const prioritized: Array<{
    readonly thread: T;
    readonly priority: 1 | 2 | 3;
    readonly at: number;
  }> = [];
  const rest: T[] = [];
  for (const thread of threads) {
    const rawPriority = resolvePriority(thread);
    const priority =
      rawPriority > 0
        ? rawPriority
        : stickyKey !== null && `${thread.environmentId}:${thread.id}` === stickyKey
          ? 1
          : 0;
    if (priority !== 0) {
      prioritized.push({ thread, priority, at: attentionSortTimestampMs(thread) });
    } else {
      rest.push(thread);
    }
  }
  if (prioritized.length === 0) return [...threads];
  prioritized.sort(
    (left, right) =>
      right.priority - left.priority ||
      right.at - left.at ||
      left.thread.id.localeCompare(right.thread.id) ||
      left.thread.environmentId.localeCompare(right.thread.environmentId),
  );
  return [...prioritized.map((entry) => entry.thread), ...rest];
}

function sortNewestFirst<T extends Pick<EnvironmentThreadShell, "id" | "environmentId">>(
  threads: readonly T[],
  timestamps: ReadonlyMap<T, number>,
): T[] {
  return [...threads].sort(
    (left, right) =>
      timestamps.get(right)! - timestamps.get(left)! ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId),
  );
}

type TrackedInboxThread = WorkingThreadInput &
  InboxThreadInput &
  Partial<
    Pick<
      EnvironmentThreadShell,
      | "archivedAt"
      | "deletedAt"
      | "pinnedAt"
      | "settledOverride"
      | "settledAt"
      | "snoozedAt"
      | "snoozedUntil"
      | "activeOrderKey"
      | "pendingGuestMessageCount"
    >
  >;

type ThreadKeyInput = Pick<EnvironmentThreadShell, "environmentId" | "id">;

/**
 * How long a thread that stopped working keeps reading as working. An orchestrator
 * run can end moments before its continuation starts, so clients wait this long
 * before treating the thread as done.
 */
const WORKING_EXIT_GRACE_MS = 2_000;

/**
 * A run that ended this long ago has no continuation about to start, so its thread gets no
 * grace. A client sees this for work that ended while it was closed or disconnected; the
 * margin is wide so a client clock that runs ahead of the server does not cancel the grace.
 */
const STALE_EXIT_MS = 60_000;

/**
 * Keep one at module scope so placement survives routes that unmount the list. Call
 * `observe` when the shells or the snapshot version change, or with null while the beta
 * is off. Its result stays fixed, so a list built from it can be cached.
 */
export function createInboxReturnTracker() {
  const keyOf = (thread: ThreadKeyInput) => `${thread.environmentId}:${thread.id}`;
  const states = new Map<
    string,
    { working: boolean; deadline: number | null; placement: string | null }
  >();
  const returns = new Map<string, number>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let version = 0;
  const now = () => {
    // @effect-diagnostics-next-line globalDate:off - The grace deadline is wall-clock time shared by web and native clients.
    return Date.now();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    let next = Infinity;
    for (const state of states.values()) {
      if (state.deadline !== null) next = Math.min(next, state.deadline);
    }
    if (next === Infinity) return;
    timer = setTimeout(
      () => {
        const at = now();
        for (const [key, state] of states) {
          if (state.deadline !== null && state.deadline <= at) {
            state.working = false;
            state.deadline = null;
            returns.set(key, at);
          }
        }
        schedule();
        version++;
        for (const listener of listeners) listener();
      },
      Math.max(0, next - now()),
    );
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => version,
    observe(threads: readonly TrackedInboxThread[] | null): {
      readonly isWorking: (thread: WorkingThreadInput & ThreadKeyInput) => boolean;
      readonly returnedAt: (thread: ThreadKeyInput) => number | undefined;
    } {
      if (threads === null) {
        clearTimeout(timer);
        timer = undefined;
        states.clear();
        returns.clear();
        return { isWorking: isThreadWorking, returnedAt: () => undefined };
      }
      const present = new Set<string>();
      const at = now();
      // @effect-diagnostics-next-line globalDate:off - Snooze checks compare wall-clock ISO times.
      const observedAt = new Date(at).toISOString();
      for (const thread of threads) {
        const key = keyOf(thread);
        present.add(key);
        const previous = states.get(key);
        const actual = isThreadWorking(thread);
        const placement =
          actual || previous?.working
            ? JSON.stringify([
                thread.archivedAt,
                thread.deletedAt,
                thread.pinnedAt,
                thread.settledOverride,
                thread.settledAt,
                thread.snoozedAt,
                thread.snoozedUntil,
                thread.activeOrderKey,
              ])
            : null;
        const actionable =
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput ||
          thread.pendingSubagentRequest != null ||
          (thread.pendingGuestMessageCount ?? 0) > 0 ||
          (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) ||
          thread.runtime?.lastError != null ||
          thread.latestRun?.status === "failed";
        const moved = previous !== undefined && previous.placement !== placement;
        const excluded =
          thread.archivedAt != null ||
          thread.deletedAt != null ||
          thread.pinnedAt != null ||
          thread.settledOverride === "settled" ||
          effectiveSnoozed(thread, { now: observedAt });
        // Only shelf placement is held: execution state and attention requests stay authoritative.
        const endedAt = toSortableTimestamp(thread.latestRun?.completedAt ?? undefined);
        const endedLongAgo = endedAt !== null && endedAt <= at - STALE_EXIT_MS;
        const deadline =
          !actual && previous?.working && !actionable && !moved && !excluded && !endedLongAgo
            ? (previous.deadline ?? at + WORKING_EXIT_GRACE_MS)
            : null;
        const working = actual || (deadline !== null && deadline > at);
        if (previous?.working && !working) returns.set(key, at);
        states.set(key, { working, deadline: working ? deadline : null, placement });
      }
      for (const key of states.keys()) {
        if (!present.has(key)) {
          states.delete(key);
          returns.delete(key);
        }
      }
      schedule();
      const observedWorking = new Map<string, boolean>();
      states.forEach((state, key) => observedWorking.set(key, state.working));
      const observedReturns = new Map(returns);
      return {
        isWorking: (thread) => observedWorking.get(keyOf(thread)) ?? isThreadWorking(thread),
        returnedAt: (thread) => observedReturns.get(keyOf(thread)),
      };
    },
    isWorking: (thread: WorkingThreadInput & ThreadKeyInput) =>
      states.get(keyOf(thread))?.working ?? isThreadWorking(thread),
    returnedAt: (thread: ThreadKeyInput) => returns.get(keyOf(thread)),
  };
}
