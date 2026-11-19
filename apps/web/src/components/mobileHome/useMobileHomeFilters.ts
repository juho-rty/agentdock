import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import { useGT } from "gt-react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useSidebarProjectGroups } from "../../hooks/useSidebarProjectGroups";
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
 * and shared with the tab bar so a new thread starts in the filtered project.
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

  const chatProjects = projects.filter(
    (project) => project.isChat === true && project.archivedAt == null,
  );
  const allProjectOptions: MobileHomeProjectOption[] = [
    ...pickableProjectGroups(projectGroups).map((group) => ({
      projectKey: group.projectKey,
      displayName: group.displayName,
      members: group.memberProjects,
    })),
    ...(chatProjects.length > 0
      ? [{ projectKey: CHATS_PROJECT_KEY, displayName: gt("Chats"), members: chatProjects }]
      : []),
  ];
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
      projectOptions.find((option) => option.projectKey === filters.projectKey) ?? null,
    setFilters,
  };
}
