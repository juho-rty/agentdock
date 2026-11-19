import type { ServerProvider, ServerProviderUsageWindow } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
} from "@t3tools/client-runtime/state/provider-instance-display";
import { paceOf, paceRemainingPercent, remainingPercent } from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { primaryServerProvidersAtom } from "../../state/server";
import { getProviderStatusKey, PROVIDER_STATUS_STYLES } from "../settings/providerStatus";
import { barColor, LimitWindows, PaceIcon, usePaceMark } from "../usage/UsageLimits";
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

const KIND_ORDER = ["session", "weekly", "monthly"] as const;

/**
 * The tightest window of each kind (session, weekly, monthly), so the row shows both the
 * short-term and the long-term limit. Providers that report only other kinds show their tightest.
 */
export function rowWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ServerProviderUsageWindow[] {
  const tightest = (candidates: ReadonlyArray<ServerProviderUsageWindow>) => {
    let found: ServerProviderUsageWindow | null = null;
    for (const window of candidates) {
      if (found === null || window.usedPercent > found.usedPercent) found = window;
    }
    return found;
  };
  const byKind = KIND_ORDER.flatMap((kind) => {
    const found = tightest(windows.filter((window) => window.kind === kind));
    return found ? [found] : [];
  });
  if (byKind.length > 0) return byKind;
  const other = tightest(windows);
  return other ? [other] : [];
}

function remainingTone(remaining: number) {
  return remaining <= 10
    ? "font-medium text-destructive"
    : remaining <= 25
      ? "font-medium text-warning"
      : "text-muted-foreground";
}

/** "5h", "7d", or the window's kind when its length is not a whole number of hours or days. */
export function usageWindowShortLabel(
  window: ServerProviderUsageWindow,
  gt: ReturnType<typeof useGT>,
): string {
  const minutes = window.windowDurationMins;
  return minutes !== undefined && minutes > 0 && minutes < 24 * 60 && minutes % 60 === 0
    ? `${minutes / 60}h`
    : minutes !== undefined && minutes >= 24 * 60 && minutes % (24 * 60) === 0
      ? `${minutes / (24 * 60)}d`
      : window.kind === "session"
        ? gt("Session", { $context: "usage limit window" })
        : window.kind === "weekly"
          ? gt("Weekly", { $context: "usage limit window" })
          : window.kind === "monthly"
            ? gt("Monthly", { $context: "usage limit window" })
            : window.label;
}

function WindowLine({
  window,
  now,
  color,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly color: string;
}) {
  const gt = useGT();
  const m = useMessages();
  const remaining = remainingPercent(window);
  const pace = paceOf(window, now);
  const timeLeft = paceRemainingPercent(window, now);
  const [barRef, paceMark] = usePaceMark(timeLeft);
  const resetsIn = formatResetsIn(window, now, m, "in");
  const label = usageWindowShortLabel(window, gt);
  return (
    <span className="flex w-full min-w-0 items-center gap-2 text-2xs tabular-nums">
      <span className="w-8 shrink-0 truncate text-muted-foreground">{label}</span>
      {/* The tick marks where even spending would leave the bar at this point in the window. */}
      <span ref={barRef} className="relative h-2.5 min-w-0 flex-1">
        <span className="absolute inset-0" style={paceMark?.gap}>
          <span className="absolute inset-x-0 inset-y-[3px] rounded-full bg-muted" />
          <span
            className="absolute inset-y-[3px] start-0 rounded-full"
            style={{ width: `${remaining}%`, backgroundColor: color }}
          />
        </span>
        {paceMark ? (
          <span
            aria-hidden
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground/80"
            style={paceMark.tick}
          />
        ) : null}
      </span>
      <span className={cn("w-8 shrink-0 text-end", remainingTone(remaining))}>{remaining}%</span>
      <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-muted-foreground">
        {pace ? <PaceIcon pace={pace} /> : null}
        {resetsIn ? <span className="truncate">{resetsIn}</span> : null}
      </span>
    </span>
  );
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
  const name = resolveProviderInstanceDisplayName(provider);
  const statusKey = getProviderStatusKey(provider);
  const windows = provider.usageLimits?.windows ?? [];
  const lines = rowWindows(windows);
  const color = normalizeProviderAccentColor(provider.accentColor) ?? barColor(provider.driver);

  let note: string | null = null;
  if (lines.length === 0) {
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
        {note ? <span className="ms-auto shrink-0 text-muted-foreground">{note}</span> : null}
      </span>
      {lines.map((window) => (
        <WindowLine key={window.id} window={window} now={now} color={color} />
      ))}
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
