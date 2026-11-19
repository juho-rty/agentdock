import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ label: string; input: Record<string, unknown> }>,
}));

vi.mock("@t3tools/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runAtomCommand: async (
    _registry: unknown,
    command: { label: string },
    input: Record<string, unknown>,
  ) => {
    calls.push({ label: command.label, input });
    return {
      _tag: "Success",
      value: command.label.endsWith(":open-chat")
        ? { id: "chats", environmentId: "local", isChat: true }
        : undefined,
    };
  },
}));

import { createChatProjectActions, startChatThread } from "./useChatProject";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

function chatEnvironment(environmentId: EnvironmentId, chatWorkspaceRoot: string | null) {
  return {
    environmentId,
    connection: { phase: "connected" },
    serverConfig: { chatWorkspaceRoot },
  } as never;
}

function actions(primary: EnvironmentId | null, localRoot: string | null) {
  const environments = [chatEnvironment(local, localRoot), chatEnvironment(remote, "/r/chats")];
  return createChatProjectActions({
    environments: () => environments,
    primaryEnvironmentId: () => primary,
    registry: AtomRegistry.make(),
    handleNewThread: async () => null,
  });
}

describe("chatEnvironmentId", () => {
  it("prefers the primary environment, then the fallback", () => {
    expect(actions(local, "/l/chats").chatEnvironmentId(remote)).toBe(local);
    expect(actions(local, null).chatEnvironmentId(remote)).toBe(remote);
    expect(actions(local, null).chatEnvironmentId(null)).toBe(remote);
  });
});

describe("startChatThread", () => {
  it("opens the Chats project and starts a conversation-only thread in it", async () => {
    calls.length = 0;
    const modelSelection = {
      provider: "claudeAgent",
      model: "claude",
    } as unknown as ModelSelection;
    const ref = await startChatThread({
      registry: AtomRegistry.make(),
      environmentId: local,
      prompt: "What is a monad?\nExplain simply.",
      modelSelection,
    });

    expect(calls.map((call) => call.label)[0]).toBe("environment-data:projects:open-chat");
    expect(calls).toHaveLength(2);
    const turn = calls[1]?.input as {
      environmentId: string;
      input: {
        threadId: string;
        titleSeed: string;
        runtimeMode: string;
        bootstrap: { createThread: { projectId: string; worktreePath: null; title: string } };
      };
    };
    expect(turn.environmentId).toBe(local);
    expect(turn.input.runtimeMode).toBe("approval-required");
    expect(turn.input.titleSeed).toBe("What is a monad?");
    expect(turn.input.bootstrap.createThread).toMatchObject({
      projectId: "chats",
      worktreePath: null,
      title: "What is a monad?",
    });
    expect(ref).toEqual({ environmentId: local, threadId: turn.input.threadId });
  });
});
