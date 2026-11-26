import { use, type ComponentProps } from "react";
import { View } from "react-native";

import { usePaneRole } from "../../components/ui/Pane";
import { useContentTopInset } from "../../components/ui/useBarInset";
import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import {
  useNativeColumnLayoutMetrics,
  useNativeLayoutMetrics,
} from "../../native/native-layout-metrics";
import { HomeIosOtaBanner } from "./HomeIosOtaBanner";
import { ThreadListFilters } from "./ThreadListFilters";

/**
 * The Agent | Chat switch and filters, pinned over both mode pages so it stays put while they
 * slide. Opaque from the screen top, so rows scrolling up stay hidden behind the nav bar too.
 */
export function HomePinnedFilters(
  props: Omit<ComponentProps<typeof ThreadListFilters>, "gutter"> & {
    readonly onHeightChange: (height: number) => void;
  },
) {
  const { onHeightChange, ...filters } = props;
  const primaryColumn = use(NativePrimaryColumnContext);
  const sidebarSurface = usePaneRole() === "sidebar" && primaryColumn !== null;
  const contentTopInset = useContentTopInset();
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const columnMetrics = useNativeColumnLayoutMetrics();
  const screenMetrics = useNativeLayoutMetrics();
  const contentSideInsets = usesNativeWorkspaceColumns
    ? (columnMetrics ?? screenMetrics)?.safeArea
    : undefined;
  const listGutter = sidebarSurface ? 8 : 0;
  return (
    <View
      className={sidebarSurface ? "bg-drawer" : "bg-screen"}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: contentTopInset,
        paddingLeft: (contentSideInsets?.left ?? 0) + listGutter,
        paddingRight: (contentSideInsets?.right ?? 0) + listGutter,
        zIndex: 2,
      }}
      onLayout={(event) =>
        onHeightChange(Math.ceil(event.nativeEvent.layout.height) - contentTopInset)
      }
    >
      <ThreadListFilters gutter={listGutter} {...filters} />
      <HomeIosOtaBanner />
    </View>
  );
}
