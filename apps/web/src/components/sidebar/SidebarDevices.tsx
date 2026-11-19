import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { useNavigate } from "@tanstack/react-router";
import { useGT } from "gt-react";

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
import { useSidebar } from "../ui/sidebar";
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

/** Every linked computer, whether it is online, and how many threads it is running. */
export function SidebarDevices() {
  const gt = useGT();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const machines = useEnvironmentMachines();
  const working = workingThreadCountByEnvironment(useVisibleThreadShells());
  // A single computer is always this one; the list only helps once others are linked.
  if (environments.length < 2) return null;

  const openConnections = () => {
    if (isMobile) setOpenMobile(false);
    void navigate({ to: "/settings/connections" });
  };

  return (
    <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-1.5">
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
            className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-start text-xs hover:bg-sidebar-row-hover focus-visible:outline-2 focus-visible:outline-ring"
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
                online ? "text-sidebar-foreground" : "text-muted-foreground",
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
  );
}
