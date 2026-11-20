/**
 * Sends a Web Push to every subscribed browser when a thread needs approval or input,
 * finishes or fails. Orchestration never waits on it: events are queued and each
 * delivery runs in its own fiber with its failures logged.
 */
import { isListedThreadLineage, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import type { AgentAwarenessThread } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as WebPushSubscriptions from "../persistence/WebPushSubscriptions.ts";
import { DEFAULT_PHONE_RELAY_URL } from "../phone/phoneRelay.ts";
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

/**
 * A finished run can pick up again at once: a queued follow-up, or a background task
 * waking it. The completion is announced only if it still stands after this long, as
 * AgentAwarenessRelay does for its own alerts.
 */
const COMPLETION_CONFIRM_MS = 5_000;
/** An offline phone still gets the news within a day; older news is not worth a buzz. */
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const PUSH_TIMEOUT = "15 seconds";
// Apple wants a contact in every token. The relay page is where this server's phones live.
const VAPID_SUBJECT = DEFAULT_PHONE_RELAY_URL;

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
