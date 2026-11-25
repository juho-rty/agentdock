/**
 * Sends a Web Push to every subscribed browser when a thread needs approval or input,
 * finishes or fails. Orchestration never waits on it: events are queued and each
 * delivery runs in its own fiber with its failures logged.
 */
import {
  isListedThreadLineage,
  OrchestratorMcpThreadListResult,
  type EnvironmentId,
  type OrchestratorMcpThreadListItem,
  type ThreadId,
} from "@t3tools/contracts";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { AgentAwarenessThread } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as WebPushSubscriptions from "../persistence/WebPushSubscriptions.ts";
import {
  eventThreadId,
  makeAgentAwarenessPublishWorker,
  shouldPublishAgentAwarenessEvent,
  snoozedCompletion,
  waitingApprovalId,
} from "../relay/AgentAwarenessRelay.ts";
import { forkParked } from "../serverActivation.ts";
import { getOrCreateVapidKeyPair } from "./vapidKeys.ts";
import {
  buildWebPushRequest,
  isWebPushInputError,
  WebPushInputError,
  type VapidKeyPair,
} from "./webPush.ts";
import {
  decideThreadAlert,
  encodeWebPushMessage,
  NOTHING_ANNOUNCED,
  observeThreadAlert,
  webPushMessage,
  type WebPushAlertKind,
  type WebPushMessage,
} from "./webPushAlerts.ts";
import {
  makePeerAlertMemory,
  peerLastAssistantMessage,
  stepPeerAlerts,
  type PeerAlertMemory,
} from "./peerWebPushAlerts.ts";

/**
 * A finished run can pick up again at once: a queued follow-up, or a background task
 * waking it. The completion is announced only if it still stands after this long, as
 * AgentAwarenessRelay does for its own alerts.
 */
const COMPLETION_CONFIRM_MS = 5_000;
/** An offline phone still gets the news within a day; older news is not worth a buzz. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_TIMEOUT = "15 seconds";
/**
 * How often linked environments are asked for their threads. They push nothing here, so a
 * peer's alert reaches the phone up to this much later than a local one.
 */
const PEER_POLL_INTERVAL_MS = 25_000;
/** The listing is newest-updated first, so one page holds whatever changed since the last. */
const PEER_LIST_LIMIT = 100;
/** The first listing reads further back, so older threads coming back into view stay quiet. */
const PEER_SEED_MAX_PAGES = 10;
// The narrowest modes: listing only reads.
const PEER_CALL_LIMITS: PeerMcpClient.PeerCallLimits = {
  runtimeMode: "approval-required",
  interactionMode: "default",
};
// Apple wants a contact in every token. Only an identifier: nothing is served at this address,
// and it stays as it is so the subscriptions phones already hold keep working.
const VAPID_SUBJECT = "https://agentdock-phone.juho-agentdock.workers.dev";

/** A topic may hold 32 URL-safe characters; thread ids can be longer or carry others. */
function pushTopic(threadId: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const char of threadId) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

const pushHost = (endpoint: string): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
};

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const subscriptions = yield* WebPushSubscriptions.WebPushSubscriptionsRepository;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    const peerLinks = yield* PeerLinks.PeerLinks;
    const peerMcp = yield* PeerMcpClient.PeerMcpClient;
    const httpClient = yield* HttpClient.HttpClient;
    const sql = yield* SqlClient.SqlClient;
    const scope = yield* Effect.scope;

    /** The last occasion seen per top-level thread; see decideThreadAlert. */
    const remembered = new Map<ThreadId, string>();
    /** The last request announced for each subagent, which asks on its top-level thread. */
    const announcedChildRequests = new Map<ThreadId, string>();
    const heldCompletions = new Map<ThreadId, { identity: string; dueAt: number }>();

    const readThread = (threadId: ThreadId) =>
      threads
        .getAgentAwarenessSnapshot(threadId)
        .pipe(Effect.map((snapshot) => snapshot.threads[0] ?? null));

    const findTopLevelThread = Effect.fnUntraced(function* (child: AgentAwarenessThread) {
      const seen = new Set<ThreadId>([child.id]);
      let current: AgentAwarenessThread | null = child;
      while (current !== null && !isListedThreadLineage(current.lineage)) {
        const parentId: ThreadId | null = current.lineage.parentThreadId;
        if (parentId === null || seen.has(parentId)) return null;
        seen.add(parentId);
        current = yield* readThread(parentId);
      }
      return current;
    });

    const sendOne = Effect.fnUntraced(function* (input: {
      readonly subscription: WebPushSubscriptions.WebPushSubscriptionRow;
      readonly message: WebPushMessage;
      readonly vapid: VapidKeyPair;
      readonly topic: string;
    }) {
      const nowMillis = yield* Clock.currentTimeMillis;
      const request = yield* Effect.try({
        try: () =>
          buildWebPushRequest({
            subscription: input.subscription,
            payload: encodeWebPushMessage(input.message),
            vapid: input.vapid,
            subject: VAPID_SUBJECT,
            nowSeconds: nowMillis / 1000,
            ttlSeconds: PUSH_TTL_SECONDS,
            topic: input.topic,
          }),
        catch: (cause) =>
          isWebPushInputError(cause) ? cause : new WebPushInputError({ message: String(cause) }),
      });
      const response = yield* HttpClientRequest.post(request.url).pipe(
        HttpClientRequest.setHeaders(request.headers),
        HttpClientRequest.bodyUint8Array(request.body, "application/octet-stream"),
        httpClient.execute,
        Effect.timeout(PUSH_TIMEOUT),
      );
      const host = pushHost(input.subscription.endpoint);
      if (response.status === 404 || response.status === 410) {
        // The browser unsubscribed or the app was removed; the endpoint will never work again.
        yield* subscriptions.remove(input.subscription.endpoint);
        yield* Effect.logInfo("web push subscription expired; removed", { host });
      } else if (response.status < 200 || response.status >= 300) {
        const detail = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        yield* Effect.logWarning("web push rejected", {
          host,
          status: response.status,
          detail: detail.slice(0, 200),
        });
      }
    });

    const deliver = Effect.fn("WebPushNotifier.deliver")(function* (
      threadId: ThreadId,
      message: WebPushMessage,
    ) {
      const now = yield* DateTime.now;
      const rows = yield* subscriptions.listDeliverable(DateTime.formatIso(now));
      if (rows.length === 0) return;
      const vapid = yield* getOrCreateVapidKeyPair(secrets);
      const topic = pushTopic(threadId);
      yield* Effect.forEach(
        rows,
        (subscription) =>
          sendOne({ subscription, message, vapid, topic }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : Effect.logWarning("web push delivery failed", {
                    host: pushHost(subscription.endpoint),
                    cause: Cause.pretty(cause),
                  }),
            ),
          ),
        { concurrency: 4, discard: true },
      );
    });

    /** The agent's latest reply on the thread; thinking is not a reply. */
    const readLastMessage = (threadId: ThreadId) =>
      sql<{ readonly text: string | null }>`
        SELECT json_extract(payload_json, '$.text') AS text
        FROM orchestration_v2_projection_messages
        WHERE thread_id = ${threadId}
          AND role = 'assistant'
          AND message_id NOT LIKE '%thinking%'
        ORDER BY created_at DESC
        LIMIT 1
      `.pipe(
        Effect.map((rows) => rows[0]?.text ?? null),
        Effect.orElseSucceed(() => null),
      );

    /** Starts a delivery and returns at once, so a slow push service holds nothing up. */
    const announce = (
      environmentId: EnvironmentId,
      thread: AgentAwarenessThread,
      kind: WebPushAlertKind,
    ) =>
      readLastMessage(thread.id).pipe(
        Effect.flatMap((lastMessage) =>
          deliver(
            thread.id,
            webPushMessage({
              kind,
              environmentId,
              threadId: thread.id,
              threadTitle: thread.title,
              lastMessage,
            }),
          ),
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("web push announcement failed", {
                threadId: thread.id,
                cause: Cause.pretty(cause),
              }),
        ),
        Effect.forkIn(scope),
        Effect.asVoid,
      );

    const observe = (environmentId: EnvironmentId, thread: AgentAwarenessThread) => {
      // The phone hears about every finished turn, even one that left a build or a delegate
      // to report back later: the reply is there to read now. Each wake that follows is a
      // new run and sends its own, which replaces this one on the phone. Only a monitor's
      // per-line wakes stay held, or a log would buzz the phone on every line.
      const turnView: AgentAwarenessThread = {
        ...thread,
        pendingBackgroundTasks: (thread.pendingBackgroundTasks ?? [])
          .filter((task) => task.kind === "monitor")
          .map(({ awaited: _awaited, ...task }) => task),
      };
      // Only the phase is used, so the project's name does not matter.
      const state = projectThreadAwarenessV2({
        environmentId,
        project: { title: "" },
        thread: turnView,
      });
      return observeThreadAlert({
        thread,
        phase: state?.phase ?? null,
        snoozed: snoozedCompletion(thread, state),
      });
    };

    let enqueue: (threadId: ThreadId) => Effect.Effect<void> = () => Effect.void;

    /** A subagent's question is announced on the thread the user actually sees. */
    const processSubagent = Effect.fnUntraced(function* (
      environmentId: EnvironmentId,
      child: AgentAwarenessThread,
    ) {
      const requestId = waitingApprovalId(child);
      if (requestId === undefined || announcedChildRequests.get(child.id) === requestId) return;
      announcedChildRequests.set(child.id, requestId);
      const topLevel = yield* findTopLevelThread(child);
      if (topLevel === null || topLevel.archivedAt !== null) return;
      yield* announce(
        environmentId,
        topLevel,
        child.pendingRuntimeRequest?.kind === "user_input" ? "input" : "approval",
      );
    });

    const processThread = Effect.fnUntraced(function* (threadId: ThreadId) {
      const thread = yield* readThread(threadId);
      if (thread === null) {
        remembered.delete(threadId);
        announcedChildRequests.delete(threadId);
        heldCompletions.delete(threadId);
        return;
      }
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      if (!isListedThreadLineage(thread.lineage)) {
        yield* processSubagent(environmentId, thread);
        return;
      }
      const observation = observe(environmentId, thread);
      const decision = decideThreadAlert(remembered.get(threadId), observation);
      if (decision.notify === "completed" && observation !== null) {
        const held = heldCompletions.get(threadId);
        const now = yield* Clock.currentTimeMillis;
        if (held?.identity !== observation.identity) {
          heldCompletions.set(threadId, {
            identity: observation.identity,
            dueAt: now + COMPLETION_CONFIRM_MS,
          });
          yield* Effect.sleep(COMPLETION_CONFIRM_MS).pipe(
            Effect.andThen(Effect.suspend(() => enqueue(threadId))),
            Effect.forkIn(scope),
          );
          return;
        }
        // An unrelated event inside the hold; the timer will come back for it.
        if (now < held.dueAt) return;
      }
      heldCompletions.delete(threadId);
      if (decision.remember !== undefined) remembered.set(threadId, decision.remember);
      if (decision.notify !== null) yield* announce(environmentId, thread, decision.notify);
    });

    const worker = yield* makeAgentAwarenessPublishWorker((threadId: ThreadId) =>
      processThread(threadId).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.logWarning("web push thread check failed", {
                threadId,
                cause: Cause.pretty(cause),
              }),
        ),
      ),
    );
    enqueue = worker.enqueue;

    // Whatever is already waiting or finished when the server starts was announced by the
    // run that saw it happen.
    const seed = Effect.gen(function* () {
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const snapshot = yield* threads.getAgentAwarenessSnapshot();
      for (const thread of snapshot.threads) {
        if (!isListedThreadLineage(thread.lineage)) {
          const requestId = waitingApprovalId(thread);
          if (requestId !== undefined) announcedChildRequests.set(thread.id, requestId);
          continue;
        }
        remembered.set(thread.id, observe(environmentId, thread)?.identity ?? NOTHING_ANNOUNCED);
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("web push could not read the starting threads", {
          cause: Cause.pretty(cause),
        }),
      ),
    );

    /** Per linked environment; forgotten while nothing would receive its alerts. */
    const peerMemories = new Map<EnvironmentId, PeerAlertMemory>();
    /** Links whose last check failed, so an offline or sleeping peer logs once, not every poll. */
    const failingPeers = new Set<EnvironmentId>();

    const notePeerFailure = (environmentId: EnvironmentId, reason: string) =>
      failingPeers.has(environmentId)
        ? Effect.logDebug("web push could not check a linked environment", {
            environmentId,
            reason,
          })
        : Effect.sync(() => failingPeers.add(environmentId)).pipe(
            Effect.andThen(
              Effect.logInfo("web push stopped hearing from a linked environment", {
                environmentId,
                reason,
              }),
            ),
          );

    const listPeerPage = (
      environmentId: EnvironmentId,
      options: {
        readonly cursor: number;
        readonly includeSubagents: boolean;
        readonly statuses?: ReadonlyArray<"running" | "waiting">;
      },
    ) =>
      peerMcp.call({
        environmentId,
        tool: "t3_thread_list",
        arguments: {
          allProjects: true,
          includeSubagents: options.includeSubagents,
          limit: PEER_LIST_LIMIT,
          ...(options.statuses === undefined ? {} : { statuses: options.statuses }),
          ...(options.cursor === 0 ? {} : { cursor: options.cursor }),
        },
        limits: PEER_CALL_LIMITS,
        success: OrchestratorMcpThreadListResult,
      });

    const listPeerThreads = Effect.fnUntraced(function* (
      environmentId: EnvironmentId,
      pages: number,
    ) {
      const merged = new Map<string, OrchestratorMcpThreadListItem>();
      // Top-level threads stay separate from subagent bursts so heavy delegation never pushes
      // finished parent threads off the first page.
      let cursor: number | null = 0;
      for (let page = 0; page < pages && cursor !== null; page++) {
        const result: OrchestratorMcpThreadListResult = yield* listPeerPage(environmentId, {
          cursor,
          includeSubagents: false,
        });
        for (const thread of result.threads) merged.set(thread.threadId, thread);
        cursor = result.nextCursor;
      }
      // A subagent with a question open is still `running`; `waiting` is a turn held by
      // background work. Both are live, so the page stays as small as the work in flight.
      const live: OrchestratorMcpThreadListResult = yield* listPeerPage(environmentId, {
        cursor: 0,
        includeSubagents: true,
        statuses: ["running", "waiting"],
      });
      for (const thread of live.threads) merged.set(thread.threadId, thread);
      return [...merged.values()];
    });

    const readPeerLastMessage = (environmentId: EnvironmentId, threadId: string) =>
      peerMcp
        .call({
          environmentId,
          tool: "t3_thread_read",
          arguments: {
            threadId,
            view: "messages",
            limit: 5,
            runLimit: 1,
            maxCharsPerItem: 500,
          },
          limits: PEER_CALL_LIMITS,
          success: Schema.Unknown,
        })
        .pipe(
          Effect.map(peerLastAssistantMessage),
          Effect.orElseSucceed(() => null),
        );

    /** One peer's listing; returns when a held completion wants another look. */
    const checkPeer = Effect.fnUntraced(function* (environmentId: EnvironmentId) {
      const memory = peerMemories.get(environmentId) ?? makePeerAlertMemory();
      const threads = yield* listPeerThreads(
        environmentId,
        memory.seeded ? 1 : PEER_SEED_MAX_PAGES,
      );
      if (failingPeers.delete(environmentId)) {
        yield* Effect.logInfo("web push hears from a linked environment again", { environmentId });
      }
      const now = yield* Clock.currentTimeMillis;
      const { alerts, recheckAt } = stepPeerAlerts(memory, threads, now, COMPLETION_CONFIRM_MS);
      peerMemories.set(environmentId, memory);
      for (const alert of alerts) {
        const threadId = alert.threadId as ThreadId;
        // The push names the peer and its thread, so the phone opens it there.
        yield* (
          alert.kind === "completed"
            ? readPeerLastMessage(environmentId, alert.threadId)
            : Effect.succeed<string | null>(null)
        ).pipe(
          Effect.flatMap((lastMessage) =>
            deliver(
              threadId,
              webPushMessage({
                kind: alert.kind,
                environmentId,
                threadId,
                threadTitle: alert.threadTitle,
                lastMessage,
              }),
            ),
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.void
              : Effect.logWarning("web push announcement failed", {
                  environmentId,
                  threadId,
                  cause: Cause.pretty(cause),
                }),
          ),
          Effect.forkIn(scope),
        );
      }
      return recheckAt;
    });

    /** Checks every reachable link; returns the earliest held completion's due time. */
    const checkPeers = Effect.gen(function* () {
      const forget = Effect.sync(() => {
        peerMemories.clear();
        failingPeers.clear();
      });
      if (!(yield* peerLinks.enabled)) return yield* forget.pipe(Effect.as(null));
      // Nobody would hear it; the next subscriber starts from a fresh look instead of old news.
      const now = yield* DateTime.now;
      const rows = yield* subscriptions.listDeliverable(DateTime.formatIso(now));
      if (rows.length === 0) return yield* forget.pipe(Effect.as(null));
      const links = yield* peerLinks.list;
      const linked = new Set(links.map((link) => link.environmentId));
      for (const environmentId of peerMemories.keys()) {
        if (!linked.has(environmentId)) peerMemories.delete(environmentId);
      }
      const due = yield* Effect.forEach(
        links,
        (link) => {
          if (link.status !== "reachable") {
            return notePeerFailure(link.environmentId, link.status).pipe(Effect.as(null));
          }
          return checkPeer(link.environmentId).pipe(
            Effect.catch((error) =>
              notePeerFailure(link.environmentId, error.message).pipe(Effect.as(null)),
            ),
          );
        },
        { concurrency: "unbounded" },
      );
      return due.reduce<number | null>(
        (earliest, at) =>
          at === null ? earliest : earliest === null ? at : Math.min(earliest, at),
        null,
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logInfo("web push could not check linked environments", {
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(null)),
      ),
    );

    // A held completion is looked at again when due, not a whole interval later.
    const watchPeers = Effect.forever(
      Effect.gen(function* () {
        const recheckAt = yield* checkPeers;
        const now = yield* Clock.currentTimeMillis;
        const wait =
          recheckAt === null
            ? PEER_POLL_INTERVAL_MS
            : Math.min(PEER_POLL_INTERVAL_MS, Math.max(1_000, recheckAt - now));
        yield* Effect.sleep(wait);
      }),
    );

    yield* forkParked(watchPeers);

    yield* forkParked(
      seed.pipe(
        Effect.andThen(
          Stream.runForEach(threads.streamDomainEvents, (event) =>
            shouldPublishAgentAwarenessEvent(event)
              ? worker.enqueue(eventThreadId(event))
              : Effect.void,
          ),
        ),
      ),
    );
  }),
).pipe(
  Layer.provide(
    FetchHttpClient.layer.pipe(
      // A push service never redirects; following one could reach a host that was not checked.
      Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { redirect: "manual" })),
    ),
  ),
);
