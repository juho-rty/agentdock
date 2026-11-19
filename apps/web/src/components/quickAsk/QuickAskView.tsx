import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import { canCreateProjectInEnvironment } from "@t3tools/client-runtime/operations/projects";
import { inferProjectTitleFromPath, isChatProject } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { resolveProviderInstanceDisplayName } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { T, useGT, Var } from "gt-react";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  FolderIcon,
  HammerIcon,
  MessageCircleIcon,
  PowerIcon,
  SettingsIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { useContext, useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_BASE_NAME } from "../../branding";
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
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  providerInstanceEntriesFor,
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { startChatThread } from "../../hooks/useChatProject";
import { useMergedSettings } from "../../hooks/useSettings";
import { useProjects, useVisibleThreadShells } from "../../state/entities";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironment,
} from "../../state/environments";
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
import { RelativeTime } from "../RelativeTime";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { QuickAskUsage } from "./QuickAskUsage";
import {
  abbreviateHomePath,
  buildQuickAskProjectChips,
  type QuickAskMode,
  type QuickAskProjectChip,
  type QuickAskThreadRow,
  readQuickAskMode,
  selectQuickAskThreads,
  writeQuickAskMode,
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

  const registry = useContext(RegistryContext);
  const [mode, setModeState] = useState<QuickAskMode>(() =>
    readQuickAskMode(typeof window === "undefined" ? undefined : window.localStorage),
  );
  const setMode = (next: QuickAskMode) => {
    setModeState(next);
    writeQuickAskMode(typeof window === "undefined" ? undefined : window.localStorage, next);
    textareaRef.current?.focus();
  };
  const isChat = mode === "chat";
  const [fileManagerFolder, setFileManagerFolder] = useState<string | null>(null);
  const [selectedChipKey, setSelectedChipKey] = useState<string | null>(null);
  const [modelOverride, setModelOverride] = useState<ModelSelection | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const environmentProjects = projects.filter(
    (project) =>
      project.environmentId === environmentId &&
      !isChatProject(project, serverConfig?.chatWorkspaceRoot),
  );
  const chips = buildQuickAskProjectChips({
    fileManagerFolder,
    projects: environmentProjects,
    threads: threads.filter((thread) => thread.environmentId === environmentId),
  });
  const selectedChip = chips.find((chip) => chip.key === selectedChipKey) ?? chips[0] ?? null;
  const selectedProject = isChat ? null : (selectedChip?.project ?? null);
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
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const rowContext = (row: QuickAskThreadRow): QuickAskRowContext => {
    const thread = row.thread;
    const project = projects.find(
      (candidate) =>
        candidate.environmentId === thread.environmentId && candidate.id === thread.projectId,
    );
    return {
      projectTitle:
        project === undefined
          ? null
          : isChatProject(project, serverConfigs.get(thread.environmentId)?.chatWorkspaceRoot)
            ? gt("Chat")
            : project.title,
      // The computer only matters when there is more than one.
      environmentLabel:
        environments.length > 1
          ? (environments.find((candidate) => candidate.environmentId === thread.environmentId)
              ?.label ?? null)
          : null,
      provider:
        providersByEnvironment
          .get(thread.environmentId)
          ?.find((candidate) => candidate.instanceId === thread.providerInstanceId) ?? null,
    };
  };
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const fileManagerName = getLocalFileManagerName(platform, m);
  const canSend =
    text.trim().length > 0 &&
    !sending &&
    environmentId !== null &&
    (isChat ? serverConfig?.chatWorkspaceRoot != null : selectedChip !== null) &&
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

  const submitChat = async (
    message: string,
    targetEnvironmentId: EnvironmentId,
    selection: ModelSelection,
  ) => {
    const ref = await startChatThread({
      registry,
      environmentId: targetEnvironmentId,
      prompt: message,
      modelSelection: selection,
      title: deriveThreadTitleSeed({ text: message, attachments: [] }, m),
    });
    setText("");
    setModelOverride(null);
    openInMainWindow(threadPath(ref.environmentId, ref.threadId));
  };

  const send = () => {
    if (!canSend || environmentId === null || modelSelection === null) return;
    if (!isChat && selectedChip === null) return;
    setSending(true);
    setError(null);
    const message = text.trim();
    void (
      isChat || selectedChip === null
        ? submitChat(message, environmentId, modelSelection)
        : submit(message, selectedChip, environmentId, modelSelection)
    )
      .catch((cause: unknown) => {
        setError(thrownErrorMessage(cause, m) ?? gt("Could not start the thread."));
      })
      .then(() => setSending(false));
  };

  const hintProvider = selectedEntry?.displayName ?? null;
  const hintFolder = isChat
    ? gt("Conversation only")
    : selectedChip
      ? abbreviateHomePath(selectedChip.path)
      : null;

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col bg-background text-foreground select-none"
      data-quick-ask-mode={mode}
    >
      <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
        <AgentDockMark className="size-4.5 text-foreground" aria-hidden />
        <span className="text-sm font-semibold">{APP_BASE_NAME}</span>
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
            <QuickAskThreadButton
              key={`${row.thread.environmentId}:${row.thread.id}`}
              row={row}
              context={rowContext(row)}
            />
          ))}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="flex flex-col gap-0.5 px-2 pb-1.5">
          <h2 className="px-1.5 pt-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            <T>Recent</T>
          </h2>
          {recent.map((row) => (
            <QuickAskThreadButton
              key={`${row.thread.environmentId}:${row.thread.id}`}
              row={row}
              context={rowContext(row)}
            />
          ))}
        </section>
      ) : null}

      <section className="mx-2 mb-2 flex flex-col gap-2 rounded-xl border border-border bg-card p-2.5">
        <div className="flex items-center gap-1.5">
          <div
            role="radiogroup"
            aria-label={gt("Mode")}
            className="flex shrink-0 rounded-md border border-border p-0.5"
          >
            <QuickAskModeButton
              selected={!isChat}
              icon={<HammerIcon className="size-3" aria-hidden />}
              label={gt("Agent")}
              onSelect={() => setMode("agent")}
            />
            <QuickAskModeButton
              selected={isChat}
              icon={<MessageCircleIcon className="size-3" aria-hidden />}
              label={gt("Chat")}
              onSelect={() => setMode("chat")}
            />
          </div>
          <QuickAskProviderPicker
            entries={entries}
            selection={modelSelection}
            onSelect={(instanceId) => {
              const model = getDefaultProviderInstanceModel(providers, instanceId);
              if (model) setModelOverride({ instanceId, model });
            }}
          />
          <QuickAskModelPicker
            entry={selectedEntry}
            selection={modelSelection}
            settings={unifiedSettings}
            onSelect={(selection) => setModelOverride(selection)}
          />
        </div>
        {isChat ? null : chips.length > 0 ? (
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
              Add a project in <Var>{APP_BASE_NAME}</Var> to ask here.
            </T>
          </p>
        )}
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            rows={3}
            placeholder={isChat ? gt("Ask anything") : gt("Ask an agent…")}
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

      <QuickAskUsage onOpen={() => openInMainWindow("/usage")} />

      <footer className="flex items-center gap-0.5 border-t border-border px-1.5 py-1.5">
        <QuickAskFooterButton
          icon={<SquareArrowOutUpRightIcon className="size-3.5" aria-hidden />}
          label={gt("Open {appName}", { appName: APP_BASE_NAME })}
          onClick={() => openInMainWindow(null)}
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

interface QuickAskRowContext {
  readonly projectTitle: string | null;
  readonly environmentLabel: string | null;
  readonly provider: ServerProvider | null;
}

function QuickAskThreadButton({
  row,
  context,
}: {
  readonly row: QuickAskThreadRow;
  readonly context: QuickAskRowContext;
}) {
  const gt = useGT();
  const details = [
    quickAskStatusLabel(row.status, gt),
    context.projectTitle,
    context.environmentLabel,
  ].filter((part): part is string => part !== null && part.length > 0);
  const activityAt = row.activityAt > 0 ? new Date(row.activityAt).toISOString() : null;
  return (
    <button
      type="button"
      onClick={() => openInMainWindow(threadPath(row.thread.environmentId, row.thread.id))}
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[row.status])} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs">{row.thread.title}</span>
        <span className="truncate text-2xs text-muted-foreground">{details.join(" · ")}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5 text-2xs text-muted-foreground tabular-nums">
        {activityAt !== null ? <RelativeTime timestamp={activityAt} /> : null}
        {context.provider !== null ? (
          <ProviderInstanceIcon
            driverKind={context.provider.driver}
            displayName={resolveProviderInstanceDisplayName(context.provider)}
            accentColor={context.provider.accentColor}
            iconClassName="size-3 opacity-70"
          />
        ) : null}
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

const PICKER_TRIGGER_CLASS =
  "flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-accent";
// The popover is narrower than the menu's desktop breakpoint, which would make rows touch-sized.

/** Which AI company's agent answers. Picking one switches to that agent's default model. */
function QuickAskProviderPicker(props: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly selection: ModelSelection | null;
  readonly onSelect: (instanceId: ProviderInstanceEntry["instanceId"]) => void;
}) {
  const gt = useGT();
  const selectedEntry = props.entries.find(
    (entry) => entry.instanceId === props.selection?.instanceId,
  );
  const readyEntries = props.entries.filter(isProviderInstancePickerReady);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={gt("Agent")}
            className={cn(PICKER_TRIGGER_CLASS, "shrink-0 font-medium")}
          />
        }
      >
        {selectedEntry ? <QuickAskEntryIcon entry={selectedEntry} /> : null}
        <span className="max-w-24 truncate">
          {selectedEntry ? selectedEntry.displayName : gt("No agent available")}
        </span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={props.selection?.instanceId ?? ""}
          onValueChange={(next: string) => {
            const entry = readyEntries.find((candidate) => candidate.instanceId === next);
            if (entry) props.onSelect(entry.instanceId);
          }}
        >
          {readyEntries.map((entry) => (
            <MenuRadioItem key={entry.instanceId} value={entry.instanceId} size="compact">
              <span className="flex items-center gap-1.5">
                <QuickAskEntryIcon entry={entry} />
                {entry.displayName}
              </span>
            </MenuRadioItem>
          ))}
          {readyEntries.length === 0 ? (
            <MenuGroupLabel>{gt("No agent is ready.")}</MenuGroupLabel>
          ) : null}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function QuickAskEntryIcon({ entry }: { readonly entry: ProviderInstanceEntry }) {
  return (
    <ProviderInstanceIcon
      driverKind={entry.driverKind}
      displayName={entry.displayName}
      accentColor={entry.accentColor}
      acpRegistryAgentId={entry.acpRegistryAgentId}
      acpRegistryIconUrl={entry.acpRegistryIconUrl}
      size="compact"
    />
  );
}

/** The chosen agent's models. */
function QuickAskModelPicker(props: {
  readonly entry: ProviderInstanceEntry | undefined;
  readonly selection: ModelSelection | null;
  readonly settings: Parameters<typeof getAppModelOptionsForInstance>[0];
  readonly onSelect: (selection: ModelSelection) => void;
}) {
  const gt = useGT();
  const entry = props.entry;
  if (entry === undefined || !isProviderInstancePickerReady(entry)) return null;
  const options = getAppModelOptionsForInstance(props.settings, entry, props.selection?.model);
  const selectedModel = options.find((option) => option.slug === props.selection?.model);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={gt("Model")}
            className={cn(PICKER_TRIGGER_CLASS, "text-muted-foreground")}
          />
        }
      >
        <span className="truncate">
          {selectedModel
            ? getDisplayModelName(selectedModel, { preferShortName: true })
            : gt("Model")}
        </span>
        <ChevronDownIcon className="size-3 shrink-0" aria-hidden />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={props.selection?.model ?? ""}
          onValueChange={(next: string) => {
            if (next) props.onSelect({ instanceId: entry.instanceId, model: next });
          }}
        >
          {options.map((option) => (
            <MenuRadioItem key={option.slug} value={option.slug} size="compact">
              {getDisplayModelName(option)}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function QuickAskModeButton(props: {
  readonly selected: boolean;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      onClick={props.onSelect}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors",
        props.selected
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {props.icon}
      {props.label}
    </button>
  );
}
