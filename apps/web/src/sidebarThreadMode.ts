import * as Schema from "effect/Schema";

import { readLocalStorageValue } from "./hooks/useLocalStorage";

export type SidebarThreadMode = "agent" | "chat";

export const SidebarThreadModeSchema = Schema.Literals(["agent", "chat"]);
export const SIDEBAR_THREAD_MODE_STORAGE_KEY = "t3code:sidebar:thread-mode";

export function readSidebarThreadMode(): SidebarThreadMode {
  try {
    return readLocalStorageValue(SIDEBAR_THREAD_MODE_STORAGE_KEY, "agent", SidebarThreadModeSchema);
  } catch {
    return "agent";
  }
}

export function withoutChatProjects<P extends { readonly isChat?: true }>(
  projects: ReadonlyArray<P>,
): P[] {
  return projects.filter((project) => project.isChat !== true);
}

export function chatProjectKeys(
  projects: ReadonlyArray<{
    readonly environmentId: string;
    readonly id: string;
    readonly isChat?: true;
  }>,
): ReadonlySet<string> {
  return new Set(
    projects
      .filter((project) => project.isChat === true)
      .map((project) => `${project.environmentId}:${project.id}`),
  );
}

export function isChatThread(
  thread: { readonly environmentId: string; readonly projectId: string },
  chatKeys: ReadonlySet<string>,
): boolean {
  return chatKeys.has(`${thread.environmentId}:${thread.projectId}`);
}

/** Agent lists project threads; Chat lists only threads of the chat projects. */
export function filterThreadsForMode<
  T extends { readonly environmentId: string; readonly projectId: string },
>(
  threads: ReadonlyArray<T>,
  mode: SidebarThreadMode,
  chatKeys: ReadonlySet<string>,
): ReadonlyArray<T> {
  if (mode === "agent" && chatKeys.size === 0) return threads;
  return threads.filter((thread) => isChatThread(thread, chatKeys) === (mode === "chat"));
}
