import { useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { T, useGT, Var } from "gt-react";
import {
  ArrowUpIcon,
  BarChart3Icon,
  ChevronDownIcon,
  FolderIcon,
  PowerIcon,
  SettingsIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_DISPLAY_NAME } from "../../branding";
import { m } from "../../i18n/messages";
import {
  cn,
  getLocalFileManagerName,
  newMessageId,
  newProjectId,
  newThreadId,
} from "../../lib/utils";
import { observeResize } from "../../lib/observeResize";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useMergedSettings } from "../../hooks/useSettings";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { environmentServerConfigsAtom } from "../../state/server";
import { readEnvironmentScope } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { AgentDockMark } from "../AgentDockMark";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getDisplayModelName } from "../chat/providerIconUtils";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import {
  abbreviateHomePath,
  buildQuickAskProjectChips,
  type QuickAskMode,
  type QuickAskProjectChip,
  type QuickAskThreadRow,
  selectQuickAskThreads,
} from "./QuickAsk.logic";

const STATUS_DOT: Record<QuickAskThreadRow["status"], string> = {
  approval: "bg-warning",
  input: "bg-info",
  request: "bg-guest",
  preparing: "bg-info animate-pulse",
  working: "bg-info animate-pulse",
  waiting: "bg-muted-foreground/60",
  failed: "bg-destructive",
  limited: "bg-destructive",
  ready: "bg-success",
};

function threadPath(environmentId: EnvironmentId, threadId: string): string {
  return `/${encodeURIComponent(environmentId)}/${encodeURIComponent(threadId)}`;
}

function currentIsoTimestamp(): string {
  return new Date().toISOString();
}

function closeQuickAsk() {
  void window.desktopBridge?.quickAskClose?.();
}

function openInMainWindow(path: string | null) {
  void window.desktopBridge?.quickAskOpenMain?.(path);
}

/** The tray popover: what agents are doing, and a composer that starts a new thread. */
export function QuickAskView() {
  const gt = useGT();
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const serverConfig = environmentId === null ? undefined : serverConfigs.get(environmentId);
  const providers = serverConfig?.providers ?? [];
  const serverSettings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const unifiedSettings = useMergedSettings(serverSettings);
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const updateProject = useOrchestrationCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });

  // Chat mode hook: a "chat" mode will answer inline instead of opening the main window.
  const [mode] = useState<QuickAskMode>("agent");
  const [fileManagerFolder, setFileManagerFolder] = useState<string | null>(null);
  const [selectedChipKey, setSelectedChipKey] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState<ModelSelection | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const environmentProjects = projects.filter((project) => project.environmentId === environmentId);
  const chips = buildQuickAskProjectChips({
    fileManagerFolder,
    projects: environmentProjects,
    threads: threads.filter((thread) => thread.environmentId === environmentId),
  });
  const selectedChip = chips.find((chip) => chip.key === selectedChipKey) ?? chips[0] ?? null;
  const selectedProject = selectedChip?.project ?? null;
  const projectId: ProjectId | null = selectedProject?.id ?? null;
  const entries = providerInstanceEntriesFor(providers, serverSettings, projectId).filter(
    isProviderInstancePickerVisible,
  );
  const projectDefault =
    resolveProjectSettings(serverSettings, projectId, selectedProject).settings
      .defaultModelSelection ?? null;
  const modelSelection =
    resolveDefaultProviderModelSelection(providers, modelOverride ?? projectDefault) ??
    resolveProjectDefaultProviderModelSelection(providers, serverSettings, projectId);
  const selectedEntry =
    modelSelection === null
      ? undefined
      : entries.find((entry) => entry.instanceId === modelSelection.instanceId);
  const { attention, recent, workingCount } = selectQuickAskThreads(threads);
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const fileManagerName = getLocalFileManagerName(platform, m);
  const canSend =
    text.trim().length > 0 &&
    !sending &&
    environmentId !== null &&
    selectedChip !== null &&
    modelSelection !== null &&
    selectedEntry !== undefined &&
    isProviderInstancePickerReady(selectedEntry);

  const refreshFileManagerFolder = useEffectEvent(() => {
    const read = window.desktopBridge?.getFileManagerFolder;
    if (!read) return;
    void read()
      .then((folder) => setFileManagerFolder(folder))
      .catch(() => setFileManagerFolder(null));
  });

  const onWindowFocus = useEffectEvent(() => {
    refreshFileManagerFolder();
    setError(null);
    textareaRef.current?.focus();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the popover is hidden, not unmounted, between opens; each show refreshes the front Finder folder and focuses the composer
  useEffect(() => {
    refreshFileManagerFolder();
    textareaRef.current?.focus();
    const listener = () => onWindowFocus();
    window.addEventListener("focus", listener);
    return () => window.removeEventListener("focus", listener);
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the native popover window sizes itself to this content, and Escape closes it like a menu
  useEffect(() => {
    const root = rootRef.current;
    const setHeight = window.desktopBridge?.quickAskSetHeight;
    const stopObserving =
      root && setHeight
        ? observeResize(root, () => {
            void setHeight(Math.ceil(root.getBoundingClientRect().height));
          })
        : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) closeQuickAsk();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stopObserving?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const resolveProject = async (
    chip: QuickAskProjectChip,
    targetEnvironmentId: EnvironmentId,
  ): Promise<EnvironmentProject | ProjectId | null> => {
    if (chip.project !== null) {
      if (chip.project.archivedAt != null) {
        // Asking about an archived project's folder brings the project back.
        void updateProject({
          environmentId: chip.project.environmentId,
          input: { projectId: chip.project.id, archived: false },
        });
      }
      return chip.project;
    }
    if (!canCreateProjectInEnvironment(environment?.connection.phase)) {
      setError(gt("{environment} is not connected.", { environment: environment?.label ?? "" }));
      return null;
    }
    if (!readEnvironmentScope(targetEnvironmentId, AuthOrchestrationOperateScope)) {
      setError(gt("This connection cannot add projects."));
      return null;
    }
    const createdId = newProjectId();
    const created = await createProject({
      environmentId: targetEnvironmentId,
      input: {
        projectId: createdId,
        title: inferProjectTitleFromPath(chip.path),
        workspaceRoot: chip.path,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
      },
    });
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        setError(
          thrownErrorMessage(squashAtomCommandFailure(created), m) ?? gt("Failed to add project"),
        );
      }
      return null;
    }
    return createdId;
  };

  const submit = async (
    message: string,
    chip: QuickAskProjectChip,
    targetEnvironmentId: EnvironmentId,
    selection: ModelSelection,
  ) => {
    const project = await resolveProject(chip, targetEnvironmentId);
    if (project === null) return;
    const targetProjectId = typeof project === "string" ? project : project.id;
    const runtimeMode = resolveProjectSettings(
      serverSettings,
      targetProjectId,
      typeof project === "string" ? null : project,
    ).settings.defaultRuntimeMode;
    const threadId = newThreadId();
    const createdAt = currentIsoTimestamp();
    const title = deriveThreadTitleSeed({ text: message, attachments: [] }, m);
    const started = await startTurn({
      environmentId: targetEnvironmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text: message, attachments: [] },
        modelSelection: selection,
        titleSeed: title,
        runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId: targetProjectId,
            title,
            modelSelection: selection,
            runtimeMode,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (started._tag === "Failure") {
      if (!isAtomCommandInterrupted(started)) {
        setError(
          thrownErrorMessage(squashAtomCommandFailure(started), m) ??
            gt("Could not start the thread."),
        );
      }
      return;
    }
    setText("");
    setModelOverride(null);
    openInMainWindow(threadPath(targetEnvironmentId, threadId));
  };

  const send = () => {
    if (!canSend || environmentId === null || selectedChip === null || modelSelection === null) {
      return;
    }
    setSending(true);
    setError(null);
    void submit(text.trim(), selectedChip, environmentId, modelSelection)
      .catch((cause: unknown) => {
        setError(thrownErrorMessage(cause, m) ?? gt("Could not start the thread."));
      })
      .then(() => setSending(false));
  };

  const hintProvider = selectedEntry?.displayName ?? null;
  const hintFolder = selectedChip ? abbreviateHomePath(selectedChip.path) : null;

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col bg-background text-foreground select-none"
      data-quick-ask-mode={mode}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <AgentDockMark className="size-4.5 text-foreground" aria-hidden />
        <span className="text-sm font-semibold">{APP_DISPLAY_NAME}</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "size-1.5 rounded-full",
              workingCount > 0 ? "animate-pulse bg-info" : "bg-muted-foreground/50",
            )}
          />
          {workingCount > 0 ? (
            <T>
              <Var>{workingCount}</Var> working
            </T>
          ) : (
            <T>All idle</T>
          )}
        </span>
      </header>

      {attention.length > 0 ? (
        <section className="flex flex-col gap-1 px-2 pb-1.5">
          <h2 className="px-1.5 pt-1 text-2xs font-medium tracking-wide text-warning-foreground uppercase">
            <T>Needs you</T>
          </h2>
          {attention.map((row) => (
            <QuickAskThreadButton key={`${row.thread.environmentId}:${row.thread.id}`} row={row} />
          ))}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="flex flex-col gap-0.5 px-2 pb-1.5">
          <h2 className="px-1.5 pt-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            <T>Recent</T>
          </h2>
          {recent.map((row) => (
            <QuickAskThreadButton key={`${row.thread.environmentId}:${row.thread.id}`} row={row} />
          ))}
        </section>
      ) : null}

      <section className="mx-2 mb-2 flex flex-col gap-2 rounded-xl border border-border bg-card p-2.5">
        {/* Chat mode hook: the Agent | Chat toggle renders here and `send` branches on `mode`. */}
        <div className="flex items-center gap-1.5">
          <QuickAskModelPicker
            entries={entries}
            selection={modelSelection}
            settings={unifiedSettings}
            onSelect={(selection) => setModelOverride(selection)}
          />
        </div>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {chips.map((chip) => {
              const selected = chip.key === selectedChip?.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedChipKey(chip.key)}
                  className={cn(
                    "flex max-w-full min-w-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors",
                    selected
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <FolderIcon className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {chip.kind === "folder" ? `${fileManagerName} · ${chip.label}` : chip.label}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            <T>
              Add a project in <Var>{APP_DISPLAY_NAME}</Var> to ask here.
            </T>
          </p>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            rows={3}
            placeholder={gt("Ask an agent…")}
            aria-label={gt("Message")}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            className="block max-h-48 min-h-18 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-2 pr-10 text-sm outline-none select-text focus-visible:border-ring"
          />
          <button
            type="button"
            aria-label={gt("Send")}
            disabled={!canSend}
            onClick={send}
            className="absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowUpIcon className="size-4" aria-hidden />
          </button>
        </div>
        {error !== null ? (
          <p className="text-xs text-destructive-foreground" role="alert">
            {error}
          </p>
        ) : hintProvider !== null && hintFolder !== null ? (
          <p className="truncate text-2xs text-muted-foreground">
            {hintProvider} · {hintFolder}
          </p>
        ) : null}
      </section>

      <footer className="flex items-center gap-0.5 border-t border-border px-1.5 py-1.5">
        <QuickAskFooterButton
          icon={<SquareArrowOutUpRightIcon className="size-3.5" aria-hidden />}
          label={gt("Open {appName}", { appName: APP_DISPLAY_NAME })}
          onClick={() => openInMainWindow(null)}
        />
        <QuickAskFooterButton
          icon={<BarChart3Icon className="size-3.5" aria-hidden />}
          label={gt("Usage")}
          onClick={() => openInMainWindow("/usage")}
        />
        <QuickAskFooterButton
          icon={<SettingsIcon className="size-3.5" aria-hidden />}
          label={gt("Settings")}
          onClick={() => void window.desktopBridge?.quickAskOpenSettings?.()}
        />
        <span className="flex-1" />
        <QuickAskFooterButton
          icon={<PowerIcon className="size-3.5" aria-hidden />}
          label={gt("Quit")}
          onClick={() => void window.desktopBridge?.quickAskQuit?.()}
        />
      </footer>
    </div>
  );
}

function QuickAskThreadButton({ row }: { readonly row: QuickAskThreadRow }) {
  const gt = useGT();
  const label = quickAskStatusLabel(row.status, gt);
  return (
    <button
      type="button"
      onClick={() => openInMainWindow(threadPath(row.thread.environmentId, row.thread.id))}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-accent"
    >
      <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[row.status])} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{row.thread.title}</span>
        <span className="truncate text-2xs text-muted-foreground">{label}</span>
      </span>
    </button>
  );
}

function quickAskStatusLabel(
  status: QuickAskThreadRow["status"],
  gt: ReturnType<typeof useGT>,
): string {
  switch (status) {
    case "approval":
      return gt("Waiting for approval");
    case "input":
      return gt("Awaiting input");
    case "request":
      return gt("Guest request");
    case "preparing":
      return gt("Preparing");
    case "working":
      return gt("Working");
    case "waiting":
      return gt("Waiting");
    case "failed":
      return gt("Failed");
    case "limited":
      return gt("Usage limit reached");
    case "ready":
      return gt("Done");
  }
}

function QuickAskFooterButton(props: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {props.icon}
      {props.label}
    </button>
  );
}

function QuickAskModelPicker(props: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly selection: ModelSelection | null;
  readonly settings: Parameters<typeof getAppModelOptionsForInstance>[0];
  readonly onSelect: (selection: ModelSelection) => void;
}) {
  const gt = useGT();
  const selectedEntry = props.entries.find(
    (entry) => entry.instanceId === props.selection?.instanceId,
  );
  const selectedModel = selectedEntry
    ? getAppModelOptionsForInstance(props.settings, selectedEntry, props.selection?.model).find(
        (option) => option.slug === props.selection?.model,
      )
    : undefined;
  const readyEntries = props.entries.filter(isProviderInstancePickerReady);
  const value = props.selection
    ? `${props.selection.instanceId}\u0000${props.selection.model}`
    : "";
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-accent"
          />
        }
      >
        {selectedEntry ? (
          <ProviderInstanceIcon
            driverKind={selectedEntry.driverKind}
            displayName={selectedEntry.displayName}
            accentColor={selectedEntry.accentColor}
            acpRegistryAgentId={selectedEntry.acpRegistryAgentId}
            acpRegistryIconUrl={selectedEntry.acpRegistryIconUrl}
            size="compact"
          />
        ) : null}
        <span className="truncate">
          {selectedEntry
            ? `${selectedEntry.displayName}${
                selectedModel
                  ? ` · ${getDisplayModelName(selectedModel, { preferShortName: true })}`
                  : ""
              }`
            : gt("No agent available")}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={value}
          onValueChange={(next: string) => {
            const [instanceId, model] = next.split("\u0000");
            const entry = readyEntries.find((candidate) => candidate.instanceId === instanceId);
            if (entry && model) props.onSelect({ instanceId: entry.instanceId, model });
          }}
        >
          {readyEntries.map((entry) => (
            <MenuGroup key={entry.instanceId}>
              <MenuGroupLabel>{entry.displayName}</MenuGroupLabel>
              {getAppModelOptionsForInstance(props.settings, entry, props.selection?.model).map(
                (option) => (
                  <MenuRadioItem
                    key={option.slug}
                    value={`${entry.instanceId}\u0000${option.slug}`}
                  >
                    {getDisplayModelName(option)}
                  </MenuRadioItem>
                ),
              )}
            </MenuGroup>
          ))}
          {readyEntries.length === 0 ? (
            <MenuGroupLabel>{gt("No agent is ready.")}</MenuGroupLabel>
          ) : null}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
