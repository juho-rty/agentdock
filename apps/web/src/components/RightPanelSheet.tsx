import { T, useGT } from "gt-react";
import { ArrowLeftIcon } from "lucide-react";
import { type ReactNode } from "react";

import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "./ui/sheet";

export function RightPanelSheet(props: {
  animationDurationMs: number;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const gt = useGT();
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        transitionDurationMs={props.animationDurationMs}
        side="right"
        showCloseButton={false}
        keepMounted
        fullScreenOnPhone
        className="w-[min(42vw,28rem)] min-w-80 max-w-[28rem] max-[760px]:w-[min(88vw,24rem)] max-[760px]:min-w-0 max-sm:w-screen max-sm:max-w-none wco:mt-(--workspace-topbar-height) wco:h-[calc(100%-var(--workspace-topbar-height))] wco:max-h-[calc(100%-var(--workspace-topbar-height))]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            <T>Workspace panel</T>
          </SheetTitle>
        </SheetHeader>
        {/* A phone gives the panel the whole screen, so nothing is left to tap outside it. */}
        <button
          type="button"
          aria-label={gt("Back to the conversation")}
          onClick={props.onClose}
          className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border/60 px-4 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent sm:hidden"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          <T>Back</T>
        </button>
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
