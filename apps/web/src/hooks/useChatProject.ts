import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { RegistryContext } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { availableChatWorkspaceRoot } from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ModelSelection, ScopedThreadRef } from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";
import { msg } from "gt-react";
import { useContext } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { newMessageId, newThreadId } from "~/lib/utils";
import {
  type EnvironmentPresentation,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { threadEnvironment } from "~/state/threads";
import { type NewThreadHandler, useNewThreadHandler } from "./useHandleNewThread";

function reportChatFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: thrownErrorMessage(error, m) ?? m(msg("An error occurred.")),
    }),
  );
}

type ChatEnvironment = Pick<EnvironmentPresentation, "connection" | "serverConfig"> & {
  readonly environmentId: EnvironmentId;
};

/** Opens (creating if needed) the shared "Chats" project of an environment. */
async function openChatProject(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
): Promise<EnvironmentProject> {
  const command = projectEnvironment.openChat;
  const result = await runAtomCommand(
    registry,
    command,
    { environmentId, input: {} },
    { label: command.label, reportFailure: false, reportDefect: true },
  );
  if (result._tag === "Success") return result.value;
  throw squashAtomCommandFailure(result);
}

/**
 * Starts a conversation-only chat thread and sends its first message. Usable
 * outside React (for example from the tray popup) with any atom registry.
 */
export async function startChatThread(input: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly environmentId: EnvironmentId;
  readonly prompt: string;
  readonly modelSelection: ModelSelection;
  readonly title?: string;
}): Promise<ScopedThreadRef> {
  const project = await openChatProject(input.registry, input.environmentId);
  const threadId = newThreadId();
  const createdAt = new Date().toISOString();
  const title = input.title ?? (input.prompt.trim().split("\n")[0]?.slice(0, 80) || "Chat");
  const command = threadEnvironment.startTurn;
  const result = await runAtomCommand(
    input.registry,
    command,
    {
      environmentId: input.environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: input.prompt, attachments: [] },
        modelSelection: input.modelSelection,
        titleSeed: title,
        runtimeMode: "approval-required",
        interactionMode: "default",
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection: input.modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    },
    { label: command.label, reportFailure: false, reportDefect: true },
  );
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return scopeThreadRef(input.environmentId, threadId);
}

export function createChatProjectActions(input: {
  readonly environments: () => Iterable<ChatEnvironment>;
  readonly primaryEnvironmentId: () => EnvironmentId | null;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly handleNewThread: NewThreadHandler;
}) {
  const chatWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null => {
    let environment: ChatEnvironment | undefined;
    for (const entry of input.environments()) {
      if (entry.environmentId === environmentId) environment = entry;
    }
    return availableChatWorkspaceRoot(environment?.connection.phase, environment?.serverConfig);
  };

  // The primary (local) environment wins; `fallback` only applies when it offers no chat root.
  const chatEnvironmentId = (fallback: EnvironmentId | null): EnvironmentId | null => {
    const primary = input.primaryEnvironmentId();
    if (primary !== null && chatWorkspaceRootFor(primary) !== null) return primary;
    if (fallback !== null && chatWorkspaceRootFor(fallback) !== null) return fallback;
    const offering = [...input.environments()].filter(
      (entry) => chatWorkspaceRootFor(entry.environmentId) !== null,
    );
    return offering.length === 1 ? (offering[0]?.environmentId ?? null) : null;
  };

  const openChat = async (environmentId: EnvironmentId): Promise<EnvironmentProject | null> => {
    const command = projectEnvironment.openChat;
    const result = await runAtomCommand(
      input.registry,
      command,
      { environmentId, input: {} },
      { label: command.label, reportFailure: false, reportDefect: true },
    );
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportChatFailure(m(msg("Could not start a chat")), squashAtomCommandFailure(result));
    }
    return null;
  };

  const startChatDraft = async (environmentId: EnvironmentId) => {
    const project = await openChat(environmentId);
    if (project) {
      await input
        .handleNewThread(scopeProjectRef(project.environmentId, project.id))
        .catch((error: unknown) => reportChatFailure(m(msg("Could not start a chat")), error));
    }
  };

  return { chatWorkspaceRootFor, chatEnvironmentId, openChat, startChatDraft };
}

export function useChatProject() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const handleNewThread = useNewThreadHandler();
  return createChatProjectActions({
    environments: () => environments,
    primaryEnvironmentId: () => primaryEnvironmentId,
    registry,
    handleNewThread,
  });
}
