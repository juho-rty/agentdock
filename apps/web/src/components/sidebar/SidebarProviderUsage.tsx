import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
} from "@t3tools/client-runtime/state/provider-instance-display";
import { paceOf, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { primaryServerProvidersAtom } from "../../state/server";
import { getProviderStatusKey, PROVIDER_STATUS_STYLES } from "../settings/providerStatus";
import { barColor, LimitWindows, PaceIcon } from "../usage/UsageLimits";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useSidebar } from "../ui/sidebar";

const COLLAPSED_KEY = "agentdock:sidebar-provider-usage-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage is a convenience; the panel still works without it.
  }
}

/** The window closest to running out decides what the row shows. */
function tightestWindow(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ServerProviderUsageWindow | null {
  let tightest: ServerProviderUsageWindow | null = null;
  for (const window of windows) {
    if (tightest === null || window.usedPercent > tightest.usedPercent) tightest = window;
  }
  return tightest;
}

function ProviderUsageRow({
  provider,
  now,
  onOpen,
}: {
  readonly provider: ServerProvider;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const name = resolveProviderInstanceDisplayName(provider);
  const statusKey = getProviderStatusKey(provider);
  const windows = provider.usageLimits?.windows ?? [];
  const window = tightestWindow(windows);
  const remaining = window ? remainingPercent(window) : null;
  const pace = window ? paceOf(window, now) : null;
  const resetsIn = window ? formatResetsIn(window, now, m, "in") : null;
  const color = normalizeProviderAccentColor(provider.accentColor) ?? barColor(provider.driver);

  let note: string | null = null;
  if (!window) {
    if (provider.auth.status === "unauthenticated") note = gt("Sign in needed");
    else if (statusKey === "error") note = gt("Unavailable", { $context: "provider status" });
    else note = gt("No limits", { $context: "provider has no usage limits" });
  }

  const row = (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-start hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="flex w-full min-w-0 items-center gap-2 text-xs">
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_STYLES[statusKey].dot)}
        />
        <span className="truncate text-sidebar-foreground">{name}</span>
        <span
          className={cn(
            "ms-auto shrink-0 tabular-nums",
            remaining !== null && remaining <= 10
              ? "font-medium text-destructive"
              : remaining !== null && remaining <= 25
                ? "font-medium text-warning"
                : "text-muted-foreground",
          )}
        >
          {remaining !== null ? gt("{remaining}% left", { remaining }) : note}
        </span>
      </span>
      {window ? (
        <span className="flex w-full items-center gap-2">
          <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="absolute inset-y-0 start-0 rounded-full"
              style={{ width: `${remaining ?? 0}%`, backgroundColor: color }}
            />
          </span>
          <span className="flex shrink-0 items-center gap-1 text-2xs text-muted-foreground tabular-nums">
            {pace ? <PaceIcon pace={pace} /> : null}
            {resetsIn ? <span>{resetsIn}</span> : null}
          </span>
        </span>
      ) : null}
    </button>
  );

  if (windows.length === 0) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={row} />
      <TooltipPopup side="right" className="max-w-[28rem]">
        <div className="flex flex-col gap-1.5 py-0.5">
          <span className="text-xs font-medium">{name}</span>
          <LimitWindows
            driver={provider.driver}
            accentColor={provider.accentColor}
            windows={windows}
            now={now}
            compact
          />
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/** Every enabled agent's remaining quota, reset time and pace, at the foot of the sidebar. */
export function SidebarProviderUsage() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const minute = useNowMinute();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const now = Date.parse(`${minute}:00Z`);
  const visible = providers.filter((provider) => provider.enabled && provider.installed);
  if (visible.length === 0) return null;

  const openUsage = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/usage" });
  };
  const toggle = () => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };

  return (
    <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase hover:text-sidebar-foreground"
      >
        <span>{gt("Agent usage")}</span>
        <ChevronDownIcon
          aria-hidden
          className={cn("ms-auto size-3.5 transition-transform", collapsed && "-rotate-90")}
        />
      </button>
      {collapsed
        ? null
        : visible.map((provider) => (
            <ProviderUsageRow
              key={provider.instanceId}
              provider={provider}
              now={now}
              onOpen={openUsage}
            />
          ))}
    </div>
  );
}
