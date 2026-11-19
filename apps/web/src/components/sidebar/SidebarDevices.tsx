import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { MonitorSmartphoneIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { useVisibleThreadShells } from "../../state/entities";
import {
  useEnvironmentMachines,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "../ConnectionStatusDot";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { workingThreadCountByEnvironment } from "./SidebarDevices.logic";

function phaseLabel(phase: EnvironmentConnectionPhase, gt: ReturnType<typeof useGT>): string {
  switch (phase) {
    case "connected":
      return gt("Online", { $context: "a computer is connected" });
    case "connecting":
    case "reconnecting":
      return gt("Connecting…");
    case "error":
      return gt("Connection error");
    case "unsupported":
      return gt("Update needed", { $context: "a computer runs an incompatible app version" });
    case "available":
    case "offline":
      return gt("Offline", { $context: "a computer is not connected" });
  }
}

/**
 * One button in the sidebar's bottom row for every linked computer: its dot is green when all
 * are online, and the list (who is online, how many threads each is running) opens from it.
 */
export function SidebarDevices() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const machines = useEnvironmentMachines();
  const working = workingThreadCountByEnvironment(useVisibleThreadShells());
  const [open, setOpen] = useState(false);
  // A single computer is always this one; the list only helps once others are linked.
  if (environments.length < 2) return null;

  const openConnections = () => {
    setOpen(false);
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/settings/connections" });
  };

  const onlineCount = environments.filter(
    (environment) => environment.connection.phase === "connected",
  ).length;
  const summaryPhase: EnvironmentConnectionPhase =
    onlineCount === environments.length
      ? "connected"
      : environments.some(
            (environment) =>
              environment.connection.phase === "connecting" ||
              environment.connection.phase === "reconnecting",
          )
        ? "connecting"
        : environments.some((environment) => environment.connection.phase === "error")
          ? "error"
          : "offline";
  const label = gt("Computers ({online} of {total} online)", {
    online: onlineCount,
    total: environments.length,
  });

  return (
    <SidebarMenuItem className="shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <SidebarMenuButton aria-label={label} size="icon" className="relative">
                    <MonitorSmartphoneIcon />
                    <span
                      aria-hidden
                      className={cn(
                        "absolute end-1 top-1 size-1.5 rounded-full ring-2 ring-sidebar",
                        connectionPhaseDotClassName(summaryPhase),
                      )}
                    />
                  </SidebarMenuButton>
                }
              />
            }
          />
          {open ? null : <TooltipPopup side="top">{label}</TooltipPopup>}
        </Tooltip>
        <PopoverPopup side="top" align="start" padding="compact" width="sm">
          <div className="flex flex-col gap-0.5">
            <span className="px-2 py-0.5 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
              {gt("Computers")}
            </span>
            {environments.map((environment) => {
              const phase = environment.connection.phase;
              const online = phase === "connected";
              const workingCount = online ? (working.get(environment.environmentId) ?? 0) : 0;
              return (
                <button
                  key={environment.environmentId}
                  type="button"
                  onClick={openConnections}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-start text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ConnectionStatusDot
                    dotClassName={connectionPhaseDotClassName(phase)}
                    pingClassName={connectionPhasePingClassName(phase)}
                  />
                  <EnvironmentMachineIcon
                    kind={machines.get(environment.environmentId) ?? "server"}
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      online ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {environment.label}
                    {environment.environmentId === primaryEnvironmentId ? (
                      <span className="text-muted-foreground"> · {gt("This computer")}</span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-2xs tabular-nums",
                      workingCount > 0 ? "text-info" : "text-muted-foreground",
                    )}
                  >
                    {workingCount > 0
                      ? gt("{count} working", { count: workingCount })
                      : phaseLabel(phase, gt)}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
