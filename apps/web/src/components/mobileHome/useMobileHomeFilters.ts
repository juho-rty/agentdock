import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { useGT } from "gt-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
import {
  chatProjectKeys,
  SIDEBAR_THREAD_MODE_STORAGE_KEY,
  type SidebarThreadMode,
  SidebarThreadModeSchema,
} from "../../sidebarThreadMode";
import { useProjects } from "../../state/entities";
import { useEnvironmentIdentities } from "../../state/environments";
import {
  filterMobileHomeProjectOptions,
  MOBILE_HOME_FILTERS_STORAGE_KEY,
  MobileHomeFiltersSchema,
  NO_MOBILE_HOME_FILTERS,
  resolveMobileHomeFilters,
  type MobileHomeFilters,
  type MobileHomeProjectOption,
} from "./MobileHome.logic";

const CHATS_PROJECT_KEY = "agentdock:chats";

/**
 * The phone home's filters. Stored, because the home unmounts whenever a thread opens,
 * and shared with the tab bar so a new thread starts in the filtered project. Agent and
 * Chat share the sidebar's stored tab, so the phone and the desktop list the same kind.
 */
export function useMobileHomeFilters() {
  const gt = useGT();
  const environments = useEnvironmentIdentities();
  const projects = useProjects();
  const projectGroups = useSidebarProjectGroups();
  const [storedFilters, setFilters] = useLocalStorage<MobileHomeFilters, MobileHomeFilters>(
    MOBILE_HOME_FILTERS_STORAGE_KEY,
    NO_MOBILE_HOME_FILTERS,
    MobileHomeFiltersSchema,
  );

  const [threadMode, setThreadMode] = useLocalStorage<SidebarThreadMode, SidebarThreadMode>(
    SIDEBAR_THREAD_MODE_STORAGE_KEY,
    "agent",
    SidebarThreadModeSchema,
  );

  // Chat lists every chat thread, so it stands in for a project filter.
  const chatOption: MobileHomeProjectOption = {
    projectKey: CHATS_PROJECT_KEY,
    displayName: gt("Chats"),
    members: projects.filter((project) => project.isChat === true && project.archivedAt == null),
  };
  const allProjectOptions: MobileHomeProjectOption[] = pickableProjectGroups(projectGroups).map(
    (group) => ({
      projectKey: group.projectKey,
      displayName: group.displayName,
      members: group.memberProjects,
    }),
  );
  const filters = resolveMobileHomeFilters({
    filters: storedFilters,
    environmentIds: environments.map((environment) => environment.environmentId),
    projectOptions: allProjectOptions,
  });
  const projectOptions = filterMobileHomeProjectOptions(allProjectOptions, filters.environmentId);

  return {
    environments,
    filters,
    projectOptions,
    projectOption:
      threadMode === "chat"
        ? chatOption
        : (projectOptions.find((option) => option.projectKey === filters.projectKey) ?? null),
    setFilters,
    threadMode,
    setThreadMode,
    chatKeys: chatProjectKeys(projects),
  };
}
