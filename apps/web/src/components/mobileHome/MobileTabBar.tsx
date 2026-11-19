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

const GLASS_CLASS =
  "border border-border/70 bg-popover/85 shadow-lg shadow-black/10 backdrop-blur-xl dark:shadow-black/40";

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
}) {
  const Icon = props.icon;
  return (
    <Link
      to={props.to}
      aria-label={props.label}
      aria-current={props.active ? "page" : undefined}
      className={cn(
        "flex h-11 min-w-0 flex-1 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent",
        props.active && "bg-foreground/[0.08] text-foreground",
      )}
    >
      <Icon aria-hidden className="size-5.5" strokeWidth={props.active ? 2.25 : 1.9} />
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
  return (
    <nav
      aria-label={gt("Main tabs")}
      data-mobile-tab-bar={props.reserveSpace ? "reserve" : "overlay"}
      className={cn(
        "pointer-events-none shrink-0 pb-safe [-webkit-app-region:no-drag]",
        props.variant === "floating" ? "fixed inset-x-0 bottom-0 z-40" : "pt-1.5",
      )}
    >
      <div className="flex items-center gap-3 px-4 pb-2.5">
        <div
          className={cn(
            "pointer-events-auto flex h-14 min-w-0 flex-1 items-center gap-1 rounded-full px-1.5",
            GLASS_CLASS,
          )}
        >
          <TabLink
            to="/"
            label={gt("Threads")}
            active={props.activeTab === "threads"}
            icon={MessagesSquareIcon}
          />
          {props.pullRequestsSupported ? (
            <TabLink
              to="/pull-requests"
              label={gt("Pull requests")}
              active={props.activeTab === "pullRequests"}
              icon={PullRequestGlyph.pullRequest}
            />
          ) : null}
          <TabLink
            to="/usage"
            label={gt("Usage")}
            active={props.activeTab === "usage"}
            icon={ChartColumnIcon}
          />
          <TabLink
            to="/settings"
            label={gt("Settings")}
            active={props.activeTab === "settings"}
            icon={SettingsIcon}
          />
        </div>
        <button
          type="button"
          aria-label={gt("New thread")}
          onClick={props.onNewThread}
          className={cn(
            "pointer-events-auto flex size-14 shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-95",
            GLASS_CLASS,
          )}
        >
          <SquarePenIcon aria-hidden className="size-5.5" />
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
