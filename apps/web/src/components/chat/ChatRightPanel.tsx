import { useGT } from "gt-react";
import { ChevronLeftIcon } from "lucide-react";

import { usePreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";
import { RightPanelSheet } from "../RightPanelSheet";
import { RightPanelTabs, type RightPanelTabsProps } from "../RightPanelTabs";
import { Button } from "../ui/button";

type ChatRightPanelProps = Omit<
  RightPanelTabsProps,
  "mode" | "inlineSize" | "maximized" | "leadingControl"
> & {
  readonly sheet: boolean;
  readonly maximized: boolean;
  readonly workspaceLayoutElement: HTMLElement | null;
  readonly widthStorageKey: string;
  readonly sheetAnimationDurationMs: number;
  readonly onCloseSheet: () => void;
};

/**
 * The right panel, inline beside the chat column or as a sheet on narrow
 * layouts. Its width follows a resize drag every frame, so the width state
 * lives here rather than in ChatView.
 */
export function ChatRightPanel(props: ChatRightPanelProps) {
  const {
    sheet,
    workspaceLayoutElement,
    widthStorageKey,
    sheetAnimationDurationMs,
    onCloseSheet,
    maximized,
    layoutControls,
    ...tabs
  } = props;
  const gt = useGT();
  const inlineSize = usePreviewPanelInlineSize({
    container: workspaceLayoutElement,
    widthStorageKey,
  });
  if (!sheet) {
    return <RightPanelTabs {...tabs} mode="inline" maximized={maximized} inlineSize={inlineSize} />;
  }
  return (
    <RightPanelSheet
      animationDurationMs={sheetAnimationDurationMs}
      open={tabs.open === true}
      onClose={onCloseSheet}
    >
      <RightPanelTabs
        {...tabs}
        mode="sheet"
        inlineSize={inlineSize}
        layoutControls={layoutControls}
        // A phone gives the panel the whole screen, so nothing is left to tap outside it.
        // It stands where the conversation's own back control does.
        leadingControl={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-1 shrink-0 sm:hidden"
            aria-label={gt("Back to the conversation")}
            onClick={onCloseSheet}
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        }
      />
    </RightPanelSheet>
  );
}
