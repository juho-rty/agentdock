import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { Link, useLocation } from "@tanstack/react-router";
import { useGT } from "gt-react";
import {
  ChartColumnIcon,
  MessagesSquareIcon,
  SettingsIcon,
  SquarePenIcon,
  type LucideIcon,
} from "lucide-react";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";

import { openCommandPalette } from "../../commandPaletteBus";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { cn } from "../../lib/utils";
import { withoutChatProjects } from "../../sidebarThreadMode";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { usePullRequestsSupported } from "../../state/environments";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import {
  resolveMobileNewThreadProject,
  resolveMobileTab,
  type MobileTab,
} from "./MobileHome.logic";
import { useMobileHomeFilters } from "./useMobileHomeFilters";

const TAB_NEXT_VIEW_TRANSITION = { types: ["liquid-tab-next"] };
const TAB_PREVIOUS_VIEW_TRANSITION = { types: ["liquid-tab-previous"] };

/** Starts a draft in the home's filtered project, or the most recent one. */
function useMobileNewThread() {
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const { filters, projectOption } = useMobileHomeFilters();
  const handleNewThread = useNewThreadHandler();

  return () => {
    const openProjects = projects.filter((project) => project.archivedAt == null);
    const target = resolveMobileNewThreadProject({
      environmentId: filters.environmentId,
      projectOption,
      fallbackProjects: sortScopedProjectsForSidebar(
        withoutChatProjects(openProjects),
        threads,
        "updated_at",
      ),
    });
    if (target === null) {
      openCommandPalette({ open: openProjects.length === 0 ? "add-project" : "new-thread-in" });
      return;
    }
    void handleNewThread(scopeProjectRef(target.environmentId, target.id)).catch(() => {
      openCommandPalette({ open: "new-thread-in" });
    });
  };
}

function TabLink(props: {
  readonly to: "/" | "/pull-requests" | "/usage" | "/settings";
  readonly label: string;
  readonly active: boolean;
  readonly icon: LucideIcon;
  /** Which way the page slides in: `next` for a tab to the right of the current one. */
  readonly direction: "next" | "previous";
}) {
  const Icon = props.icon;
  return (
    <Link
      to={props.to}
      viewTransition={
        props.direction === "next" ? TAB_NEXT_VIEW_TRANSITION : TAB_PREVIOUS_VIEW_TRANSITION
      }
      aria-label={props.label}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "liquid-press relative flex h-10 min-w-0 flex-1 items-center justify-center rounded-full text-muted-foreground outline-none [--liquid-press-scale:0.9] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        props.active && "text-foreground",
      )}
    >
      <Icon aria-hidden className="size-5" strokeWidth={props.active ? 2.25 : 1.9} />
    </Link>
  );
}

export function MobileTabBarView(props: {
  readonly activeTab: MobileTab | null;
  readonly pullRequestsSupported: boolean;
  readonly onNewThread: () => void;
  /** `floating` overlays the page; `docked` takes its own row at the end of a column. */
  readonly variant: "floating" | "docked";
  /** Floating only: the page shrinks to end above the bar instead of scrolling under it. */
  readonly reserveSpace?: boolean;
}) {
  const gt = useGT();
  const tabs: ReadonlyArray<MobileTab> = props.pullRequestsSupported
    ? ["threads", "pullRequests", "usage", "settings"]
    : ["threads", "usage", "settings"];
  const activeIndex = props.activeTab === null ? -1 : tabs.indexOf(props.activeTab);
  const directionOf = (tab: MobileTab) =>
    tabs.indexOf(tab) > activeIndex ? ("next" as const) : ("previous" as const);
  return (
    <nav
      aria-label={gt("Main tabs")}
      data-mobile-tab-bar={props.reserveSpace ? "reserve" : "overlay"}
      // Named so the bar holds still while the pages slide past it between tabs.
      style={{ viewTransitionName: "mobile-tab-bar" }}
      className={cn(
        "pointer-events-none shrink-0 [-webkit-app-region:no-drag]",
        // A docked bar sits in a page that already ends above the home indicator.
        props.variant === "floating" ? "fixed inset-x-0 bottom-0 z-40 pb-safe" : "pt-1.5",
      )}
    >
      <div className="flex items-center gap-3 px-4 pb-2.5">
        <div className="liquid-glass pointer-events-auto relative flex h-12 min-w-0 flex-1 items-center gap-1 rounded-full px-1">
          {activeIndex < 0 ? null : (
            <span
              aria-hidden
              className="liquid-tab-indicator pointer-events-none absolute inset-y-0 left-1 my-auto h-10 rounded-full bg-foreground/[0.08]"
              style={{
                width: `calc((100% - 0.5rem - ${tabs.length - 1} * 0.25rem) / ${tabs.length})`,
                translate: `calc(${activeIndex} * (100% + 0.25rem)) 0`,
              }}
            />
          )}
          <TabLink
            to="/"
            label={gt("Threads")}
            active={props.activeTab === "threads"}
            icon={MessagesSquareIcon}
            direction={directionOf("threads")}
          />
          {props.pullRequestsSupported ? (
            <TabLink
              to="/pull-requests"
              label={gt("Pull requests")}
              active={props.activeTab === "pullRequests"}
              icon={PullRequestGlyph.pullRequest}
              direction={directionOf("pullRequests")}
            />
          ) : null}
          <TabLink
            to="/usage"
            label={gt("Usage")}
            active={props.activeTab === "usage"}
            icon={ChartColumnIcon}
            direction={directionOf("usage")}
          />
          <TabLink
            to="/settings"
            label={gt("Settings")}
            active={props.activeTab === "settings"}
            icon={SettingsIcon}
            direction={directionOf("settings")}
          />
        </div>
        <button
          type="button"
          aria-label={gt("New thread")}
          onClick={props.onNewThread}
          className="liquid-glass liquid-press pointer-events-auto flex size-12 shrink-0 items-center justify-center rounded-full text-foreground outline-none [--liquid-press-scale:0.92] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <SquarePenIcon aria-hidden className="size-5" />
        </button>
      </div>
    </nav>
  );
}

/** The phone tab bar for the current page; renders nothing on pages without a tab. */
export function MobileTabBar(props: { readonly variant: "floating" | "docked" }) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const pullRequestsSupported = usePullRequestsSupported();
  const onNewThread = useMobileNewThread();
  const activeTab = resolveMobileTab(pathname);
  if (activeTab === null) return null;
  return (
    <MobileTabBarView
      activeTab={activeTab}
      pullRequestsSupported={pullRequestsSupported}
      onNewThread={onNewThread}
      variant={props.variant}
      reserveSpace={activeTab !== "threads"}
    />
  );
}
