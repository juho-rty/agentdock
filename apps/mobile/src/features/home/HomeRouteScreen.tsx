import { uuidv4 } from "../../lib/uuid";
import { ThreadUndoNotice } from "./ThreadUndoNotice";
import { use } from "react";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { useNavigation } from "@react-navigation/native";
import { useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useGT, useMessages } from "gt-react-native";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";
import {
  chatProjectKeys,
  filterThreadsForMode,
  isChatThread,
  type ThreadListMode,
} from "@t3tools/client-runtime/state/projects";

import { useProjects } from "../../state/entities";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useLaunchingThreads, usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen, homePinsFilters } from "./HomeScreen";
import { HomePinnedFilters } from "./HomePinnedFilters";
import { useHomeListOptions } from "./home-list-options";
import {
  runWhenHomeCovered,
  useAtomValueWhileVisible,
  useHomeRouteVisible,
} from "./home-route-visibility";
import {
  buildHomeProjectScopes,
  resolveHomeProjectFilterScope,
  sortHomeProjectScopes,
} from "./homeThreadList";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "../layout/workspace/useSelectWorkspaceTab";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { WorkspaceListEmptyDetail } from "../layout/workspace/WorkspaceListEmptyDetail";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";
import { buildHomeListFilterMenuItems, homeListFilterEnvironments } from "./home-list-filter-menu";

export function HomeRouteScreen() {
  const gt = useGT();
  const m = useMessages();
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  const { layout, setPrimarySidebarSearchQuery, startNewTask } = useAdaptiveWorkspaceLayout();
  const { primarySidebarSearchQuery } = useWorkspacePaneState();
  const selectDetail = useSelectWorkspaceDetail();
  const allProjects = useProjects();
  // Stop rebuilding the streaming thread list while Thread covers Home.
  const visible = useHomeRouteVisible();
  const allThreads = useLaunchingThreads(
    useAtomValueWhileVisible(steadyNavigationThreadShellsAtom, visible),
  );
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const workspace = useWorkspaceTabs();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery =
    Platform.OS === "android"
      ? primarySidebarSearchQuery
      : (workspace?.state.tabs.threads.query ?? localSearchQuery);
  const setSearchQuery = (query: string) => {
    if (Platform.OS === "android") setPrimarySidebarSearchQuery(query);
    else if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setLocalSearchQuery(query);
  };
  // Split layouts keep the query; only the stacked layout opens the thread over the list.
  // Android's search field keeps its own open state, which a cleared query would leave open.
  const clearsSearchOnOpen = Platform.OS !== "android" && !layout.usesSplitView;
  const selectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) => {
    if (searchQuery !== "" && clearsSearchOnOpen && workspace)
      runWhenHomeCovered(() => workspace.cancelSearch("threads"));
    selectDetail({ name: "Thread", params });
  };
  const handleSelectThread = (thread: EnvironmentThreadShell) =>
    selectThreadRoute({ environmentId: String(thread.environmentId), threadId: String(thread.id) });
  const handleNewThreadOnBranch = (thread: EnvironmentThreadShell) => {
    selectThreadRoute({
      draft: {
        requestId: uuidv4(),
        environmentId: String(thread.environmentId),
        projectId: String(thread.projectId),
        branch: thread.branch,
        worktreePath: thread.worktreePath,
      },
    });
  };

  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    moveThread,
    renameThread,
    regenerateThreadTitle,
    unsettleThread,
  } = useThreadListActions();
  const allPendingTasks = usePendingNewTasks();
  const { openPendingTask, confirmDeletePendingTask } =
    usePendingTaskListActions(selectThreadRoute);
  const environments = homeListFilterEnvironments(workspaceEnvironments);
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const {
    options: listOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
    setThreadMode,
    setThreadSortOrder,
  } = useHomeListOptions(availableEnvironmentIds);
  const threadMode = listOptions.threadMode;
  const chatMode = threadMode === "chat";
  const chatKeys = useMemo(() => chatProjectKeys(allProjects), [allProjects]);
  // Both modes stay built, so switching only slides between ready lists.
  const agentPage = useHomeModePage("agent", allProjects, allThreads, allPendingTasks, chatKeys);
  const chatPage = useHomeModePage("chat", allProjects, allThreads, allPendingTasks, chatKeys);
  // Chat lists every computer's chats together, so the environment and project scope rest.
  const selectedEnvironmentId = chatMode ? null : listOptions.selectedEnvironmentId;
  const agentProjectScopes = useMemo(
    () =>
      buildHomeProjectScopes(
        {
          projects: agentPage.projects,
          environmentId: listOptions.selectedEnvironmentId,
          projectGroupingMode: listOptions.projectGroupingMode,
        },
        m,
      ),
    [listOptions.projectGroupingMode, agentPage.projects, listOptions.selectedEnvironmentId, m],
  );
  const agentProjectFilterOptions = useMemo(
    () =>
      pickableProjectGroups(
        sortHomeProjectScopes({
          scopes: agentProjectScopes,
          threads: agentPage.threads,
          pendingTasks: [],
          projectSortOrder: "updated_at",
        }),
      ).map((scope) => ({
        key: scope.key,
        label: scope.title,
      })),
    [agentProjectScopes, agentPage.threads],
  );
  const projectFilterOptions = chatMode ? [] : agentProjectFilterOptions;
  const agentSelectedProjectKey =
    resolveHomeProjectFilterScope(agentProjectScopes, agentPage.projects, listOptions)?.key ?? null;
  const selectedProjectKey = chatMode ? null : agentSelectedProjectKey;

  const pinsFilters = homePinsFilters(workspace);
  const [filtersHeights, setFiltersHeights] = useState<Record<ThreadListMode, number>>({
    agent: 0,
    chat: 0,
  });
  const pageFiltersHeight = (mode: ThreadListMode) =>
    filtersHeights[mode] || filtersHeights[mode === "chat" ? "agent" : "chat"];
  const [pagerWidth, setPagerWidth] = useState(0);
  const pageOffset = useSharedValue(chatMode ? 1 : 0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the native slide animation toward the selected mode
  useEffect(() => {
    pageOffset.set(
      withTiming(chatMode ? 1 : 0, {
        duration: 280,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [chatMode, pageOffset]);
  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -pageOffset.value * pagerWidth }],
  }));

  if (layout.usesSplitView && !nativePrimaryColumn) {
    return (
      <WorkspaceListEmptyDetail
        hasConnections={catalogState.hasConnections}
        onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
        onStartNewTask={startNewTask}
      />
    );
  }

  return (
    <AndroidHomeFabLayout onStartNewTask={startNewTask}>
      <>
        <WorkspaceListHeader
          accessibilityLabel={gt("AgentDock, Threads")}
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          search={{
            value: searchQuery,
            onChangeText: setSearchQuery,
            placeholder: gt("Search", { $context: "search field placeholder" }),
            accessibilityLabel: gt("Search threads"),
          }}
          filter={{
            customized: selectedEnvironmentId !== null || selectedProjectKey !== null,
            items: buildHomeListFilterMenuItems(
              {
                environments,
                projects: projectFilterOptions,
                selectedEnvironmentId,
                selectedProjectKey,
                onEnvironmentChange: setSelectedEnvironmentId,
                onProjectChange: setSelectedProjectKey,
                threadSortOrder: listOptions.threadSortOrder,
                onThreadSortOrderChange: setThreadSortOrder,
              },
              m,
            ),
          }}
        />

        <View
          style={{ flex: 1, overflow: "hidden" }}
          onLayout={(event) => setPagerWidth(event.nativeEvent.layout.width)}
        >
          <Animated.View
            style={[
              {
                flex: 1,
                flexDirection: "row",
                width: pagerWidth > 0 ? pagerWidth * 2 : "200%",
                // Hidden until measured, so a saved Chat mode never flashes the Agent page.
                opacity: pagerWidth > 0 ? 1 : 0,
              },
              pagerStyle,
            ]}
          >
            {(["agent", "chat"] as const).map((mode) => {
              const page = mode === "chat" ? chatPage : agentPage;
              const active = mode === threadMode;
              return (
                <View
                  key={mode}
                  style={{ flex: 1 }}
                  pointerEvents={active ? "auto" : "none"}
                  accessibilityElementsHidden={!active}
                  importantForAccessibility={active ? "auto" : "no-hide-descendants"}
                >
                  <HomeScreen
                    catalogState={catalogState}
                    environments={environments}
                    onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
                    onArchiveThread={archiveThread}
                    onDeleteThread={confirmDeleteThread}
                    onSettleThread={settleThread}
                    onSnoozeThread={snoozeThread}
                    onUnsnoozeThread={unsnoozeThread}
                    onUnsettleThread={unsettleThread}
                    onPinThread={pinThread}
                    onUnpinThread={unpinThread}
                    onSetThreadAutoSettle={setThreadAutoSettle}
                    onMoveThread={moveThread}
                    onRenameThread={renameThread}
                    onRegenerateThreadTitle={regenerateThreadTitle}
                    onOpenSettings={() => selectTab("settings")}
                    onSearchQueryChange={setSearchQuery}
                    onSelectThread={handleSelectThread}
                    onSelectPendingTask={openPendingTask}
                    onDeletePendingTask={confirmDeletePendingTask}
                    onNewThreadOnBranch={handleNewThreadOnBranch}
                    onNewThreadInProject={(project) => {
                      selectThreadRoute({
                        draft: {
                          requestId: uuidv4(),
                          environmentId: String(project.environmentId),
                          projectId: String(project.id),
                          title: project.title,
                        },
                      });
                    }}
                    onStartNewTask={startNewTask}
                    projectGroupingMode={listOptions.projectGroupingMode}
                    projectSortOrder={listOptions.projectSortOrder}
                    savedConnectionsById={savedConnectionsById}
                    searchQuery={searchQuery}
                    threadSortOrder={listOptions.threadSortOrder}
                    pendingTasks={page.pendingTasks}
                    projects={page.projects}
                    selectedEnvironmentId={
                      mode === "chat" ? null : listOptions.selectedEnvironmentId
                    }
                    selectedProjectKey={mode === "chat" ? null : agentSelectedProjectKey}
                    threads={page.threads}
                    threadMode={mode}
                    hasThreadsOutsideMode={allThreads.length > page.threads.length}
                    visible={visible}
                    active={active}
                    pinnedFiltersHeight={pageFiltersHeight(mode)}
                  />
                </View>
              );
            })}
          </Animated.View>
          {pinsFilters ? (
            <HomePinnedFilters
              environments={environments}
              projects={agentProjectFilterOptions}
              selectedEnvironmentId={listOptions.selectedEnvironmentId}
              selectedProjectKey={agentSelectedProjectKey}
              onEnvironmentChange={setSelectedEnvironmentId}
              onProjectChange={setSelectedProjectKey}
              threadMode={threadMode}
              onThreadModeChange={setThreadMode}
              threadSortOrder={listOptions.threadSortOrder}
              onThreadSortOrderChange={setThreadSortOrder}
              onHeightChange={(height) =>
                setFiltersHeights((heights) =>
                  heights[threadMode] === height ? heights : { ...heights, [threadMode]: height },
                )
              }
            />
          ) : null}
        </View>
        <ThreadUndoNotice visible={visible} />
      </>
    </AndroidHomeFabLayout>
  );
}

function useHomeModePage(
  mode: ThreadListMode,
  allProjects: ReturnType<typeof useProjects>,
  allThreads: ReadonlyArray<EnvironmentThreadShell>,
  allPendingTasks: ReturnType<typeof usePendingNewTasks>,
  chatKeys: ReturnType<typeof chatProjectKeys>,
) {
  const chatMode = mode === "chat";
  const projects = useMemo(
    () => allProjects.filter((project) => (project.isChat === true) === chatMode),
    [allProjects, chatMode],
  );
  const threads = useMemo(
    () => filterThreadsForMode(allThreads, mode, chatKeys),
    [allThreads, mode, chatKeys],
  );
  const pendingTasks = useMemo(
    () => allPendingTasks.filter((task) => isChatThread(task, chatKeys) === chatMode),
    [allPendingTasks, chatKeys, chatMode],
  );
  return { projects, threads, pendingTasks };
}
