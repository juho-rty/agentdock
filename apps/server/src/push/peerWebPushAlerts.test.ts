import { assert, describe, it } from "@effect/vitest";

import {
  makePeerAlertMemory,
  observePeerThreadAlert,
  peerLastAssistantMessage,
  peerThreadPhase,
  stepPeerAlerts,
  type PeerAlertThread,
} from "./peerWebPushAlerts.ts";

const HOLD = 5_000;

const thread = (overrides: Partial<PeerAlertThread> = {}): PeerAlertThread => ({
  threadId: "thread-1",
  title: "Fix the build",
  status: "running",
  latestRunId: "run-1",
  settled: false,
  snoozed: false,
  parentThreadId: null,
  relationshipToParent: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  ...overrides,
});

const seeded = (threads: ReadonlyArray<PeerAlertThread>) => {
  const memory = makePeerAlertMemory();
  stepPeerAlerts(memory, threads, 0, HOLD);
  return memory;
};

describe("peerThreadPhase", () => {
  it("reads a pending request before the run status", () => {
    assert.strictEqual(
      peerThreadPhase(
        thread({ status: "waiting", pendingRequest: { requestId: "r1", kind: "user_input" } }),
      ),
      "waiting_for_input",
    );
    assert.strictEqual(
      peerThreadPhase(
        thread({ status: "waiting", pendingRequest: { requestId: "r1", kind: "command" } }),
      ),
      "waiting_for_approval",
    );
    // The provider's own sign-in renewal is nothing the user answers.
    assert.strictEqual(
      peerThreadPhase(
        thread({ status: "waiting", pendingRequest: { requestId: "r1", kind: "auth_refresh" } }),
      ),
      "running",
    );
  });

  it("hides settled endings and says nothing for stopped or idle threads", () => {
    assert.strictEqual(peerThreadPhase(thread({ status: "completed" })), "completed");
    assert.strictEqual(peerThreadPhase(thread({ status: "completed", settled: true })), null);
    assert.strictEqual(peerThreadPhase(thread({ status: "failed", settled: true })), null);
    for (const status of ["idle", "queued", "interrupted", "cancelled", "rolled_back"]) {
      assert.strictEqual(peerThreadPhase(thread({ status })), null);
    }
  });
});

describe("observePeerThreadAlert", () => {
  it("keys requests by request and endings by run", () => {
    assert.deepStrictEqual(
      observePeerThreadAlert(thread({ pendingRequest: { requestId: "r1", kind: "permission" } })),
      { kind: "approval", identity: "request:r1", silent: false },
    );
    assert.deepStrictEqual(observePeerThreadAlert(thread({ status: "failed" })), {
      kind: "failed",
      identity: "failed:run-1",
      silent: false,
    });
  });

  it("remembers snoozed and settled endings without announcing them", () => {
    assert.deepStrictEqual(observePeerThreadAlert(thread({ status: "completed", snoozed: true })), {
      kind: "completed",
      identity: "completed:run-1",
      silent: true,
    });
    assert.deepStrictEqual(observePeerThreadAlert(thread({ status: "completed", settled: true })), {
      kind: "completed",
      identity: "completed:run-1",
      silent: true,
    });
  });
});

describe("stepPeerAlerts", () => {
  it("only records on the first listing", () => {
    const memory = makePeerAlertMemory();
    const result = stepPeerAlerts(
      memory,
      [
        thread({ pendingRequest: { requestId: "r1", kind: "user_input" } }),
        thread({ threadId: "thread-2", status: "completed" }),
      ],
      0,
      HOLD,
    );
    assert.deepStrictEqual(result, { alerts: [], recheckAt: null });
    assert.isTrue(memory.seeded);
    // The same state on the next poll stays quiet.
    const again = stepPeerAlerts(
      memory,
      [
        thread({ pendingRequest: { requestId: "r1", kind: "user_input" } }),
        thread({ threadId: "thread-2", status: "completed" }),
      ],
      25_000,
      HOLD,
    );
    assert.deepStrictEqual(again.alerts, []);
  });

  it("announces a new request once", () => {
    const memory = seeded([thread()]);
    const asking = [
      thread({ status: "waiting", pendingRequest: { requestId: "r2", kind: "user_input" } }),
    ];
    assert.deepStrictEqual(stepPeerAlerts(memory, asking, 1_000, HOLD).alerts, [
      { threadId: "thread-1", threadTitle: "Fix the build", kind: "input" },
    ]);
    assert.deepStrictEqual(stepPeerAlerts(memory, asking, 2_000, HOLD).alerts, []);
  });

  it("holds a completion until it still stands after the hold", () => {
    const memory = seeded([thread()]);
    const done = [thread({ status: "completed" })];
    const first = stepPeerAlerts(memory, done, 1_000, HOLD);
    assert.deepStrictEqual(first, { alerts: [], recheckAt: 6_000 });
    assert.deepStrictEqual(stepPeerAlerts(memory, done, 3_000, HOLD), {
      alerts: [],
      recheckAt: 6_000,
    });
    assert.deepStrictEqual(stepPeerAlerts(memory, done, 6_000, HOLD).alerts, [
      { threadId: "thread-1", threadTitle: "Fix the build", kind: "completed" },
    ]);
    assert.deepStrictEqual(stepPeerAlerts(memory, done, 31_000, HOLD).alerts, []);
  });

  it("drops a held completion when the thread picks up again", () => {
    const memory = seeded([thread()]);
    stepPeerAlerts(memory, [thread({ status: "completed" })], 1_000, HOLD);
    stepPeerAlerts(memory, [thread({ status: "running", latestRunId: "run-2" })], 6_000, HOLD);
    const later = stepPeerAlerts(
      memory,
      [thread({ status: "completed", latestRunId: "run-2" })],
      7_000,
      HOLD,
    );
    assert.deepStrictEqual(later, { alerts: [], recheckAt: 12_000 });
  });

  it("announces a failure at once", () => {
    const memory = seeded([thread()]);
    assert.deepStrictEqual(stepPeerAlerts(memory, [thread({ status: "failed" })], 1_000, HOLD), {
      alerts: [{ threadId: "thread-1", threadTitle: "Fix the build", kind: "failed" }],
      recheckAt: null,
    });
  });

  it("treats a thread created after the first listing as new", () => {
    const memory = seeded([thread()]);
    const fresh = thread({
      threadId: "thread-new",
      title: "Quick question",
      status: "completed",
      createdAt: "2026-11-20T11:00:00.000Z",
    });
    stepPeerAlerts(memory, [fresh], 1_000, HOLD);
    assert.deepStrictEqual(stepPeerAlerts(memory, [fresh], 6_000, HOLD).alerts, [
      { threadId: "thread-new", threadTitle: "Quick question", kind: "completed" },
    ]);
  });

  it("keeps an older thread coming back into view quiet", () => {
    const memory = seeded([thread()]);
    const returning = thread({
      threadId: "thread-old",
      status: "completed",
      createdAt: "2026-11-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(stepPeerAlerts(memory, [returning], 1_000, HOLD), {
      alerts: [],
      recheckAt: null,
    });
  });

  it("asks a subagent's question on its top-level thread, once per request", () => {
    const parent = thread({ status: "waiting" });
    const memory = seeded([parent]);
    const child = thread({
      threadId: "child-1",
      title: "Subagent",
      status: "waiting",
      parentThreadId: "thread-1",
      relationshipToParent: "subagent",
      pendingRequest: { requestId: "r9", kind: "command" },
    });
    assert.deepStrictEqual(stepPeerAlerts(memory, [parent, child], 1_000, HOLD).alerts, [
      { threadId: "thread-1", threadTitle: "Fix the build", kind: "approval" },
    ]);
    assert.deepStrictEqual(stepPeerAlerts(memory, [parent, child], 2_000, HOLD).alerts, []);
  });

  it("announces delegated work's questions but not its endings", () => {
    const delegated = thread({ delegatedFrom: { environmentId: "env-mac", threadId: "t" } });
    const memory = seeded([delegated]);
    assert.deepStrictEqual(
      stepPeerAlerts(memory, [{ ...delegated, status: "failed" }], 1_000, HOLD).alerts,
      [],
    );
    assert.deepStrictEqual(
      stepPeerAlerts(
        memory,
        [
          {
            ...delegated,
            latestRunId: "run-2",
            pendingRequest: { requestId: "r3", kind: "user_input" },
          },
        ],
        2_000,
        HOLD,
      ).alerts,
      [{ threadId: "thread-1", threadTitle: "Fix the build", kind: "input" }],
    );
  });

  it("bounds remembered thread entries so long-running servers do not grow without limit", () => {
    const many = Array.from({ length: 2_100 }, (_, index) =>
      thread({ threadId: `thread-${index}`, latestRunId: `run-${index}` }),
    );
    const memory = seeded(many);
    assert.strictEqual(memory.remembered.size, 2_000);
    assert.isFalse(memory.remembered.has("thread-0"));
    assert.isTrue(memory.remembered.has("thread-2099"));
  });

  it("takes the push excerpt from the newest assistant reply of a thread read", () => {
    const item = (type: string, text: string | null) => ({ type, text, status: "completed" });
    assert.strictEqual(
      peerLastAssistantMessage({
        items: [
          item("user_message", "Fix the build"),
          item("assistant_message", "Looking into it."),
          item("tool_call", "pnpm build"),
          item("assistant_message", "The build passes now."),
          item("assistant_message", "  "),
        ],
      }),
      "The build passes now.",
    );
    assert.isNull(peerLastAssistantMessage({ items: [item("user_message", "Hi")] }));
    assert.isNull(peerLastAssistantMessage({ threads: [] }));
    assert.isNull(peerLastAssistantMessage(null));
  });
});
