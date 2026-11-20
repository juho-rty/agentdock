import { toServerClock } from "@t3tools/client-runtime/clock";
import {
  formatWorkingDurationLabel,
  resolveThreadProviderStack,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { msg, T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, MessageCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { APP_BASE_NAME } from "../../branding";
import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useNowSecond } from "../../hooks/useNowSecond";
import { cn } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import {
  deriveProviderEntriesByEnvironment,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  useAllEnvironmentShellsBootstrapped,
  useDelegatedUnderParent,
  useProjects,
  useServerConfigs,
  useVisibleThreadShells,
} from "../../state/entities";
import { useEnvironmentMachines, useEnvironmentProviders } from "../../state/environments";
import { formatRelativeTime } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { NoProjectsHero } from "../NoProjectsHero";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveThreadStatusPill, resolveWorkingStartedAt } from "../Sidebar.logic";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import {
  buildMobileHomeSections,
  groupMobileHomeRowsByProject,
  MOBILE_HOME_WORKING_EXPANDED_STORAGE_KEY,
  NO_MOBILE_HOME_FILTERS,
  type MobileHomeFilters,
  type MobileHomeProjectOption,
  type MobileHomeSections,
  type MobileHomeThreadRow,
} from "./MobileHome.logic";
import { useMobileHomeFilters } from "./useMobileHomeFilters";

const ALL_VALUE = "all";
const MOBILE_THREAD_OPEN_VIEW_TRANSITION = { types: ["liquid-forward"] };

type MachineKind = Parameters<typeof EnvironmentMachineIcon>[0]["kind"];
type ProviderEntries = ReadonlyMap<string, ProviderInstanceEntry>;

function FilterMenu(props: {
  readonly ariaLabel: string;
  readonly allLabel: string;
  readonly value: string | null;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  readonly onChange: (value: string | null) => void;
}) {
  const selected = props.options.find((option) => option.value === props.value) ?? null;
  return (
    <Menu>
      <MenuTrigger
        aria-label={props.ariaLabel}
        render={
          <button
            type="button"
            className={cn(
              "liquid-press flex h-9 min-w-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              selected === null
                ? "border-border/70 bg-secondary/60 text-foreground"
                : "border-primary/40 bg-primary/10 text-foreground",
            )}
          />
        }
      >
        <span className="truncate">{selected?.label ?? props.allLabel}</span>
        <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="max-w-[calc(100vw-2rem)]">
        <MenuRadioGroup
          value={props.value ?? ALL_VALUE}
          onValueChange={(value) => props.onChange(value === ALL_VALUE ? null : String(value))}
        >
          <MenuRadioItem value={ALL_VALUE} closeOnClick>
            {props.allLabel}
          </MenuRadioItem>
          {props.options.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span className="block truncate">{option.label}</span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

// Ticks on its own so only the label re-renders each minute.
function RelativeTime(props: { readonly timestamp: number }) {
  const nowMinute = useNowMinute();
  const m = useMessages();
  if (props.timestamp === 0) return null;
  const parts = formatRelativeTime(
    new Date(props.timestamp).toISOString(),
    Date.parse(`${nowMinute}:00.000Z`),
    m,
  );
  if (parts === null) return null;
  return parts.suffix === null ? m(msg("now", { $context: "relative time" })) : parts.value;
}

// Ticks on its own so only the label re-renders each second.
function WorkingDuration(props: {
  readonly environmentId: EnvironmentId;
  readonly startedMs: number;
}) {
  const nowMs = useNowSecond();
  const messages = useMessages();
  return (
    <span className="tabular-nums">
      {formatWorkingDurationLabel(
        toServerClock(props.environmentId, nowMs) - props.startedMs,
        messages,
      )}
    </span>
  );
}

function ProviderStack(props: {
  readonly thread: EnvironmentThreadShell;
  readonly entries: ProviderEntries | undefined;
}) {
  const { entries } = props;
  if (entries === undefined) return null;
  const stack = resolveThreadProviderStack(props.thread);
  const current = entries.get(stack[stack.length - 1]!);
  if (current === undefined) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {stack.slice(0, -1).map((instanceId) => {
        const entry = entries.get(instanceId);
        return entry === undefined ? null : (
          <ProviderInstanceIcon
            key={instanceId}
            driverKind={entry.driverKind}
            displayName={entry.displayName}
            acpRegistryAgentId={entry.acpRegistryAgentId}
            acpRegistryIconUrl={entry.acpRegistryIconUrl}
            iconClassName="size-3 opacity-35 grayscale"
          />
        );
      })}
      <ProviderInstanceIcon
        driverKind={current.driverKind}
        displayName={current.displayName}
        accentColor={current.accentColor}
        acpRegistryAgentId={current.acpRegistryAgentId}
        acpRegistryIconUrl={current.acpRegistryIconUrl}
        showBadge={shouldShowInstanceBadge(current, entries.values())}
        size="compact"
        iconClassName="opacity-70"
      />
    </span>
  );
}

interface ThreadRowContext {
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly environmentLabelById: ReadonlyMap<string, string>;
  readonly machineById: ReadonlyMap<string, MachineKind>;
  readonly providerEntriesByEnvironment: ReadonlyMap<string, ProviderEntries>;
}

/**
 * The home is rebuilt each time a thread is left. These keep that from showing: the rows
 * rise in only the first time, and the list comes back at the place it was left.
 */
let homeShownBefore = false;
let homeScrollTop = 0;

/** Only the first screenful of rows rises in; the rest are offscreen anyway. */
const RISE_ROW_LIMIT = 10;

function ThreadRow(props: {
  readonly row: MobileHomeThreadRow<EnvironmentThreadShell>;
  readonly context: ThreadRowContext;
  readonly working: boolean;
  readonly index: number;
  /** False when the home is being returned to: the rows are already familiar. */
  readonly rise: boolean;
}) {
  const m = useMessages();
  const { thread } = props.row;
  const project = props.context.projectByKey.get(`${thread.environmentId}:${thread.projectId}`);
  const environmentLabel = props.context.environmentLabelById.get(thread.environmentId);
  const pill = resolveThreadStatusPill({ thread });
  const startedAt = props.working ? resolveWorkingStartedAt(thread) : null;
  const startedMs = startedAt === null ? Number.NaN : Date.parse(startedAt);

  return (
    <li
      className={cn(
        "group/row [content-visibility:auto] [contain-intrinsic-size:auto_4rem]",
        props.rise && props.index < RISE_ROW_LIMIT && "liquid-rise",
      )}
      style={{ "--liquid-index": props.index } as CSSProperties}
    >
      <Link
        to="/$environmentId/$threadId"
        params={{ environmentId: thread.environmentId, threadId: thread.id }}
        viewTransition={MOBILE_THREAD_OPEN_VIEW_TRANSITION}
        data-mobile-thread-row={thread.id}
        className="liquid-press flex items-start gap-3 px-5 py-2.5 outline-none [--liquid-press-scale:0.985] focus-visible:bg-accent/60 active:bg-accent/60"
      >
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-muted-foreground">
          {project === undefined || project.isChat === true ? (
            <MessageCircleIcon aria-hidden className="size-5" />
          ) : (
            <ProjectFavicon project={project} className="size-6" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-base font-medium leading-snug text-foreground">
            {thread.title}
          </span>
          {environmentLabel === undefined ? null : (
            <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <EnvironmentMachineIcon
                aria-hidden
                kind={props.context.machineById.get(thread.environmentId) ?? "server"}
                className="size-3 shrink-0"
              />
              <span className="truncate">{environmentLabel}</span>
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            {pill === null ? (
              props.working ? (
                <Spinner size="xs" />
              ) : null
            ) : (
              <span className={cn("inline-flex items-center gap-1 font-medium", pill.colorClass)}>
                <span
                  aria-hidden
                  className={cn(
                    "size-2 rounded-full",
                    pill.dotClass,
                    pill.pulse && "motion-safe:animate-status-pulse",
                  )}
                />
                {m(pill.label)}
              </span>
            )}
            {!props.working ? (
              <RelativeTime timestamp={props.row.activityAt} />
            ) : Number.isNaN(startedMs) ? null : (
              <WorkingDuration environmentId={thread.environmentId} startedMs={startedMs} />
            )}
          </span>
          <ProviderStack
            thread={thread}
            entries={props.context.providerEntriesByEnvironment.get(thread.environmentId)}
          />
        </span>
      </Link>
      <div aria-hidden className="ml-5 h-px bg-border/60 group-last/row:hidden" />
    </li>
  );
}

function EmptyNote(props: { readonly title: ReactNode; readonly children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-8 py-16 text-center">
      <p className="text-base font-medium text-foreground">{props.title}</p>
      {props.children}
    </div>
  );
}

export function MobileHomeView(props: {
  readonly environments: ReadonlyArray<{ readonly environmentId: string; readonly label: string }>;
  readonly projectOptions: ReadonlyArray<MobileHomeProjectOption>;
  readonly filters: MobileHomeFilters;
  readonly onFiltersChange: (filters: MobileHomeFilters) => void;
  readonly sections: MobileHomeSections<EnvironmentThreadShell>;
  /** False while an environment could still deliver threads. */
  readonly loaded: boolean;
  readonly workingExpanded: boolean;
  readonly onWorkingExpandedChange: (expanded: boolean) => void;
  readonly onSearch: () => void;
  readonly context: ThreadRowContext;
}) {
  const gt = useGT();
  const contentArea = workspaceAreaProps("home", 1, gt("Home", { $context: "the home screen" }));
  const { filters, sections } = props;
  const filtered = filters.environmentId !== null || filters.projectKey !== null;
  const empty = sections.threads.length === 0 && sections.working.length === 0;
  const threadGroups = groupMobileHomeRowsByProject(sections.threads, props.projectOptions);
  const [rise] = useState(() => !homeShownBefore);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- puts the scroller DOM node back at the offset it was left at
  useLayoutEffect(() => {
    homeShownBefore = true;
    if (scrollerRef.current !== null) scrollerRef.current.scrollTop = homeScrollTop;
  }, []);

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      data-mobile-home=""
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <div
        ref={scrollerRef}
        onScroll={(event) => {
          homeScrollTop = event.currentTarget.scrollTop;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-safe pt-safe"
      >
        <header className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
          <h1 className="truncate text-3xl font-bold leading-tight tracking-tight">
            {APP_BASE_NAME}
          </h1>
          <button
            type="button"
            aria-label={gt("Search")}
            onClick={props.onSearch}
            className="liquid-press flex size-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary/60 text-foreground outline-none [--liquid-press-scale:0.92] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
          >
            <SearchIcon aria-hidden className="size-[1.125rem]" />
          </button>
        </header>
        <div className="flex items-center gap-2 px-5 py-3">
          <FilterMenu
            ariaLabel={gt("Filter threads by environment")}
            allLabel={gt("All environments")}
            value={filters.environmentId}
            options={props.environments.map((environment) => ({
              value: environment.environmentId,
              label: environment.label,
            }))}
            onChange={(environmentId) => props.onFiltersChange({ ...filters, environmentId })}
          />
          <FilterMenu
            ariaLabel={gt("Filter threads by project")}
            allLabel={gt("All projects")}
            value={filters.projectKey}
            options={props.projectOptions.map((option) => ({
              value: option.projectKey,
              label: option.displayName,
            }))}
            onChange={(projectKey) => props.onFiltersChange({ ...filters, projectKey })}
          />
          {filtered ? (
            <button
              type="button"
              aria-label={gt("Reset thread filters")}
              onClick={() => props.onFiltersChange(NO_MOBILE_HOME_FILTERS)}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
        {sections.working.length > 0 ? (
          <section className="mb-2">
            <button
              type="button"
              aria-expanded={props.workingExpanded}
              onClick={() => props.onWorkingExpandedChange(!props.workingExpanded)}
              className="flex w-full items-center gap-1.5 px-5 py-2.5 text-left text-sm font-semibold text-muted-foreground outline-none focus-visible:bg-accent/60 active:bg-accent/60"
            >
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "size-4 transition-transform duration-300 ease-(--liquid-spring)",
                  props.workingExpanded ? "" : "-rotate-90",
                )}
              />
              {props.workingExpanded
                ? gt("Working")
                : gt("Working ({count})", { count: sections.working.length })}
            </button>
            {props.workingExpanded ? (
              <ul aria-label={gt("Working")}>
                {sections.working.map((row, index) => (
                  <ThreadRow
                    key={`${row.thread.environmentId}:${row.thread.id}`}
                    row={row}
                    index={index}
                    rise={rise}
                    context={props.context}
                    working
                  />
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        {threadGroups.map((group) => {
          const name = group.displayName ?? gt("Other");
          return (
            <section key={group.projectKey ?? ""} className="mb-2">
              {/* One project on screen needs no heading: the filter already names it. */}
              {filters.projectKey !== null ? null : (
                <h2 className="truncate px-5 pt-2.5 pb-1 text-sm font-semibold text-muted-foreground">
                  {name}
                </h2>
              )}
              <ul aria-label={filters.projectKey !== null ? gt("Threads") : name}>
                {group.rows.map((row, index) => (
                  <ThreadRow
                    key={`${row.thread.environmentId}:${row.thread.id}`}
                    row={row}
                    index={index}
                    rise={rise}
                    context={props.context}
                    working={false}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        {!empty ? null : !props.loaded ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" tone="muted" />
          </div>
        ) : filtered ? (
          <EmptyNote title={<T>No threads match these filters</T>}>
            <button
              type="button"
              onClick={() => props.onFiltersChange(NO_MOBILE_HOME_FILTERS)}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-accent"
            >
              <T>Clear filters</T>
            </button>
          </EmptyNote>
        ) : (
          <EmptyNote title={<T>No threads yet</T>}>
            <p className="text-sm text-muted-foreground">
              <T>Start one with the new thread button.</T>
            </p>
          </EmptyNote>
        )}
        {/* The list scrolls under the floating tab bar; this keeps the last row clear of it. */}
        <div aria-hidden className="h-24" />
      </div>
    </SidebarInset>
  );
}

/** The phone home: every thread in one list, as the native iOS app shows it. */
export function MobileHome() {
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const delegatedUnderParent = useDelegatedUnderParent();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const machineById = useEnvironmentMachines();
  const providersByEnvironment = useEnvironmentProviders();
  const serverConfigs = useServerConfigs();
  const { environments, filters, projectOptions, projectOption, setFilters } =
    useMobileHomeFilters();
  const [workingExpanded, setWorkingExpanded] = useLocalStorage(
    MOBILE_HOME_WORKING_EXPANDED_STORAGE_KEY,
    true,
    Schema.Boolean,
  );

  // A pending environment cannot prove the workspace is empty.
  if (bootstrapped && projects.length === 0) return <NoProjectsHero />;

  // Per environment, because default instance ids collide across environments.
  const providerEntriesByEnvironment = deriveProviderEntriesByEnvironment(
    [...serverConfigs].map(
      ([environmentId, config]) =>
        [environmentId, providersByEnvironment.get(environmentId) ?? [], config.settings] as const,
    ),
  );

  return (
    <MobileHomeView
      environments={environments}
      projectOptions={projectOptions}
      filters={filters}
      onFiltersChange={setFilters}
      sections={buildMobileHomeSections({
        threads,
        delegatedUnderParent,
        environmentId: filters.environmentId,
        projectOption,
      })}
      loaded={bootstrapped}
      workingExpanded={workingExpanded}
      onWorkingExpandedChange={setWorkingExpanded}
      onSearch={() => openCommandPalette()}
      context={{
        projectByKey: new Map(
          projects.map((project) => [`${project.environmentId}:${project.id}`, project] as const),
        ),
        environmentLabelById: new Map(
          environments.map(
            (environment) => [environment.environmentId, environment.label] as const,
          ),
        ),
        machineById,
        providerEntriesByEnvironment,
      }}
    />
  );
}
