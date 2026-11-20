/**
 * Which thread changes send a phone push. Pure, so the rules can be tested without the
 * orchestration runtime; WebPushNotifier feeds it thread snapshots.
 */
import type { AgentAwarenessPhase } from "@t3tools/shared/agentAwareness";

export type WebPushAlertKind = "approval" | "input" | "completed" | "failed";

/** What a thread currently has to say, and the identity that tells one occasion from the next. */
export interface WebPushAlertObservation {
  readonly kind: WebPushAlertKind;
  /** Changes with each new request or run, so the same occasion alerts once. */
  readonly identity: string;
  /** Remembered but never announced: archived, snoozed, settled or stopped by the user. */
  readonly silent: boolean;
}

export interface WebPushAlertThread {
  readonly archivedAt: unknown;
  readonly latestRunId: string | null | undefined;
  readonly pendingRuntimeRequest: { readonly id: string; readonly kind: string } | null;
  readonly activityRunStatus?: string | null | undefined;
  readonly status: string;
}

const kindForPhase = (phase: AgentAwarenessPhase | null): WebPushAlertKind | null => {
  switch (phase) {
    case "waiting_for_approval":
      return "approval";
    case "waiting_for_input":
      return "input";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return null;
  }
};

/**
 * Reads one listed (top-level) thread. `phase` is its awareness phase, null when the
 * projection hides the thread, and `snoozed` says a completion landed inside a snooze.
 * Returns null while the thread is working or idle.
 */
export function observeThreadAlert(input: {
  readonly thread: WebPushAlertThread;
  readonly phase: AgentAwarenessPhase | null;
  readonly snoozed: boolean;
}): WebPushAlertObservation | null {
  const { thread } = input;
  const archived = thread.archivedAt != null;
  const kind = kindForPhase(input.phase);
  if (kind === "approval" || kind === "input") {
    // The phase can come from the thread's own request only; a child's is tracked apart.
    const requestId = thread.pendingRuntimeRequest?.id;
    if (requestId === undefined) return null;
    return { kind, identity: `request:${requestId}`, silent: archived };
  }
  if (kind !== null) {
    if (thread.latestRunId == null) return null;
    return {
      kind,
      identity: `${kind}:${thread.latestRunId}`,
      silent: archived || input.snoozed,
    };
  }
  // The projection hides stopped and settled runs. Remember them so that unsettling or
  // unarchiving later does not announce a run that ended long ago.
  const runStatus = thread.activityRunStatus ?? thread.status;
  if ((runStatus === "completed" || runStatus === "failed") && thread.latestRunId != null) {
    return { kind: runStatus, identity: `${runStatus}:${thread.latestRunId}`, silent: true };
  }
  return null;
}

export interface WebPushAlertDecision {
  /** The identity to remember for the thread; undefined leaves the memory as it is. */
  readonly remember: string | undefined;
  readonly notify: WebPushAlertKind | null;
}

/** Remembered for a thread that was seen with nothing to announce. */
export const NOTHING_ANNOUNCED = "";

/**
 * `previous` is the identity last remembered for the thread, undefined when this server
 * run has never seen it. A thread first seen already finished stays quiet, since it ended
 * before anyone was watching; one first seen waiting still needs its answer.
 */
export function decideThreadAlert(
  previous: string | undefined,
  observation: WebPushAlertObservation | null,
): WebPushAlertDecision {
  if (observation === null) {
    return { remember: previous === undefined ? NOTHING_ANNOUNCED : undefined, notify: null };
  }
  if (observation.identity === previous) return { remember: undefined, notify: null };
  const firstSighting = previous === undefined;
  const ended = observation.kind === "completed" || observation.kind === "failed";
  if (observation.silent || (firstSighting && ended)) {
    return { remember: observation.identity, notify: null };
  }
  return { remember: observation.identity, notify: observation.kind };
}

export interface WebPushMessage {
  readonly title: string;
  readonly body: string;
  /** A path on the web app's origin that opens the thread. */
  readonly url: string;
  /** Replaces an earlier notification for the same thread. */
  readonly tag: string;
}

const KIND_LABELS: Record<WebPushAlertKind, string> = {
  approval: "Approval needed",
  input: "Input needed",
  completed: "Completed",
  failed: "Failed",
};

const TITLE_MAX_LENGTH = 80;
const BODY_MAX_LENGTH = 180;

const shorten = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** The agent's last message as one plain line: no Markdown marks, links or code fences. */
function webPushExcerpt(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The thread's name is the title. The body says why, followed by the start of the agent's
 * last message, so the notification can be read without opening the app.
 */
export function webPushMessage(input: {
  readonly kind: WebPushAlertKind;
  readonly environmentId: string;
  readonly threadId: string;
  readonly threadTitle: string;
  /** The agent's last message, if there is one. */
  readonly lastMessage?: string | null | undefined;
}): WebPushMessage {
  const label = KIND_LABELS[input.kind];
  const threadTitle = input.threadTitle.trim().replace(/\s+/g, " ");
  const excerpt = webPushExcerpt(input.lastMessage ?? "");
  return {
    title: threadTitle === "" ? "AgentDock" : shorten(threadTitle, TITLE_MAX_LENGTH),
    body: shorten(excerpt === "" ? label : `${label} · ${excerpt}`, BODY_MAX_LENGTH),
    url: `/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`,
    tag: `thread:${input.threadId}`,
  };
}

/** The push body, as the service worker parses it. */
export const encodeWebPushMessage = (message: WebPushMessage): string => JSON.stringify(message);
