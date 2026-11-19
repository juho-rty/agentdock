import { describe, expect, it } from "vite-plus/test";

import {
  decideThreadAlert,
  NOTHING_ANNOUNCED,
  observeThreadAlert,
  webPushMessage,
  type WebPushAlertThread,
} from "./webPushAlerts.ts";

const thread = (overrides: Partial<WebPushAlertThread> = {}): WebPushAlertThread => ({
  archivedAt: null,
  latestRunId: "run-1",
  pendingRuntimeRequest: null,
  activityRunStatus: "running",
  status: "running",
  ...overrides,
});

const approval = (id: string) => ({ id, kind: "command_approval" });

describe("observeThreadAlert", () => {
  it("says nothing while a thread works or sits idle", () => {
    for (const phase of ["starting", "running", "stale", null] as const) {
      expect(observeThreadAlert({ thread: thread(), phase, snoozed: false })).toBeNull();
    }
    expect(
      observeThreadAlert({
        thread: thread({ activityRunStatus: null, status: "idle" }),
        phase: null,
        snoozed: false,
      }),
    ).toBeNull();
  });

  it("keys a wait by its request, so each new request is a new occasion", () => {
    expect(
      observeThreadAlert({
        thread: thread({ pendingRuntimeRequest: approval("req-1") }),
        phase: "waiting_for_approval",
        snoozed: false,
      }),
    ).toEqual({ kind: "approval", identity: "request:req-1", silent: false });
    expect(
      observeThreadAlert({
        thread: thread({ pendingRuntimeRequest: { id: "req-2", kind: "user_input" } }),
        phase: "waiting_for_input",
        snoozed: false,
      }),
    ).toEqual({ kind: "input", identity: "request:req-2", silent: false });
  });

  it("ignores a wait phase that has no request of the thread's own", () => {
    expect(
      observeThreadAlert({ thread: thread(), phase: "waiting_for_approval", snoozed: false }),
    ).toBeNull();
  });

  it("keys a finished or failed run by the run", () => {
    expect(
      observeThreadAlert({
        thread: thread({ activityRunStatus: "completed", status: "completed" }),
        phase: "completed",
        snoozed: false,
      }),
    ).toEqual({ kind: "completed", identity: "completed:run-1", silent: false });
    expect(
      observeThreadAlert({
        thread: thread({ activityRunStatus: "failed", status: "failed" }),
        phase: "failed",
        snoozed: false,
      }),
    ).toEqual({ kind: "failed", identity: "failed:run-1", silent: false });
  });

  it("keeps archived threads and snoozed completions silent", () => {
    expect(
      observeThreadAlert({
        thread: thread({ archivedAt: "2026-11-20T00:00:00Z", status: "completed" }),
        phase: "completed",
        snoozed: false,
      })?.silent,
    ).toBe(true);
    expect(
      observeThreadAlert({
        thread: thread({
          archivedAt: "2026-11-20T00:00:00Z",
          pendingRuntimeRequest: approval("req-1"),
        }),
        phase: "waiting_for_approval",
        snoozed: false,
      })?.silent,
    ).toBe(true);
    expect(
      observeThreadAlert({ thread: thread(), phase: "completed", snoozed: true })?.silent,
    ).toBe(true);
  });

  it("remembers a hidden finished run without announcing it", () => {
    // A stopped or settled run has no phase, but its run status is still terminal.
    expect(
      observeThreadAlert({
        thread: thread({ activityRunStatus: null, status: "completed" }),
        phase: null,
        snoozed: false,
      }),
    ).toEqual({ kind: "completed", identity: "completed:run-1", silent: true });
    expect(
      observeThreadAlert({
        thread: thread({ activityRunStatus: "failed" }),
        phase: null,
        snoozed: false,
      }),
    ).toEqual({ kind: "failed", identity: "failed:run-1", silent: true });
  });
});

describe("decideThreadAlert", () => {
  const completed = { kind: "completed", identity: "completed:run-1", silent: false } as const;
  const failed = { kind: "failed", identity: "failed:run-1", silent: false } as const;
  const waiting = { kind: "approval", identity: "request:req-1", silent: false } as const;
  const input = { kind: "input", identity: "request:req-2", silent: false } as const;

  it("notifies when a watched thread starts waiting, finishes or fails", () => {
    expect(decideThreadAlert(NOTHING_ANNOUNCED, waiting)).toEqual({
      remember: "request:req-1",
      notify: "approval",
    });
    expect(decideThreadAlert(NOTHING_ANNOUNCED, input)).toEqual({
      remember: "request:req-2",
      notify: "input",
    });
    expect(decideThreadAlert("request:req-1", completed)).toEqual({
      remember: "completed:run-1",
      notify: "completed",
    });
    expect(decideThreadAlert(NOTHING_ANNOUNCED, failed)).toEqual({
      remember: "failed:run-1",
      notify: "failed",
    });
  });

  it("notifies once per occasion", () => {
    expect(decideThreadAlert("request:req-1", waiting)).toEqual({
      remember: undefined,
      notify: null,
    });
    expect(decideThreadAlert("completed:run-1", completed)).toEqual({
      remember: undefined,
      notify: null,
    });
  });

  it("keeps the last occasion while the thread works, so the same run cannot alert twice", () => {
    expect(decideThreadAlert("completed:run-1", null)).toEqual({
      remember: undefined,
      notify: null,
    });
  });

  it("notifies again for a second request and for the next run", () => {
    expect(decideThreadAlert("request:req-1", input).notify).toBe("input");
    expect(
      decideThreadAlert("completed:run-1", {
        kind: "completed",
        identity: "completed:run-2",
        silent: false,
      }).notify,
    ).toBe("completed");
  });

  it("stays quiet about a thread first seen already finished, but marks it seen", () => {
    expect(decideThreadAlert(undefined, completed)).toEqual({
      remember: "completed:run-1",
      notify: null,
    });
    expect(decideThreadAlert(undefined, failed)).toEqual({
      remember: "failed:run-1",
      notify: null,
    });
    expect(decideThreadAlert(undefined, null)).toEqual({
      remember: NOTHING_ANNOUNCED,
      notify: null,
    });
  });

  it("announces a wait even on first sight, because it still needs an answer", () => {
    expect(decideThreadAlert(undefined, waiting).notify).toBe("approval");
  });

  it("remembers silent occasions so they never alert later", () => {
    const silent = { ...completed, silent: true };
    expect(decideThreadAlert(NOTHING_ANNOUNCED, silent)).toEqual({
      remember: "completed:run-1",
      notify: null,
    });
    // Unarchiving or waking the thread shows the same run again.
    expect(decideThreadAlert("completed:run-1", completed).notify).toBeNull();
  });
});

describe("webPushMessage", () => {
  it("names the reason, the thread, and a link that opens it", () => {
    expect(
      webPushMessage({
        kind: "approval",
        environmentId: "env 1",
        threadId: "thread/1",
        threadTitle: "  Fix login  ",
      }),
    ).toEqual({
      title: "Approval needed",
      body: "Fix login",
      url: "/env%201/thread%2F1",
      tag: "thread:thread/1",
    });
  });

  it("shortens very long titles and fills an empty one", () => {
    const long = webPushMessage({
      kind: "completed",
      environmentId: "e",
      threadId: "t",
      threadTitle: "x".repeat(500),
    });
    expect(long.body.length).toBe(180);
    expect(long.body.endsWith("…")).toBe(true);
    expect(
      webPushMessage({ kind: "failed", environmentId: "e", threadId: "t", threadTitle: " " }).body,
    ).toBe("AgentDock");
  });
});
