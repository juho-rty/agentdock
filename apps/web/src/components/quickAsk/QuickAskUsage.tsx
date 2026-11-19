import { useAtomValue } from "@effect/atom-react";
import {
  normalizeProviderAccentColor,
  resolveProviderInstanceDisplayName,
} from "@t3tools/client-runtime/state/provider-instance-display";
import type { ServerProvider } from "@t3tools/contracts";
import { remainingPercent } from "@t3tools/shared/usageLimits";
import { useGT } from "gt-react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { primaryServerProvidersAtom } from "../../state/server";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { rowWindows, usageWindowShortLabel } from "../sidebar/SidebarProviderUsage";
import { barColor } from "../usage/UsageLimits";

/** One line per agent: what is left of its short-term and long-term limits. */
export function QuickAskUsage({ onOpen }: { readonly onOpen: () => void }) {
  const gt = useGT();
  const providers = useAtomValue(primaryServerProvidersAtom);
  // Re-render each minute so a window that resets while the popover is open is not stale.
  useNowMinute();
  const rows = providers
    .filter((provider) => provider.enabled && provider.installed)
    .map((provider) => ({
      provider,
      windows: rowWindows(provider.usageLimits?.windows ?? []).slice(0, 2),
    }))
    .filter((row) => row.windows.length > 0);
  if (rows.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={gt("Usage")}
      className="flex w-full flex-col gap-1 border-t border-border px-3.5 py-2 text-left hover:bg-accent/60"
    >
      {rows.map((row) => (
        <QuickAskUsageRow
          key={row.provider.instanceId}
          provider={row.provider}
          windows={row.windows}
        />
      ))}
    </button>
  );
}

function QuickAskUsageRow({
  provider,
  windows,
}: {
  readonly provider: ServerProvider;
  readonly windows: ReturnType<typeof rowWindows>;
}) {
  const gt = useGT();
  const name = resolveProviderInstanceDisplayName(provider);
  const color = normalizeProviderAccentColor(provider.accentColor) ?? barColor(provider.driver);
  return (
    <span className="flex w-full min-w-0 items-center gap-2 text-2xs tabular-nums">
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-foreground">
        <ProviderInstanceIcon
          driverKind={provider.driver}
          displayName={name}
          accentColor={provider.accentColor}
          iconClassName="size-3"
        />
        <span className="truncate">{name}</span>
      </span>
      {windows.map((window) => {
        const remaining = remainingPercent(window);
        return (
          <span key={window.id} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="shrink-0 text-muted-foreground">
              {usageWindowShortLabel(window, gt)}
            </span>
            <span className="relative h-1 min-w-0 flex-1 rounded-full bg-muted">
              <span
                className="absolute inset-y-0 start-0 rounded-full"
                style={{ width: `${remaining}%`, backgroundColor: color }}
              />
            </span>
            <span
              className={cn(
                "w-7 shrink-0 text-end",
                remaining <= 10
                  ? "font-medium text-destructive"
                  : remaining <= 25
                    ? "font-medium text-warning"
                    : "text-muted-foreground",
              )}
            >
              {remaining}%
            </span>
          </span>
        );
      })}
    </span>
  );
}
