import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";

/** How many unarchived threads are running on each computer. */
export function workingThreadCountByEnvironment(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyMap<EnvironmentId, number> {
  const counts = new Map<EnvironmentId, number>();
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const status = resolveSidebarThreadStatus(thread);
    if (status !== "working" && status !== "preparing") continue;
    counts.set(thread.environmentId, (counts.get(thread.environmentId) ?? 0) + 1);
  }
  return counts;
}
