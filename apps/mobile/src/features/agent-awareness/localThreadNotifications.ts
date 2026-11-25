import {
  type EnvironmentThreadShell,
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import {
  createThreadNotificationGate,
  isSnoozedForNotification,
  type ThreadNotificationKind,
  type ThreadNotificationObservation,
} from "@t3tools/client-runtime/state/thread-notification-gate";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { monitorHoldsWakeCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as Option from "effect/Option";
import { AsyncResult, type AtomRegistry } from "effect/reactivity";
import * as Notifications from "expo-notifications";
import { msg } from "gt-react-native";
import { Platform } from "react-native";

import { m } from "../../i18n/messages";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentShell } from "../../state/shell";
import { environmentThreadShells } from "../../state/threads";
import { workspaceConnections } from "../../state/workspace";

type AttentionStatus = "approval" | "input" | "request" | "failed" | "limited";

/** What a thread needs from the user, if anything; the phone's version of the sidebar status. */
export function threadAttentionStatus(thread: EnvironmentThreadShell): AttentionStatus | null {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") return "approval";
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") return "input";
  if ((thread.pendingGuestMessageCount ?? 0) > 0) return "request";
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  if (thread.runtime === null && thread.latestRun?.status === "failed") return "failed";
  return null;
}

function isWorking(thread: EnvironmentThreadShell): boolean {
  const status = thread.runtime?.status;
  return (
    status === "preparing" ||
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "waiting" ||
    status === "idle"
  );
}

interface NotificationState extends ThreadNotificationObservation {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly thread: EnvironmentThreadShell;
  readonly status: AttentionStatus | null;
}

/** Pure: the observation the shared gate compares between snapshots. */
export function observeThread(
  thread: EnvironmentThreadShell,
  raw: OrchestrationV2ThreadShell,
): Omit<NotificationState, "raw" | "subagentRequest" | "thread"> {
  const status = threadAttentionStatus(thread);
  const ownRequestId = thread.source.pendingRuntimeRequest?.id ?? null;
  const requestId =
    status === "approval" || status === "input"
      ? thread.hasPendingApprovals || thread.hasPendingUserInput
        ? ownRequestId
        : null
      : null;
  // A request with an id announces once even when queued messages start new runs under it.
  const attention =
    status === null
      ? null
      : requestId !== null
        ? `${status}:${requestId}`
        : `${thread.latestRun?.runId ?? ""}:${status}`;
  const completed =
    status === null && !isWorking(thread) && thread.latestRun?.status === "completed";
  const settled = completed && !monitorHoldsWakeCompletion(raw);
  const parsed = Date.parse(thread.latestRun?.completedAt ?? "");
  return {
    status,
    attention,
    requestId,
    settled,
    completedAt: settled && Number.isFinite(parsed) ? parsed : null,
    backgroundWake: raw.latestRunBackgroundWake === true,
  };
}

function notificationTitle(kind: ThreadNotificationKind, status: AttentionStatus | null): string {
  if (kind === "completion") return m(msg("Thread completed"));
  switch (status) {
    case "approval":
      return m(msg("Approval needed"));
    case "limited":
      return m(msg("Usage limit reached"));
    case "failed":
      return m(msg("Thread failed"));
    case "request":
      return m(msg("Guest request"));
    default:
      return m(msg("Input needed"));
  }
}

function threadDeepLink(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `/threads/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

function notificationsEnabled(registry: AtomRegistry.AtomRegistry): boolean {
  const preferences = registry.get(mobilePreferencesAtom);
  return (
    !AsyncResult.isSuccess(preferences) || preferences.value.threadNotificationsEnabled !== false
  );
}

interface WatchedEnvironment {
  unsubscribe: () => void;
  previous: Map<ThreadId, NotificationState>;
  reconnecting: boolean;
  readonly gate: ReturnType<typeof createThreadNotificationGate<ThreadId>>;
}

/**
 * Posts a local notification when a thread on any connected computer finishes, fails, or asks
 * for an answer or approval. The foreground handler drops the one for the thread on screen.
 * iOS suspends the app shortly after it leaves the screen, so these arrive while it is open or
 * just backgrounded; nothing here reaches a closed app.
 */
export function installLocalThreadNotifications(registry: AtomRegistry.AtomRegistry): () => void {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return () => {};
  const watched = new Map<EnvironmentId, WatchedEnvironment>();

  const present = (
    environmentId: EnvironmentId,
    state: NotificationState,
    kind: ThreadNotificationKind,
  ) => {
    if (!notificationsEnabled(registry)) return;
    const hidden = registry.get(environmentThreadShells.hiddenThreadKeysAtom);
    if (hidden.has(threadKey({ environmentId, threadId: state.thread.id }))) return;
    const deepLink = threadDeepLink(environmentId, state.thread.id);
    void Notifications.scheduleNotificationAsync({
      // One notification per thread: a newer one replaces what is still in the list.
      identifier: `thread:${environmentId}:${state.thread.id}`,
      content: {
        title: notificationTitle(kind, state.status),
        body: state.thread.title,
        sound: "default",
        data: { deepLink, environmentId, threadId: state.thread.id },
        ...(Platform.OS === "android" ? {} : { threadIdentifier: environmentId }),
      },
      trigger: Platform.OS === "android" ? { channelId: "agent-alerts" } : null,
    }).catch(() => undefined);
  };

  const observeThreads = (
    environmentId: EnvironmentId,
    entry: WatchedEnvironment,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) => {
    const subagentRequests = registry.get(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
    );
    const delegatedUnderParent = registry.get(environmentThreadShells.delegatedUnderParentAtom);
    const next = new Map<ThreadId, NotificationState>();
    const changed: Array<[NotificationState | undefined, NotificationState]> = [];
    for (const raw of threads) {
      // A delegated task speaks through its parent.
      if (
        isShownUnderParent({ environmentId, threadId: raw.id }, raw.lineage, delegatedUnderParent)
      ) {
        continue;
      }
      const prior = entry.previous.get(raw.id);
      const subagentRequest = subagentRequests.get(raw.id) ?? null;
      if (!entry.reconnecting && prior?.raw === raw && prior.subagentRequest === subagentRequest) {
        next.set(raw.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, raw, subagentRequest);
      const state: NotificationState = {
        raw,
        subagentRequest,
        thread,
        ...observeThread(thread, raw),
      };
      next.set(raw.id, state);
      changed.push([prior, state]);
    }
    entry.reconnecting = false;
    entry.previous = next;
    entry.gate.retain(new Set(next.keys()));
    const now = Date.now();
    for (const [prior, state] of changed) {
      entry.gate.observe(state.thread.id, prior, state, {
        archived: state.thread.archivedAt !== null,
        quiet: state.raw.latestRunStopRequested === true,
        snoozed: isSnoozedForNotification(state.thread, state.completedAt, now),
      });
    }
  };

  const watchEnvironment = (environmentId: EnvironmentId): WatchedEnvironment => {
    const entry: WatchedEnvironment = {
      previous: new Map(),
      reconnecting: false,
      unsubscribe: () => {},
      gate: createThreadNotificationGate<ThreadId>((threadId, kind) => {
        const state = entry.previous.get(threadId);
        if (state) present(environmentId, state, kind);
      }),
    };
    let threads: ReadonlyArray<OrchestrationV2ThreadShell> | null = null;
    const unsubscribeShell = registry.subscribe(
      environmentShell.stateValueAtom(environmentId),
      (shell) => {
        threads =
          shell.status === "live" && Option.isSome(shell.snapshot)
            ? shell.snapshot.value.threads
            : null;
        if (threads !== null) {
          observeThreads(environmentId, entry, threads);
          return;
        }
        entry.reconnecting = true;
        entry.gate.pause();
      },
      { immediate: true },
    );
    const reobserve = () => {
      if (threads !== null) observeThreads(environmentId, entry, threads);
    };
    const unsubscribeRequests = registry.subscribe(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
      reobserve,
    );
    const unsubscribeDelegated = registry.subscribe(
      environmentThreadShells.delegatedUnderParentAtom,
      reobserve,
    );
    entry.unsubscribe = () => {
      unsubscribeShell();
      unsubscribeRequests();
      unsubscribeDelegated();
      entry.gate.clear();
    };
    return entry;
  };

  const syncEnvironments = () => {
    const ids = new Set(
      registry
        .get(workspaceConnections.environmentsAtom)
        .map((environment) => environment.environmentId),
    );
    for (const [environmentId, entry] of watched) {
      if (ids.has(environmentId)) continue;
      entry.unsubscribe();
      watched.delete(environmentId);
    }
    for (const environmentId of ids) {
      if (!watched.has(environmentId)) watched.set(environmentId, watchEnvironment(environmentId));
    }
  };

  // Ask once on the first start; afterwards Settings > Notifications turns them on or off.
  void Notifications.getPermissionsAsync()
    .then((permission) =>
      permission.granted || !permission.canAskAgain || !notificationsEnabled(registry)
        ? undefined
        : Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          }),
    )
    .catch(() => undefined);

  const unsubscribeEnvironments = registry.subscribe(
    workspaceConnections.environmentsAtom,
    syncEnvironments,
    { immediate: true },
  );

  return () => {
    unsubscribeEnvironments();
    for (const entry of watched.values()) entry.unsubscribe();
    watched.clear();
  };
}
