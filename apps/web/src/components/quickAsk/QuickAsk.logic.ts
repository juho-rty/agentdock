import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { findProjectByPath } from "@t3tools/client-runtime/state/projects";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";

import { resolveSidebarThreadStatus } from "../Sidebar.logic";

/**
 * The composer's modes. "agent" starts a thread in the chosen project folder; "chat" starts a
 * conversation-only thread in the shared Chats project. Either way the thread opens in the main
 * window.
 */
export type QuickAskMode = "agent" | "chat";

const QUICK_ASK_MODE_STORAGE_KEY = "agentdock:quick-ask-mode";

export function readQuickAskMode(storage: Pick<Storage, "getItem"> | undefined): QuickAskMode {
  try {
    return storage?.getItem(QUICK_ASK_MODE_STORAGE_KEY) === "chat" ? "chat" : "agent";
  } catch {
    return "agent";
  }
}

export function writeQuickAskMode(
  storage: Pick<Storage, "setItem"> | undefined,
  mode: QuickAskMode,
): void {
  try {
    storage?.setItem(QUICK_ASK_MODE_STORAGE_KEY, mode);
  } catch {
    // Remembering the mode is a convenience; private windows may refuse storage.
  }
}

const QUICK_ASK_THREAD_LIMIT = 5;
const QUICK_ASK_PROJECT_CHIP_LIMIT = 5;

export type QuickAskThreadStatus = ReturnType<typeof resolveSidebarThreadStatus>;

export interface QuickAskThreadRow {
  readonly thread: EnvironmentThreadShell;
  readonly status: QuickAskThreadStatus;
  readonly activityAt: number;
}

const ACTIVE_STATUSES: ReadonlySet<QuickAskThreadStatus> = new Set([
  "working",
  "preparing",
  "waiting",
]);
const ATTENTION_STATUSES: ReadonlySet<QuickAskThreadStatus> = new Set([
  "approval",
  "input",
  "request",
]);

function isQuickAskThreadWorking(status: QuickAskThreadStatus): boolean {
  return ACTIVE_STATUSES.has(status) && status !== "waiting";
}

function activityMs(thread: EnvironmentThreadShell): number {
  const timestamp = resolveThreadActivityTimestamp(thread) ?? thread.updatedAt;
  const ms = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Threads asking for the user first, then running ones, then the most recent. */
export function selectQuickAskThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  limit = QUICK_ASK_THREAD_LIMIT,
): {
  readonly attention: ReadonlyArray<QuickAskThreadRow>;
  readonly recent: ReadonlyArray<QuickAskThreadRow>;
  readonly workingCount: number;
} {
  const rows = threads
    .filter((thread) => thread.archivedAt === null)
    .map((thread) => ({
      thread,
      status: resolveSidebarThreadStatus(thread),
      activityAt: activityMs(thread),
    }));
  const byActivity = (left: QuickAskThreadRow, right: QuickAskThreadRow) =>
    right.activityAt - left.activityAt;
  const attention = rows.filter((row) => ATTENTION_STATUSES.has(row.status)).toSorted(byActivity);
  const rest = rows.filter((row) => !ATTENTION_STATUSES.has(row.status));
  const running = rest.filter((row) => ACTIVE_STATUSES.has(row.status)).toSorted(byActivity);
  const idle = rest.filter((row) => !ACTIVE_STATUSES.has(row.status)).toSorted(byActivity);
  return {
    attention: attention.slice(0, limit),
    recent: [...running, ...idle].slice(0, Math.max(0, limit - Math.min(attention.length, limit))),
    workingCount: rows.filter((row) => isQuickAskThreadWorking(row.status)).length,
  };
}

export type QuickAskProjectChip =
  | {
      readonly kind: "folder";
      readonly key: string;
      readonly path: string;
      readonly label: string;
      /** The project already registered for this folder, if any. */
      readonly project: EnvironmentProject | null;
    }
  | {
      readonly kind: "project";
      readonly key: string;
      readonly path: string;
      readonly label: string;
      readonly project: EnvironmentProject;
    };

export function folderNameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).at(-1);
  return name && name.length > 0 ? name : path;
}

/** The front file-manager folder first, then projects by their latest thread activity. */
export function buildQuickAskProjectChips(input: {
  readonly fileManagerFolder: string | null;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly limit?: number;
}): ReadonlyArray<QuickAskProjectChip> {
  const limit = input.limit ?? QUICK_ASK_PROJECT_CHIP_LIMIT;
  const projects = input.projects.filter(
    (project) => project.archivedAt == null && project.isScratch !== true,
  );
  const chips: QuickAskProjectChip[] = [];
  let folderProjectId: string | null = null;
  if (input.fileManagerFolder !== null && input.fileManagerFolder.trim().length > 0) {
    const project =
      findProjectByPath(
        input.projects.filter((candidate) => candidate.isScratch !== true),
        input.fileManagerFolder,
      ) ?? null;
    folderProjectId = project?.id ?? null;
    chips.push({
      kind: "folder",
      key: `folder:${input.fileManagerFolder}`,
      path: input.fileManagerFolder,
      label: folderNameFromPath(input.fileManagerFolder),
      project,
    });
  }
  const lastActivity = new Map<string, number>();
  for (const thread of input.threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const at = activityMs(thread);
    if (at > (lastActivity.get(key) ?? Number.NEGATIVE_INFINITY)) lastActivity.set(key, at);
  }
  const projectActivity = (project: EnvironmentProject) =>
    lastActivity.get(`${project.environmentId}:${project.id}`) ??
    (Date.parse(project.updatedAt) || 0);
  const recent = projects
    .filter((project) => project.id !== folderProjectId)
    .toSorted((left, right) => projectActivity(right) - projectActivity(left));
  for (const project of recent) {
    if (chips.length >= limit) break;
    chips.push({
      kind: "project",
      key: `project:${project.environmentId}:${project.id}`,
      path: project.workspaceRoot,
      label: project.title,
      project,
    });
  }
  return chips;
}

/** Shortens a home-directory path to "~/…" for the hint line. */
export function abbreviateHomePath(path: string): string {
  const match = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/.exec(path);
  if (!match) return path;
  const rest = path.slice(match[0].length);
  return rest.length === 0 ? "~" : `~${rest.replace(/\\/g, "/")}`;
}
