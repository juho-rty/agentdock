import type { ThreadListMode } from "@t3tools/client-runtime/state/projects";
import * as Schema from "effect/Schema";

import { readLocalStorageValue } from "./hooks/useLocalStorage";

export type SidebarThreadMode = ThreadListMode;

export const SidebarThreadModeSchema = Schema.Literals(["agent", "chat"]);
export const SIDEBAR_THREAD_MODE_STORAGE_KEY = "t3code:sidebar:thread-mode";

export function readSidebarThreadMode(): SidebarThreadMode {
  try {
    return readLocalStorageValue(SIDEBAR_THREAD_MODE_STORAGE_KEY, "agent", SidebarThreadModeSchema);
  } catch {
    return "agent";
  }
}

export {
  chatProjectKeys,
  filterThreadsForMode,
  isChatThread,
  withoutChatProjects,
} from "@t3tools/client-runtime/state/projects";
