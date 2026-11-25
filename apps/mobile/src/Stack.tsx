import { isDraftThreadRoute } from "./features/threads/thread-route-state";
import { createWorkspaceStackNavigator } from "./features/layout/createWorkspaceStackNavigator";
import {
  createPathConfigForStaticNavigation,
  getPathFromState,
  NavigationState,
  StackActions,
  useNavigation,
} from "@react-navigation/native";
import { createNativeStackScreen } from "@react-navigation/native-stack";
import { msg, T, useGT, useMessages } from "gt-react-native";
import type { ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import { useResolveClassNames } from "uniwind";

import { AppText as Text } from "./components/ui/AppText";
import { androidWorkspaceDestinationAnimation } from "./lib/android-workspace-navigation";
import { lazyScreen } from "./lib/lazyScreen";
import { getCompactBrandHeaderOptions } from "./features/layout/workspace/brand-header-options";
import { WorkspaceConnectionStatusProvider } from "./features/home/WorkspaceConnectionTitle";
import { WorkspaceRootScreen } from "./features/layout/workspace/WorkspaceRootScreen";
import {
  recordHomeFocus,
  recordHomeTransitionEnd,
  recordHomeTransitionStart,
} from "./features/home/home-route-visibility";
import { AndroidWorkspaceTabsProvider } from "./features/layout/workspace/AndroidWorkspaceTabsProvider";
import {
  RenderErrorBoundary,
  RenderFailureView,
  type RenderFailureProps,
} from "./components/RenderErrorBoundary";
import { AttachmentFileScreen } from "./features/files/AttachmentFileScreen";
import { AdaptiveWorkspaceLayout } from "./features/layout/AdaptiveWorkspaceLayout";
import {
  HardwareKeyboardCommandOverlay,
  HardwareKeyboardCommandProvider,
} from "./features/keyboard/HardwareKeyboardCommandProvider";
import { ReviewCommentComposerSheet } from "./features/review/ReviewCommentComposerSheet";
import { ReviewSheet } from "./features/review/ReviewSheet";
import { GitBranchesSheet } from "./features/threads/git/GitBranchesSheet";
import { GitCommitSheet } from "./features/threads/git/GitCommitSheet";
import { GitConfirmSheet } from "./features/threads/git/GitConfirmSheet";
import { GitOverviewSheet } from "./features/threads/git/GitOverviewSheet";
import { ThreadAgentsSheet } from "./features/threads/ThreadAgentsSheet";
import { ThreadBackgroundWorkSheet } from "./features/threads/ThreadBackgroundWorkSheet";
import { ThreadQueueSheet } from "./features/threads/ThreadQueueControl";
import {
  FullscreenThreadRouteScreen,
  ThreadRouteScreen,
} from "./features/threads/ThreadRouteScreen";
import { ConnectionsRouteScreen } from "./features/connection/ConnectionsRouteScreen";
import { ConnectionsNewRouteScreen } from "./features/connection/ConnectionsNewRouteScreen";
import {
  NewTaskBranchPickerRouteScreen,
  NewTaskEnvironmentPickerRouteScreen,
} from "./features/threads/NewTaskContextPickerScreens";
import {
  ExistingThreadSettingsRouteScreen,
  NewTaskThreadSettingsRouteScreen,
} from "./features/threads/ThreadSettingsSheet";
import { NewTaskFlowProvider } from "./features/threads/new-task-flow-provider";
import { newTaskFlowKey } from "./features/threads/new-task-flow-state";
import { NewTaskRouteScreen } from "./features/threads/NewTaskRouteScreen";
import { SettingsRouteScreen } from "./features/settings/SettingsRouteScreen";
import { SettingsEnvironmentFilterProvider } from "./features/settings/settings-environment-filter";
import { openSettings, settingsOpenIn } from "./features/settings/settings-navigation";
import { DEFAULT_SETTINGS_PAGE } from "./features/layout/workspace/workspace-tab-navigation";
import {
  isWorkspaceOverlayRoute,
  registerPresentedRoutes,
} from "./features/layout/workspace-overlay-routes";
import { ShowcaseReadyMarker } from "./features/showcase/ShowcaseCaptureCoordinator";
import { immersiveRoute, modalRoute, pageRoute, sheetRoute } from "./features/layout/route-options";
import { deriveLayout } from "./lib/layout";
import { useNativeLayoutMetrics } from "./native/native-layout-metrics";
import { isPresentedRoute } from "./native/workspace-stack-projection";
import { workspaceDetailRouter } from "./features/layout/workspace/workspace-detail-selection";

const ComponentCatalogScreen = lazyScreen(() =>
  import("./features/development/ComponentCatalogScreen").then((m) => ({
    default: m.ComponentCatalogScreen,
  })),
);
const PullRequestRouteScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestRouteScreen").then((m) => ({
    default: m.PullRequestRouteScreen,
  })),
);
const PullRequestFileRouteScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestRouteScreen").then((m) => ({
    default: m.PullRequestFileRouteScreen,
  })),
);
const PullRequestGuideStopScreen = lazyScreen(() =>
  import("./features/pull-requests/guide/PullRequestGuideScreen").then((m) => ({
    default: m.PullRequestGuideStopScreen,
  })),
);
const PullRequestFilesSheet = lazyScreen(() =>
  import("./features/pull-requests/PullRequestFiles").then((m) => ({
    default: m.PullRequestFilesSheet,
  })),
);
const PullRequestReviewSheet = lazyScreen(() =>
  import("./features/pull-requests/PullRequestReviewSheet").then((m) => ({
    default: m.PullRequestReviewSheet,
  })),
);
const PullRequestReviewersScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestReviewersScreen").then((m) => ({
    default: m.PullRequestReviewersScreen,
  })),
);
const PullRequestLabelsScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestLabelsScreen").then((m) => ({
    default: m.PullRequestLabelsScreen,
  })),
);
const PullRequestEditScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestEditScreen").then((m) => ({
    default: m.PullRequestEditScreen,
  })),
);
const PullRequestFilterSearchScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestFilterSearchScreen").then((m) => ({
    default: m.PullRequestFilterSearchScreen,
  })),
);
const PullRequestDiscussionScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestDiscussionScreen").then((m) => ({
    default: m.PullRequestDiscussionScreen,
  })),
);
const PullRequestInlineCommentScreen = lazyScreen(() =>
  import("./features/pull-requests/PullRequestInlineCommentScreen").then((m) => ({
    default: m.PullRequestInlineCommentScreen,
  })),
);
const IssueRouteScreen = lazyScreen(() =>
  import("./features/issues/IssueRouteScreen").then((m) => ({ default: m.IssueRouteScreen })),
);
const IssueEditScreen = lazyScreen(() =>
  import("./features/issues/IssueEditScreen").then((m) => ({ default: m.IssueEditScreen })),
);
const IssueLabelsScreen = lazyScreen(() =>
  import("./features/issues/IssueLabelsScreen").then((m) => ({ default: m.IssueLabelsScreen })),
);
const IssueAssigneesScreen = lazyScreen(() =>
  import("./features/issues/IssueAssigneesScreen").then((m) => ({
    default: m.IssueAssigneesScreen,
  })),
);
const IssueFilterSearchScreen = lazyScreen(() =>
  import("./features/issues/IssueFilterSearchScreen").then((m) => ({
    default: m.IssueFilterSearchScreen,
  })),
);
const ArchivedThreadsRouteScreen = lazyScreen(() =>
  import("./features/archive/ArchivedThreadsRouteScreen").then((m) => ({
    default: m.ArchivedThreadsRouteScreen,
  })),
);
const ConnectOnboardingRouteScreen = lazyScreen(() =>
  import("./features/cloud/ConnectOnboardingRouteScreen").then((m) => ({
    default: m.ConnectOnboardingRouteScreen,
  })),
);
const ThreadFilesTreeScreen = lazyScreen(() =>
  import("./features/files/ThreadFilesRouteScreen").then((m) => ({
    default: m.ThreadFilesTreeScreen,
  })),
);
const ThreadFileScreen = lazyScreen(() =>
  import("./features/files/ThreadFilesRouteScreen").then((m) => ({ default: m.ThreadFileScreen })),
);
const ThreadTerminalRouteScreen = lazyScreen(() =>
  import("./features/terminal/ThreadTerminalRouteScreen").then((m) => ({
    default: m.ThreadTerminalRouteScreen,
  })),
);
const DevicePreviewRouteScreen = lazyScreen(() =>
  import("./features/devices/DevicePreviewRouteScreen").then((m) => ({
    default: m.DevicePreviewRouteScreen,
  })),
);
const BrowserPreviewRouteScreen = lazyScreen(() =>
  import("./features/browser/BrowserPreviewRouteScreen").then((m) => ({
    default: m.BrowserPreviewRouteScreen,
  })),
);
const McpAppFullscreenScreen = lazyScreen(() =>
  import("./features/threads/McpAppFullscreenScreen").then((m) => ({
    default: m.McpAppFullscreenScreen,
  })),
);
const ThreadGuestShareSheet = lazyScreen(() =>
  import("./features/threads/ThreadGuestShareSheet").then((m) => ({
    default: m.ThreadGuestShareSheet,
  })),
);
const ThreadPullRequestsSheet = lazyScreen(() =>
  import("./features/threads/ThreadPullRequestsSheet").then((m) => ({
    default: m.ThreadPullRequestsSheet,
  })),
);
const AddProjectSourceRoute = lazyScreen(() =>
  import("./features/projects/AddProjectSourceRoute").then((m) => ({
    default: m.AddProjectSourceRoute,
  })),
);
const AddProjectRepositoryRoute = lazyScreen(() =>
  import("./features/projects/AddProjectRepositoryRoute").then((m) => ({
    default: m.AddProjectRepositoryRoute,
  })),
);
const AddProjectDestinationRoute = lazyScreen(() =>
  import("./features/projects/AddProjectDestinationRoute").then((m) => ({
    default: m.AddProjectDestinationRoute,
  })),
);
const AddProjectLocalRoute = lazyScreen(() =>
  import("./features/projects/AddProjectLocalRoute").then((m) => ({
    default: m.AddProjectLocalRoute,
  })),
);
const AddProjectNewRoute = lazyScreen(() =>
  import("./features/projects/AddProjectNewRoute").then((m) => ({ default: m.AddProjectNewRoute })),
);
const SettingsNavigationRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsNavigationRouteScreen").then((m) => ({
    default: m.SettingsNavigationRouteScreen,
  })),
);
const SettingsAppearanceRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsAppearanceRouteScreen").then((m) => ({
    default: m.SettingsAppearanceRouteScreen,
  })),
);
const SettingsClientStorageRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsClientStorageRouteScreen").then((m) => ({
    default: m.SettingsClientStorageRouteScreen,
  })),
);
const SettingsDiagnosticsRouteScreen = lazyScreen(() =>
  import("./features/diagnostics/SettingsDiagnosticsRouteScreen").then((m) => ({
    default: m.SettingsDiagnosticsRouteScreen,
  })),
);
const SettingsProviderAccountsRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsProviderAccountsRouteScreen").then((m) => ({
    default: m.SettingsProviderAccountsRouteScreen,
  })),
);
const SettingsAuthRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsAuthRouteScreen").then((m) => ({
    default: m.SettingsAuthRouteScreen,
  })),
);
const SettingsEnvironmentDetailRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsEnvironmentDetailRouteScreen").then((m) => ({
    default: m.SettingsEnvironmentDetailRouteScreen,
  })),
);
const SettingsIssueTrackerRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsSourceControlDetailRouteScreens").then((m) => ({
    default: m.SettingsIssueTrackerRouteScreen,
  })),
);
const SettingsSourceControlProviderRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsSourceControlDetailRouteScreens").then((m) => ({
    default: m.SettingsSourceControlProviderRouteScreen,
  })),
);
const SettingsEnvironmentsRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsEnvironmentsRouteScreen").then((m) => ({
    default: m.SettingsEnvironmentsRouteScreen,
  })),
);
const SettingsFollowUpRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsFollowUpRouteScreen").then((m) => ({
    default: m.SettingsFollowUpRouteScreen,
  })),
);
const SettingsLanguageRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsLanguageRouteScreen").then((m) => ({
    default: m.SettingsLanguageRouteScreen,
  })),
);
const SettingsEnvironmentMaintenanceRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsServerControlsRouteScreen").then((m) => ({
    default: m.SettingsEnvironmentMaintenanceRouteScreen,
  })),
);
const SettingsThreadsRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsServerControlsRouteScreen").then((m) => ({
    default: m.SettingsThreadsRouteScreen,
  })),
);
const SettingsWorktreesRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsServerControlsRouteScreen").then((m) => ({
    default: m.SettingsWorktreesRouteScreen,
  })),
);
const SettingsEnvironmentSourceControlRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsServerControlsRouteScreen").then((m) => ({
    default: m.SettingsEnvironmentSourceControlRouteScreen,
  })),
);
const SettingsScheduledTasksRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsScheduledTasksRouteScreen").then((m) => ({
    default: m.SettingsScheduledTasksRouteScreen,
  })),
);
const SettingsScheduledTaskNewRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsScheduledTasksRouteScreen").then((m) => ({
    default: m.SettingsScheduledTaskNewRouteScreen,
  })),
);
const SettingsScheduledTaskEditRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsScheduledTasksRouteScreen").then((m) => ({
    default: m.SettingsScheduledTaskEditRouteScreen,
  })),
);
const ScheduledTaskModelPickerRouteScreen = lazyScreen(() =>
  import("./features/settings/ScheduledTaskPickerScreens").then((m) => ({
    default: m.ScheduledTaskModelPickerRouteScreen,
  })),
);
const ScheduledTaskBranchPickerRouteScreen = lazyScreen(() =>
  import("./features/settings/ScheduledTaskPickerScreens").then((m) => ({
    default: m.ScheduledTaskBranchPickerRouteScreen,
  })),
);
const ScheduledTaskThreadPickerRouteScreen = lazyScreen(() =>
  import("./features/settings/ScheduledTaskPickerScreens").then((m) => ({
    default: m.ScheduledTaskThreadPickerRouteScreen,
  })),
);
const SettingsKeyboardRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsKeyboardRouteScreen").then((m) => ({
    default: m.SettingsKeyboardRouteScreen,
  })),
);
const SettingsLegalRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsLegalRouteScreen").then((m) => ({
    default: m.SettingsLegalRouteScreen,
  })),
);
const SettingsVoiceRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsVoiceRouteScreen").then((m) => ({
    default: m.SettingsVoiceRouteScreen,
  })),
);
const SettingsVoiceModelsRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsVoiceModelsRouteScreen").then((m) => ({
    default: m.SettingsVoiceModelsRouteScreen,
  })),
);
const SettingsOpenSourceLicenseRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsOpenSourceLicensesRouteScreen").then((m) => ({
    default: m.SettingsOpenSourceLicenseRouteScreen,
  })),
);
const SettingsOpenSourceLicensesRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsOpenSourceLicensesRouteScreen").then((m) => ({
    default: m.SettingsOpenSourceLicensesRouteScreen,
  })),
);
const SettingsProjectGroupingRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsProjectGroupingRouteScreen").then((m) => ({
    default: m.SettingsProjectGroupingRouteScreen,
  })),
);
const SettingsProjectOverviewRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsProjectOverviewRouteScreen").then((m) => ({
    default: m.SettingsProjectOverviewRouteScreen,
  })),
);
const UsageLimitAccountScreen = lazyScreen(() =>
  import("./features/usage/UsageLimitsPooled").then((m) => ({
    default: m.UsageLimitAccountScreen,
  })),
);
const UsageRouteScreen = lazyScreen(() =>
  import("./features/usage/UsageRouteScreen").then((m) => ({ default: m.UsageRouteScreen })),
);
const SettingsAboutRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsAboutRouteScreen").then((m) => ({
    default: m.SettingsAboutRouteScreen,
  })),
);
const SettingsNotificationsRouteScreen = lazyScreen(() =>
  import("./features/settings/SettingsNotificationsRouteScreen").then((m) => ({
    default: m.SettingsNotificationsRouteScreen,
  })),
);
const SettingsLabsRouteScreen = lazyScreen(() =>
  import("./features/settings/ThreadSettingsSections").then((m) => ({
    default: m.SettingsLabsRouteScreen,
  })),
);

const settingsPage = () => pageRoute({ itemStyle: "standard" });

const { title: _compactBrandTitle, ...compactBrandHeaderOptions } = getCompactBrandHeaderOptions();

// Resolved in the rendered Navigator's screenOptions so each header title follows the UI language;
// route options stay plain objects because registerPresentedRoutes reads them at load.
const ROUTE_TITLES: Readonly<Record<string, string>> = {
  Settings: msg("Settings"),
  SettingsEnvironments: msg("Environments"),
  SettingsEnvironmentDetail: msg("Environment"),
  SettingsEnvironmentNewThreads: msg("Threads"),
  SettingsEnvironmentSourceControl: msg("Source control & issues"),
  SettingsSourceControlProvider: msg("Provider", {
    $context: "settings page of one source control provider",
  }),
  SettingsIssueTracker: msg("Issue tracker"),
  SettingsEnvironmentAgentBehavior: msg("Threads"),
  SettingsWorktrees: msg("Worktrees"),
  SettingsLabs: msg("Labs"),
  SettingsProviderAccounts: msg("Providers"),
  SettingsEnvironmentMaintenance: msg("Maintenance"),
  SettingsNotifications: msg("Notifications"),
  SettingsThreads: msg("Threads"),
  SettingsAbout: msg("About"),
  SettingsEnvironmentNew: msg("Add Environment"),
  SettingsArchive: msg("Archive", { $context: "noun, settings page of archived threads" }),
  SettingsNavigation: msg("Navigation tabs"),
  SettingsAppearance: msg("Appearance"),
  SettingsProjectGrouping: msg("General"),
  SettingsOrganization: msg("General"),
  SettingsLanguage: msg("Language"),
  SettingsProjectOverview: msg("Projects"),
  SettingsKeyboard: msg("Keyboard"),
  SettingsVoice: msg("Voice"),
  SettingsFollowUp: msg("Chat", { $context: "noun, settings page title" }),
  SettingsScheduledTasks: msg("Scheduled tasks"),
  SettingsScheduledTaskNew: msg("New scheduled task"),
  SettingsScheduledTaskEdit: msg("Edit scheduled task"),
  SettingsScheduledTaskBranch: msg("Base branch"),
  SettingsScheduledTaskThread: msg("Destination"),
  SettingsClientStorage: msg("Client Storage"),
  SettingsDiagnostics: msg("Diagnostics"),
  SettingsUsageAccount: msg("Account"),
  SettingsOpenSourceLicenses: msg("Open source licenses"),
  SettingsOpenSourceLicense: msg("License notice"),
  SettingsUsage: msg("Usage"),
  ComponentCatalog: msg("UI components"),
  NewTaskProject: msg("Choose project"),
  NewTaskEnvironment: msg("Environment"),
  NewTaskBranch: msg("Branch"),
  AddProject: msg("Add project"),
  ThreadFiles: msg("Files"),
  SettingsLegal: msg("Legal"),
  ConnectOnboarding: msg("Set up {product}", { product: "T3 Connect" }),
  Connections: msg("Environments"),
  ConnectionsNew: msg("Add Environment"),
};

// Thread settings keep the Duo's vertical bar so cancel, search, filter and confirm sit in the
// rail. The picker stack spans the sheet so its header reaches the rail, and insets its content.
const THREAD_SETTINGS_ROUTE = sheetRoute({
  detent: "full",
  header: "none",
  android: "card",
  spansRail: true,
});

// Search sheets push on Android like the branch picker; a formSheet there leaves the list's
// header peeking above it once the keyboard opens.
const SEARCH_SHEET_ROUTE = sheetRoute({ detent: 0.75, android: "card", itemStyle: "editor" });

const SETTINGS_SCREENS = {
  Settings: createNativeStackScreen({
    screen: SettingsRouteScreen,
    linking: "settings",
    options: {
      ...pageRoute({ itemStyle: "standard", root: true }),
      ...(Platform.OS === "android" ? { animation: "none" as const } : {}),
    },
  }),
  SettingsEnvironments: createNativeStackScreen({
    screen: SettingsEnvironmentsRouteScreen,
    linking: "settings/environments",
    options: settingsPage(),
  }),
  SettingsEnvironmentDetail: createNativeStackScreen({
    screen: SettingsEnvironmentDetailRouteScreen,
    linking: "settings/environments/:environmentId",
    options: settingsPage(),
  }),
  // Old links to New threads and Agent behavior open Threads, which absorbed them.
  SettingsEnvironmentNewThreads: createNativeStackScreen({
    screen: SettingsThreadsRouteScreen,
    linking: "settings/new-threads",
    options: settingsPage(),
  }),
  SettingsEnvironmentSourceControl: createNativeStackScreen({
    screen: SettingsEnvironmentSourceControlRouteScreen,
    linking: "settings/source-control",
    options: settingsPage(),
  }),
  SettingsSourceControlProvider: createNativeStackScreen({
    screen: SettingsSourceControlProviderRouteScreen,
    options: settingsPage(),
  }),
  SettingsIssueTracker: createNativeStackScreen({
    screen: SettingsIssueTrackerRouteScreen,
    options: settingsPage(),
  }),
  SettingsEnvironmentAgentBehavior: createNativeStackScreen({
    screen: SettingsThreadsRouteScreen,
    linking: "settings/agent-behavior",
    options: settingsPage(),
  }),
  SettingsWorktrees: createNativeStackScreen({
    screen: SettingsWorktreesRouteScreen,
    linking: "settings/worktrees",
    options: settingsPage(),
  }),
  SettingsLabs: createNativeStackScreen({
    screen: SettingsLabsRouteScreen,
    linking: "settings/labs",
    options: settingsPage(),
  }),
  SettingsProviderAccounts: createNativeStackScreen({
    screen: SettingsProviderAccountsRouteScreen,
    linking: "settings/provider-accounts",
    options: settingsPage(),
  }),
  SettingsEnvironmentMaintenance: createNativeStackScreen({
    screen: SettingsEnvironmentMaintenanceRouteScreen,
    linking: "settings/maintenance",
    options: settingsPage(),
  }),
  SettingsNotifications: createNativeStackScreen({
    screen: SettingsNotificationsRouteScreen,
    linking: "settings/notifications",
    options: settingsPage(),
  }),
  SettingsThreads: createNativeStackScreen({
    screen: SettingsThreadsRouteScreen,
    linking: "settings/thread-preferences",
    options: settingsPage(),
  }),
  SettingsAbout: createNativeStackScreen({
    screen: SettingsAboutRouteScreen,
    linking: "settings/about",
    options: settingsPage(),
  }),
  SettingsEnvironmentNew: createNativeStackScreen({
    screen: ConnectionsNewRouteScreen,
    linking: "settings/environment-new",
    options: settingsPage(),
  }),
  SettingsArchive: createNativeStackScreen({
    screen: ArchivedThreadsRouteScreen,
    linking: "settings/archive",
    options: settingsPage(),
  }),
  SettingsNavigation: createNativeStackScreen({
    screen: SettingsNavigationRouteScreen,
    linking: "settings/navigation-tabs",
    options: settingsPage(),
  }),
  SettingsAppearance: createNativeStackScreen({
    screen: SettingsAppearanceRouteScreen,
    linking: "settings/appearance",
    options: settingsPage(),
  }),
  SettingsProjectGrouping: createNativeStackScreen({
    screen: SettingsProjectGroupingRouteScreen,
    linking: "settings/project-grouping",
    options: settingsPage(),
  }),
  SettingsOrganization: createNativeStackScreen({
    screen: SettingsProjectGroupingRouteScreen,
    linking: "settings/organization",
    options: settingsPage(),
  }),
  SettingsLanguage: createNativeStackScreen({
    screen: SettingsLanguageRouteScreen,
    linking: "settings/language",
    options: settingsPage(),
  }),
  SettingsProjectOverview: createNativeStackScreen({
    screen: SettingsProjectOverviewRouteScreen,
    linking: "settings/project",
    options: settingsPage(),
  }),
  SettingsKeyboard: createNativeStackScreen({
    screen: SettingsKeyboardRouteScreen,
    linking: "settings/keyboard",
    options: settingsPage(),
  }),
  SettingsVoice: createNativeStackScreen({
    screen: SettingsVoiceRouteScreen,
    linking: { path: "settings/voice", alias: ["settings/microphone"] },
    options: settingsPage(),
  }),
  SettingsVoiceModels: createNativeStackScreen({
    screen: SettingsVoiceModelsRouteScreen,
    options: SEARCH_SHEET_ROUTE,
  }),
  SettingsFollowUp: createNativeStackScreen({
    screen: SettingsFollowUpRouteScreen,
    linking: "settings/follow-ups",
    options: settingsPage(),
  }),
  SettingsScheduledTasks: createNativeStackScreen({
    screen: SettingsScheduledTasksRouteScreen,
    linking: "settings/scheduled-tasks",
    options: {
      ...settingsPage(),
      headerTitleStyle: { fontSize: 16, fontWeight: "800" },
    },
  }),
  SettingsScheduledTaskNew: createNativeStackScreen({
    screen: SettingsScheduledTaskNewRouteScreen,
    linking: "settings/scheduled-tasks/new",
    options: settingsPage(),
  }),
  SettingsScheduledTaskEdit: createNativeStackScreen({
    screen: SettingsScheduledTaskEditRouteScreen,
    options: settingsPage(),
  }),
  SettingsScheduledTaskBranch: createNativeStackScreen({
    screen: ScheduledTaskBranchPickerRouteScreen,
    options: settingsPage(),
  }),
  SettingsScheduledTaskThread: createNativeStackScreen({
    screen: ScheduledTaskThreadPickerRouteScreen,
    options: settingsPage(),
  }),
  SettingsScheduledTaskModel: createNativeStackScreen({
    screen: ScheduledTaskModelPickerRouteScreen,
    options: THREAD_SETTINGS_ROUTE,
  }),
  SettingsClientStorage: createNativeStackScreen({
    screen: SettingsClientStorageRouteScreen,
    linking: "settings/client-storage",
    options: settingsPage(),
  }),
  SettingsDiagnostics: createNativeStackScreen({
    screen: SettingsDiagnosticsRouteScreen,
    linking: "settings/diagnostics",
    options: settingsPage(),
  }),
  // These params snapshot the tap time, local filters, and freshly aggregated pools.
  // A linking path would round-trip them as URL query strings and preserve stale values.
  SettingsUsageAccount: createNativeStackScreen({
    screen: UsageLimitAccountScreen,
    options: settingsPage(),
  }),
  SettingsOpenSourceLicenses: createNativeStackScreen({
    screen: SettingsOpenSourceLicensesRouteScreen,
    linking: "settings/open-source-licenses",
    options: settingsPage(),
  }),
  SettingsOpenSourceLicense: createNativeStackScreen({
    screen: SettingsOpenSourceLicenseRouteScreen,
    linking: "settings/open-source-licenses/:entryKey",
    options: settingsPage(),
  }),
  SettingsUsage: createNativeStackScreen({
    screen: UsageRouteScreen,
    linking: "settings/usage",
    options: settingsPage(),
  }),
  SettingsAuth: createNativeStackScreen({
    screen: SettingsAuthRouteScreen,
    linking: "settings/auth",
    options: { headerShown: false, presentation: "modal" },
  }),
  SettingsWaitlist: createNativeStackScreen({
    screen: SettingsAuthRouteScreen,
    linking: "settings/waitlist",
    options: { headerShown: false, presentation: "modal" },
  }),
};

// iOS 26 header morphing requires one UINavigationBar; nested stacks make the whole screen slide.
const THREAD_LINKING_PREFIX = "threads/:environmentId/:threadId";

export function workspaceLocationFromState(state: NavigationState) {
  const routes = state.routes.filter((route) => !isWorkspaceOverlayRoute(route.name));
  const effectiveState =
    routes.length > 0 && routes.length !== state.routes.length
      ? ({ ...state, routes, index: routes.length - 1 } as NavigationState)
      : state;
  const path = getPathFromState(effectiveState, navigationPathConfig);
  const route = effectiveState.routes[effectiveState.index];
  return {
    pathname: path.startsWith("/") ? path : `/${path}`,
    routeKey: route?.key,
    routeName: route?.name,
  };
}

export function rootPathnameFromState(state: NavigationState): string {
  const path = getPathFromState(state, navigationPathConfig);
  return path.startsWith("/") ? path : `/${path}`;
}

function RootStackLayout(props: {
  readonly children: React.ReactNode;
  readonly state: NavigationState;
}) {
  const pathname = rootPathnameFromState(props.state);
  const workspaceLocation = workspaceLocationFromState(props.state);
  const settingsOpen = settingsOpenIn(
    props.state.routes
      .slice(0, props.state.index + 1)
      .filter((route) => !isWorkspaceOverlayRoute(route.name)),
  );
  // The flow follows the draft route even while a pushed Thread covers it, so
  // its state lives exactly as long as the route.
  const draftRoute = props.state.routes.findLast(isDraftThreadRoute);
  const draftRouteOnTop =
    draftRoute !== undefined &&
    props.state.routes.findLast((route) => route.name === "Thread") === draftRoute;
  const draftParams = (
    draftRoute?.params as { draft?: { draftId?: string | string[] } } | undefined
  )?.draft;
  const routeDraftId = Array.isArray(draftParams?.draftId)
    ? draftParams.draftId[0]
    : draftParams?.draftId;

  return (
    <NewTaskFlowProvider
      active={draftRouteOnTop}
      flowKey={draftRoute === undefined ? undefined : newTaskFlowKey(draftRoute)}
      routeDraftId={routeDraftId}
    >
      <HardwareKeyboardCommandProvider pathname={pathname}>
        <ShowcaseReadyMarker />
        <SettingsEnvironmentFilterProvider open={settingsOpen}>
          <WorkspaceConnectionStatusProvider>
            <AndroidWorkspaceTabsProvider state={props.state}>
              <AdaptiveWorkspaceLayout
                pathname={workspaceLocation.pathname}
                workspaceRouteKey={workspaceLocation.routeKey}
                workspaceRouteName={workspaceLocation.routeName}
              >
                {props.children}
                <HardwareKeyboardCommandOverlay />
              </AdaptiveWorkspaceLayout>
            </AndroidWorkspaceTabsProvider>
          </WorkspaceConnectionStatusProvider>
        </SettingsEnvironmentFilterProvider>
      </HardwareKeyboardCommandProvider>
    </NewTaskFlowProvider>
  );
}

function NotFoundScreen() {
  const navigation = useNavigation();
  const screenBgStyle = StyleSheet.flatten(useResolveClassNames("bg-screen"));
  const primaryBgStyle = StyleSheet.flatten(useResolveClassNames("bg-primary"));
  const returnHomeButtonStyle = StyleSheet.flatten([
    {
      borderRadius: 999,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    primaryBgStyle,
  ]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        paddingHorizontal: 24,
        paddingVertical: 32,
      }}
      style={[{ flex: 1 }, screenBgStyle]}
    >
      <Text className="text-3xl font-t3-bold text-foreground" selectable>
        <T>Route not found</T>
      </Text>
      <Pressable
        style={returnHomeButtonStyle}
        onPress={() => navigation.dispatch(StackActions.replace("Home"))}
      >
        <Text className="text-base font-t3-bold text-primary-foreground">
          <T>Return home</T>
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const RootStackConfig = createWorkspaceStackNavigator({
  initialRouteName: "Home",
  UNSTABLE_router: workspaceDetailRouter,
  // React Navigation calls layouts inline; compiled components would share the navigator's memo cache.
  layout: (props) => <RootStackLayout {...props} />,
  screenOptions: { headerShown: false },
  screens: {
    ...(__DEV__
      ? {
          ComponentCatalog: createNativeStackScreen({
            screen: ComponentCatalogScreen,
            linking: "dev/components",
          }),
        }
      : {}),
    Home: createNativeStackScreen({
      screen: WorkspaceRootScreen,
      linking: "",
      listeners: ({ navigation }) => ({
        transitionStart: ({ data }) => recordHomeTransitionStart(data.closing),
        transitionEnd: ({ data }) => recordHomeTransitionEnd(data.closing, navigation.isFocused()),
        focus: recordHomeFocus,
      }),
      options: {
        ...pageRoute({ duoMinimize: "never", root: true }),
        contentStyle: { backgroundColor: "transparent" },
        ...compactBrandHeaderOptions,
      },
    }),
    PullRequest: createNativeStackScreen({
      screen: PullRequestRouteScreen,
      linking: {
        path: "pull-requests/:environmentId/:projectId/:repository/:number",
        parse: { number: Number },
      },
      options: pageRoute({ duoMinimize: "never" }),
    }),
    PullRequestGuideStop: createNativeStackScreen({
      screen: PullRequestGuideStopScreen,
      options: pageRoute(),
    }),
    PullRequestFile: createNativeStackScreen({
      screen: PullRequestFileRouteScreen,
      options: pageRoute(),
    }),
    PullRequestFiles: createNativeStackScreen({
      screen: PullRequestFilesSheet,
      options: sheetRoute({ detent: 0.6 }),
    }),
    PullRequestReviewers: createNativeStackScreen({
      screen: PullRequestReviewersScreen,
      options: sheetRoute({ detent: 0.75, itemStyle: "editor", duoMinimize: "never" }),
    }),
    PullRequestLabels: createNativeStackScreen({
      screen: PullRequestLabelsScreen,
      options: SEARCH_SHEET_ROUTE,
    }),
    PullRequestFilterSearch: createNativeStackScreen({
      screen: PullRequestFilterSearchScreen,
      options: SEARCH_SHEET_ROUTE,
    }),
    PullRequestDiscussion: createNativeStackScreen({
      screen: PullRequestDiscussionScreen,
      options: pageRoute(),
    }),
    PullRequestInlineComment: createNativeStackScreen({
      screen: PullRequestInlineCommentScreen,
      options: sheetRoute({ detent: 0.75, android: "fullScreen" }),
    }),
    PullRequestReview: createNativeStackScreen({
      screen: PullRequestReviewSheet,
      options: sheetRoute({ detent: 0.75, androidFit: true }),
    }),
    PullRequestEdit: createNativeStackScreen({
      screen: PullRequestEditScreen,
      options: sheetRoute({ detent: 0.75, androidFit: true }),
    }),
    Issue: createNativeStackScreen({
      screen: IssueRouteScreen,
      linking: "issues/:environmentId/:projectId/:tracker/:scope/:issueKey",
      options: pageRoute({ duoMinimize: "never" }),
    }),
    IssueEdit: createNativeStackScreen({
      screen: IssueEditScreen,
      options: sheetRoute({ detent: 0.75, androidFit: true }),
    }),
    IssueLabels: createNativeStackScreen({
      screen: IssueLabelsScreen,
      options: SEARCH_SHEET_ROUTE,
    }),
    IssueAssignees: createNativeStackScreen({
      screen: IssueAssigneesScreen,
      options: SEARCH_SHEET_ROUTE,
    }),
    IssueFilterSearch: createNativeStackScreen({
      screen: IssueFilterSearchScreen,
      options: SEARCH_SHEET_ROUTE,
    }),
    Thread: createNativeStackScreen({
      screen: ThreadRouteScreen,
      linking: { path: "threads/:environmentId?/:threadId?", alias: ["new/draft"] },
      options: pageRoute({ duoMinimize: "onScrollUp" }),
    }),
    NewTaskProject: createNativeStackScreen({
      screen: NewTaskRouteScreen,
      linking: { path: "new", alias: ["new/project"] },
      options: pageRoute(),
    }),
    NewTaskEnvironment: createNativeStackScreen({
      linking: "new/draft/environment",
      screen: NewTaskEnvironmentPickerRouteScreen,
      options: pageRoute(),
    }),
    NewTaskBranch: createNativeStackScreen({
      linking: "new/draft/branch",
      screen: NewTaskBranchPickerRouteScreen,
      options: pageRoute(),
    }),
    AddProject: createNativeStackScreen({
      linking: "new/add-project",
      screen: AddProjectSourceRoute,

      options: pageRoute(),
    }),
    AddProjectRepository: createNativeStackScreen({
      linking: "new/add-project/repository",
      screen: AddProjectRepositoryRoute,
      options: pageRoute(),
    }),
    AddProjectDestination: createNativeStackScreen({
      linking: "new/add-project/destination",
      screen: AddProjectDestinationRoute,
      options: pageRoute(),
    }),
    AddProjectLocal: createNativeStackScreen({
      linking: "new/add-project/local",
      screen: AddProjectLocalRoute,
      options: pageRoute(),
    }),
    AddProjectNew: createNativeStackScreen({
      linking: "new/add-project/new",
      screen: AddProjectNewRoute,
      options: pageRoute(),
    }),
    NewTaskFiles: createNativeStackScreen({
      linking: "new/draft/files",
      screen: ThreadFilesTreeScreen,
      options: pageRoute({ header: "solid" }),
    }),
    NewTaskFile: createNativeStackScreen({
      linking: "new/draft/files/:path*",
      screen: ThreadFileScreen,
      options: pageRoute({ header: "solid" }),
    }),
    NewTaskAttachment: createNativeStackScreen({
      screen: AttachmentFileScreen,
      linking: "new/draft/attachments/:attachmentId",
      options: pageRoute({ header: "solid" }),
    }),
    NewTaskThreadSettings: createNativeStackScreen({
      screen: NewTaskThreadSettingsRouteScreen,
      linking: "new/draft/settings",
      options: THREAD_SETTINGS_ROUTE,
    }),
    ThreadTerminal: createNativeStackScreen({
      screen: ThreadTerminalRouteScreen,
      linking: `${THREAD_LINKING_PREFIX}/terminal`,
      options: pageRoute({ header: "solid" }),
    }),
    ThreadInspectorFullscreen: createNativeStackScreen({
      screen: FullscreenThreadRouteScreen,
      options: modalRoute({ header: "glass", itemStyle: "editor", duoMinimize: "onScrollUp" }),
    }),
    ThreadDevicePreview: createNativeStackScreen({
      screen: DevicePreviewRouteScreen,
      linking: `${THREAD_LINKING_PREFIX}/devices`,
      options: immersiveRoute({ hideSystemBars: true }),
    }),
    ThreadBrowserPreview: createNativeStackScreen({
      screen: BrowserPreviewRouteScreen,
      linking: `${THREAD_LINKING_PREFIX}/browser`,
      options: { ...modalRoute({ header: "solid" }), gestureEnabled: false },
    }),
    ThreadReview: createNativeStackScreen({
      screen: ReviewSheet,
      linking: `${THREAD_LINKING_PREFIX}/review`,
      options: pageRoute(),
    }),
    ThreadReviewComment: createNativeStackScreen({
      screen: ReviewCommentComposerSheet,
      linking: `${THREAD_LINKING_PREFIX}/review-comment`,
      options: sheetRoute({ detent: 0.55, android: "fullScreen" }),
    }),
    ThreadFiles: createNativeStackScreen({
      screen: ThreadFilesTreeScreen,
      linking: `${THREAD_LINKING_PREFIX}/files`,
      options: pageRoute(),
    }),
    ThreadFile: createNativeStackScreen({
      screen: ThreadFileScreen,
      linking: `${THREAD_LINKING_PREFIX}/files/:path*`,
      options: pageRoute(),
    }),
    ThreadMcpApp: createNativeStackScreen({
      screen: McpAppFullscreenScreen,
      linking: `${THREAD_LINKING_PREFIX}/apps/:itemId`,
      options: { ...modalRoute({ header: "solid" }), gestureEnabled: false },
    }),
    ThreadAttachment: createNativeStackScreen({
      screen: AttachmentFileScreen,
      linking: `${THREAD_LINKING_PREFIX}/attachments/:attachmentId`,
      options: pageRoute({ header: "solid" }),
    }),
    ThreadSettingsSheet: createNativeStackScreen({
      screen: ExistingThreadSettingsRouteScreen,
      options: THREAD_SETTINGS_ROUTE,
    }),
    ThreadQueue: createNativeStackScreen({
      screen: ThreadQueueSheet,
      options: sheetRoute({ detent: 0.65, androidMaxDetent: 0.95 }),
    }),
    ThreadBackgroundWork: createNativeStackScreen({
      screen: ThreadBackgroundWorkSheet,
      options: sheetRoute({ detent: 0.5, androidMaxDetent: 0.9 }),
    }),
    ThreadAgents: createNativeStackScreen({
      screen: ThreadAgentsSheet,
      options: sheetRoute({ detent: 0.5, androidMaxDetent: 0.9 }),
    }),
    ThreadGuestShare: createNativeStackScreen({
      screen: ThreadGuestShareSheet,
      options: sheetRoute({ detent: 0.5 }),
    }),
    GitOverview: createNativeStackScreen({
      screen: GitOverviewSheet,
      linking: `${THREAD_LINKING_PREFIX}/git`,
      options: sheetRoute({ detent: 0.55 }),
    }),
    ThreadPullRequests: createNativeStackScreen({
      screen: ThreadPullRequestsSheet,
      linking: `${THREAD_LINKING_PREFIX}/pull-requests`,
      options: sheetRoute({ detent: 0.55 }),
    }),
    GitCommit: createNativeStackScreen({
      screen: GitCommitSheet,
      linking: `${THREAD_LINKING_PREFIX}/git/commit`,
      options: sheetRoute({ detent: 0.8, androidFit: true }),
    }),
    GitBranches: createNativeStackScreen({
      screen: GitBranchesSheet,
      linking: `${THREAD_LINKING_PREFIX}/git/branches`,
      options: sheetRoute({ detent: 0.55, androidFit: true }),
    }),
    GitConfirm: createNativeStackScreen({
      screen: GitConfirmSheet,
      linking: `${THREAD_LINKING_PREFIX}/git-confirm`,
      options: sheetRoute({ detent: 0.55, maxDetent: 0.7, androidFit: true }),
    }),
    ...SETTINGS_SCREENS,
    SettingsLegal: createNativeStackScreen({
      screen: SettingsLegalRouteScreen,
      linking: "settings/legal",
      options: modalRoute({ header: "solid" }),
    }),
    ConnectOnboarding: createNativeStackScreen({
      screen: ConnectOnboardingRouteScreen,
      linking: "connect-onboarding",
      options: sheetRoute({
        header: "solid",
        detent: 0.6,
        androidMaxDetent: 0.95,
      }),
    }),
    Connections: createNativeStackScreen({
      screen: ConnectionsRouteScreen,
      linking: "connections",
      options: sheetRoute({ detent: 0.55, maxDetent: 0.7, android: "card" }),
    }),
    ConnectionsNew: createNativeStackScreen({
      screen: ConnectionsNewRouteScreen,
      linking: "connections/new",
      options: sheetRoute({ detent: 0.55, maxDetent: 0.7 }),
    }),
    NotFound: createNativeStackScreen({
      screen: NotFoundScreen,
      linking: "*",
    }),
  },
});

function GuardedScreenLayout(props: {
  readonly children: ReactNode;
  readonly route: { readonly name: string; readonly params?: object | undefined };
}) {
  return (
    <RenderErrorBoundary
      resetKeys={[props.route.params]}
      renderFallback={(fallback) => (
        <ScreenRenderFallback {...fallback} routeName={props.route.name} />
      )}
    >
      {props.children}
    </RenderErrorBoundary>
  );
}

function ScreenRenderFallback(props: RenderFailureProps & { readonly routeName: string }) {
  const navigation = useNavigation();
  const gt = useGT();
  const exit = navigation.canGoBack()
    ? { label: gt("Go back"), onPress: () => navigation.goBack() }
    : props.routeName === "Home"
      ? // Home itself failed, and the Settings list renders inside it; open a Settings page.
        {
          label: gt("Open settings"),
          onPress: () => openSettings(navigation, DEFAULT_SETTINGS_PAGE),
        }
      : {
          label: gt("Return home"),
          onPress: () => navigation.dispatch(StackActions.replace("Home")),
        };

  return <RenderFailureView {...props} exit={exit} />;
}

registerPresentedRoutes(
  Object.entries(RootStackConfig.config.screens ?? {}).flatMap(([name, screen]) => {
    const options = (screen as { readonly options?: unknown }).options;
    return options && typeof options === "object" && isPresentedRoute(options) ? [name] : [];
  }),
);

export const RootStack = RootStackConfig.with(function AdaptiveRootStack({ Navigator }) {
  const { width, height } = useWindowDimensions();
  const nativeMetrics = useNativeLayoutMetrics();
  const usesSplitView = deriveLayout({ width, height, nativeMetrics }).usesSplitView;
  const resolve = useMessages();

  /* oxlint-disable react/no-unstable-nested-components -- React Navigation invokes screenLayout as a render callback. */
  return (
    <Navigator
      screenLayout={(props) => <GuardedScreenLayout {...props} />}
      screenOptions={({ route, navigation }) => {
        const title =
          route.name === "Home"
            ? getCompactBrandHeaderOptions(undefined, resolve).title
            : ROUTE_TITLES[route.name] === undefined
              ? undefined
              : resolve(ROUTE_TITLES[route.name]);
        return {
          ...(title === undefined ? {} : { title }),
          ...(Platform.OS === "android"
            ? {
                animation: androidWorkspaceDestinationAnimation(
                  route,
                  navigation.getState().routes,
                  usesSplitView,
                ),
              }
            : {}),
        };
      }}
    />
  );

  /* oxlint-enable react/no-unstable-nested-components */
});

type RootStackType = typeof RootStack;

const navigationPathConfig = {
  screens: createPathConfigForStaticNavigation(RootStack) ?? {},
};

declare module "@react-navigation/native" {
  interface RootNavigator extends RootStackType {}
}
