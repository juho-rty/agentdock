import { useAtomValue } from "@effect/atom-react";
import { msg } from "gt-react-native";
import { AsyncResult } from "effect/reactivity";
import { Platform } from "react-native";
import {
  NAVIGATION_TAB_LABELS,
  navigationCustomizationAvailable,
  resolveHiddenNavigationTabs,
  enabledNavigationTabs,
  sharedSlotAbsentee,
  type NavigationTab,
} from "./navigation-tab-order";
import type { AppSymbolName } from "../../../components/ui/AppSymbol";
import { isMobileLiteBuild } from "../../../lib/liteMode";
import { mobilePreferencesAtom } from "../../../state/preferences";
import { PullRequestGlyph } from "../../pull-requests/pullRequestGlyphs";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { resolveWorkspaceTabOrder } from "./workspace-tabs-state";

export const WORKSPACE_TAB_LABELS = {
  ...NAVIGATION_TAB_LABELS,
  ...(Platform.OS === "ios"
    ? {
        threads: msg("Threads", { $context: "navigation tab, list of threads" }),
        pullRequests: msg("PRs", { $context: "navigation tab, pull requests" }),
      }
    : {}),
};

export const NAVIGATION_TAB_ICONS = {
  threads: "text.bubble",
  pullRequests: PullRequestGlyph.pullRequest,
  issues: "git.issue",
  usage: "chart.bar.xaxis",
} as const satisfies Readonly<Record<NavigationTab, AppSymbolName>>;

export function useNavigationTabOrder() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const saved = AsyncResult.isSuccess(preferences)
    ? preferences.value.navigationTabOrder
    : undefined;
  return resolveWorkspaceTabOrder(saved);
}

const LITE_DEFAULT_HIDDEN_TABS: readonly NavigationTab[] = ["pullRequests", "issues"];

export function useHiddenNavigationTabs() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const selected = useWorkspaceTabs()?.state.selectedTab ?? "threads";
  const saved = AsyncResult.isSuccess(preferences) ? preferences.value : undefined;
  const liteDefaultHidden =
    isMobileLiteBuild() && saved?.hiddenNavigationTabs === undefined
      ? LITE_DEFAULT_HIDDEN_TABS
      : [];
  return [
    ...liteDefaultHidden,
    ...(navigationCustomizationAvailable()
      ? resolveHiddenNavigationTabs(saved?.hiddenNavigationTabs)
      : []),
    sharedSlotAbsentee(selected, saved?.sharedSlotTab),
  ];
}

export function useEnabledNavigationTabs() {
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  return enabledNavigationTabs(order, hidden);
}
