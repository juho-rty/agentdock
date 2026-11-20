import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { resolveThreadActivityTimestamp } from "@t3tools/client-runtime/state/thread-sort";
import * as Schema from "effect/Schema";

import {
  filterSidebarV2VisibleThreads,
  resolveSidebarThreadStatus,
  type SidebarThreadStatus,
} from "../Sidebar.logic";

export type MobileTab = "threads" | "pullRequests" | "usage" | "settings";

/** The tab a path belongs to, or null for pages that hide the tab bar (threads, drafts). */
export function resolveMobileTab(pathname: string): MobileTab | null {
  if (pathname === "/") return "threads";
  if (pathname === "/pull-requests") return "pullRequests";
  if (pathname === "/usage") return "usage";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "settings";
  return null;
}

export const MOBILE_HOME_FILTERS_STORAGE_KEY = "agentdock:mobile-home:filters:v1";
export const MOBILE_HOME_WORKING_EXPANDED_STORAGE_KEY = "agentdock:mobile-home:working-expanded:v1";

export const MobileHomeFiltersSchema = Schema.Struct({
  environmentId: Schema.NullOr(Schema.String),
  projectKey: Schema.NullOr(Schema.String),
});
export type MobileHomeFilters = typeof MobileHomeFiltersSchema.Type;

export const NO_MOBILE_HOME_FILTERS: MobileHomeFilters = { environmentId: null, projectKey: null };

interface MobileHomeProjectRef {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
}

/** One entry of the project filter: a project group and the projects it stands for. */
export interface MobileHomeProjectOption {
  readonly projectKey: string;
  readonly displayName: string;
  readonly members: ReadonlyArray<MobileHomeProjectRef>;
}

/** Projects that have a member on the chosen environment; all of them without one. */
export function filterMobileHomeProjectOptions<T extends MobileHomeProjectOption>(
  options: ReadonlyArray<T>,
  environmentId: string | null,
): T[] {
  if (environmentId === null) return [...options];
  return options.filter((option) =>
    option.members.some((member) => member.environmentId === environmentId),
  );
}

/** Drops a stored choice whose environment or project is gone or no longer matches. */
export function resolveMobileHomeFilters(input: {
  readonly filters: MobileHomeFilters;
  readonly environmentIds: ReadonlyArray<string>;
  readonly projectOptions: ReadonlyArray<MobileHomeProjectOption>;
}): MobileHomeFilters {
  const environmentId =
    input.filters.environmentId !== null &&
    input.environmentIds.includes(input.filters.environmentId)
      ? input.filters.environmentId
      : null;
  const projectKey = filterMobileHomeProjectOptions(input.projectOptions, environmentId).some(
    (option) => option.projectKey === input.filters.projectKey,
  )
    ? input.filters.projectKey
    : null;
  return { environmentId, projectKey };
}

export interface MobileHomeThreadRow<T> {
  readonly thread: T;
  readonly status: SidebarThreadStatus;
  readonly activityAt: number;
}

export interface MobileHomeSections<T> {
  /** Threads that are not running, newest activity first. */
  readonly threads: ReadonlyArray<MobileHomeThreadRow<T>>;
  /** Running threads, newest activity first. */
  readonly working: ReadonlyArray<MobileHomeThreadRow<T>>;
}

function activityMs(thread: EnvironmentThreadShell): number {
  const parsed = Date.parse(resolveThreadActivityTimestamp(thread) ?? thread.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** The flat phone list: visible threads that pass the filters, split by whether they run. */
export function buildMobileHomeSections<T extends EnvironmentThreadShell>(input: {
  readonly threads: ReadonlyArray<T>;
  readonly delegatedUnderParent: ReadonlySet<string>;
  readonly environmentId: string | null;
  readonly projectOption: MobileHomeProjectOption | null;
}): MobileHomeSections<T> {
  const projectKeys =
    input.projectOption === null
      ? null
      : new Set(
          input.projectOption.members.map((member) => `${member.environmentId}:${member.id}`),
        );
  const rows = filterSidebarV2VisibleThreads(input.threads, projectKeys, input.delegatedUnderParent)
    .filter(
      (thread) => input.environmentId === null || thread.environmentId === input.environmentId,
    )
    .map((thread) => ({
      thread,
      status: resolveSidebarThreadStatus(thread),
      activityAt: activityMs(thread),
    }))
    .toSorted((left, right) => right.activityAt - left.activityAt);
  const isWorking = (row: MobileHomeThreadRow<T>) =>
    row.status === "working" || row.status === "preparing";
  return {
    threads: rows.filter((row) => !isWorking(row)),
    working: rows.filter(isWorking),
  };
}

export interface MobileHomeProjectGroup<T> {
  /** Null for threads whose project is not one of the options. */
  readonly projectKey: string | null;
  readonly displayName: string | null;
  readonly rows: ReadonlyArray<MobileHomeThreadRow<T>>;
}

/**
 * Rows gathered under their project. Groups keep the order their newest thread has in
 * `rows`, and each group keeps the order of `rows`.
 */
export function groupMobileHomeRowsByProject<
  T extends { readonly environmentId: string; readonly projectId: string },
>(
  rows: ReadonlyArray<MobileHomeThreadRow<T>>,
  projectOptions: ReadonlyArray<MobileHomeProjectOption>,
): MobileHomeProjectGroup<T>[] {
  const optionByMember = new Map<string, MobileHomeProjectOption>();
  for (const option of projectOptions) {
    for (const member of option.members) {
      optionByMember.set(`${member.environmentId}:${member.id}`, option);
    }
  }
  const groups = new Map<
    string | null,
    { projectKey: string | null; displayName: string | null; rows: MobileHomeThreadRow<T>[] }
  >();
  for (const row of rows) {
    const option = optionByMember.get(`${row.thread.environmentId}:${row.thread.projectId}`);
    const projectKey = option?.projectKey ?? null;
    const group = groups.get(projectKey);
    if (group === undefined) {
      groups.set(projectKey, {
        projectKey,
        displayName: option?.displayName ?? null,
        rows: [row],
      });
    } else {
      group.rows.push(row);
    }
  }
  return [...groups.values()];
}

/**
 * Where the new-thread button starts a draft: the filtered project (on the filtered
 * environment when it has a member there), else the fallback, else nowhere.
 */
export function resolveMobileNewThreadProject(input: {
  readonly environmentId: string | null;
  readonly projectOption: MobileHomeProjectOption | null;
  readonly fallbackProjects: ReadonlyArray<MobileHomeProjectRef>;
}): MobileHomeProjectRef | null {
  const onEnvironment = (project: MobileHomeProjectRef) =>
    input.environmentId === null || project.environmentId === input.environmentId;
  const pick = (pool: ReadonlyArray<MobileHomeProjectRef>) =>
    pool.find(onEnvironment) ?? pool[0] ?? null;
  return pick(input.projectOption?.members ?? []) ?? pick(input.fallbackProjects);
}
