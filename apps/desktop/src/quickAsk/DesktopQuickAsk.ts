import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";
import { msg } from "gt-i18n";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { getDesktopUrl } from "../electron/ElectronProtocol.ts";
import * as ElectronShell from "../electron/ElectronShell.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { m } from "../i18n/messages.ts";
import { NAVIGATE_CHANNEL } from "../ipc/channels.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import {
  QUICK_ASK_INITIAL_HEIGHT,
  QUICK_ASK_WIDTH,
  type QuickAskRect,
  resolveQuickAskPosition,
} from "./QuickAskPlacement.ts";

const QUICK_ASK_ROUTE_HASH = "#/quick-ask";
// Keeps a reopened popover instant without holding a renderer forever.
const HIDDEN_RENDERER_TTL_MS = 30_000;
// A tray click that lands right after the blur that hid the popover is a close, not a reopen.
const BLUR_CLICK_DEBOUNCE_MS = 300;

const { logInfo, logWarning } = makeComponentLogger("desktop-quick-ask");

export class DesktopQuickAsk extends Context.Service<
  DesktopQuickAsk,
  {
    /** Creates the tray icon when the setting allows it; call once the app is ready. */
    readonly configure: Effect.Effect<void>;
    readonly setTrayEnabled: (enabled: boolean) => Effect.Effect<void>;
    readonly toggle: Effect.Effect<void>;
    readonly hide: Effect.Effect<void>;
    readonly setHeight: (height: number) => Effect.Effect<void>;
    /** Hides the popover and brings up the main window, optionally at an app route. */
    readonly openMain: (path: string | null) => Effect.Effect<void>;
    readonly openSettings: Effect.Effect<void>;
    /** A route the main renderer has not taken yet because it was still loading. */
    readonly takePendingNavigation: Effect.Effect<string | null>;
    readonly quit: Effect.Effect<void>;
  }
>()("@t3tools/desktop/quickAsk/DesktopQuickAsk") {}

/** Only in-app routes, so the popover cannot steer the main window to another origin. */
function isQuickAskAppPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopState = yield* DesktopState.DesktopState;
  const desktopSettings = yield* DesktopAppSettings.DesktopAppSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronShell = yield* ElectronShell.ElectronShell;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const rendererHistory = yield* DesktopRendererHistory.DesktopRendererHistory;
  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);
  const runPromise = Effect.runPromiseWith(context);
  const runSync = Effect.runSyncWith(context);

  const applicationUrl = getDesktopUrl(environment.isDevelopment);
  const isMac = environment.platform === "darwin";
  const state: {
    tray: Electron.Tray | null;
    popover: Electron.BrowserWindow | null;
    destroyFiber: Fiber.Fiber<void, never> | undefined;
    anchor: { trayBounds: QuickAskRect | null; cursor: Electron.Point } | null;
    height: number;
    hiddenByBlurAt: number;
    watchedMains: WeakSet<Electron.BrowserWindow>;
  } = {
    tray: null,
    popover: null,
    destroyFiber: undefined,
    anchor: null,
    height: QUICK_ASK_INITIAL_HEIGHT,
    hiddenByBlurAt: 0,
    watchedMains: new WeakSet(),
  };
  const pendingNavigation = yield* Ref.make<string | null>(null);

  const livePopover = () =>
    state.popover !== null && !state.popover.isDestroyed() ? state.popover : null;

  const cancelDestroy = () => {
    const fiber = state.destroyFiber;
    state.destroyFiber = undefined;
    if (fiber !== undefined) runFork(Fiber.interrupt(fiber));
  };

  const destroyPopover = () => {
    cancelDestroy();
    const popover = livePopover();
    state.popover = null;
    popover?.destroy();
  };

  const scheduleDestroy = () => {
    cancelDestroy();
    state.destroyFiber = runFork(
      Effect.sleep(HIDDEN_RENDERER_TTL_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            state.destroyFiber = undefined;
            const popover = livePopover();
            if (popover !== null && !popover.isVisible()) destroyPopover();
          }),
        ),
      ),
    );
  };

  const hidePopover = () => {
    const popover = livePopover();
    if (popover === null || !popover.isVisible()) return;
    popover.hide();
    scheduleDestroy();
  };

  const place = (popover: Electron.BrowserWindow) => {
    const anchor = state.anchor;
    if (anchor === null) return;
    const display =
      anchor.trayBounds !== null && (anchor.trayBounds.width > 0 || anchor.trayBounds.height > 0)
        ? Electron.screen.getDisplayMatching(anchor.trayBounds)
        : Electron.screen.getDisplayNearestPoint(anchor.cursor);
    const workArea = display.workArea;
    const height = Math.min(state.height, Math.max(1, workArea.height - 16));
    const position = resolveQuickAskPosition({
      trayBounds: anchor.trayBounds,
      cursor: anchor.cursor,
      workArea,
      width: QUICK_ASK_WIDTH,
      height,
      platform: environment.platform,
    });
    popover.setBounds({ ...position, width: QUICK_ASK_WIDTH, height: Math.round(height) });
  };

  // Closing the last app window must still quit on Windows and Linux; a hidden popover would keep the app alive.
  const watchMain = Effect.gen(function* () {
    if (isMac) return;
    const main = yield* electronWindow.main;
    if (Option.isNone(main) || state.watchedMains.has(main.value)) return;
    state.watchedMains.add(main.value);
    main.value.once("closed", destroyPopover);
  });

  const createPopover = Effect.gen(function* () {
    const shouldUseDarkColors = yield* electronTheme.shouldUseDarkColors;
    const popover = yield* electronWindow.create(
      {
        width: QUICK_ASK_WIDTH,
        height: state.height,
        show: false,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: true,
        title: environment.displayName,
        backgroundColor: shouldUseDarkColors ? "#000000" : "#ffffff",
        ...(isMac ? { roundedCorners: true, hiddenInMissionControl: true } : {}),
        webPreferences: {
          preload: environment.preloadPath,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      },
      { auxiliary: true },
    );
    if (isMac) popover.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    yield* ipc.trustRenderer(popover.webContents);
    yield* rendererHistory.register(popover.webContents, { surface: "quick-ask" });
    popover.webContents.setWindowOpenHandler(({ url }) => {
      if (Option.isSome(ElectronShell.parseSafeExternalUrl(url))) {
        void runPromise(electronShell.openExternal(url));
      }
      return { action: "deny" };
    });
    popover.webContents.on("will-navigate", (event, url) => {
      if (DesktopWindow.isSameOriginRendererNavigation({ applicationUrl, navigationUrl: url })) {
        return;
      }
      event.preventDefault();
    });
    popover.on("blur", () => {
      if (popover.isDestroyed() || popover.webContents.isDevToolsOpened()) return;
      if (!popover.isVisible()) return;
      state.hiddenByBlurAt = runSync(Clock.currentTimeMillis);
      hidePopover();
    });
    popover.webContents.on("render-process-gone", () => {
      if (state.popover === popover) destroyPopover();
    });
    popover.once("closed", () => {
      if (state.popover === popover) state.popover = null;
    });
    void popover.loadURL(`${applicationUrl}${QUICK_ASK_ROUTE_HASH}`).catch((cause: unknown) => {
      void runPromise(logWarning("quick ask failed to load", { cause: String(cause) }));
    });
    state.popover = popover;
    return popover;
  });

  const show = Effect.gen(function* () {
    if (yield* Ref.get(desktopState.quitting)) return;
    cancelDestroy();
    const tray = state.tray;
    const trayBounds = tray !== null && !tray.isDestroyed() ? tray.getBounds() : null;
    state.anchor = { trayBounds, cursor: Electron.screen.getCursorScreenPoint() };
    const existing = livePopover();
    const popover = existing ?? (yield* createPopover);
    yield* watchMain;
    place(popover);
    const reveal = () => {
      if (popover.isDestroyed()) return;
      popover.show();
      popover.focus();
    };
    if (existing === null) popover.once("ready-to-show", reveal);
    else reveal();
  }).pipe(
    Effect.catchCause((cause) => logWarning("quick ask could not open", { cause: String(cause) })),
  );

  const toggle = Effect.gen(function* () {
    const popover = livePopover();
    if (popover !== null && popover.isVisible()) {
      hidePopover();
      return;
    }
    const now = yield* Clock.currentTimeMillis;
    if (now - state.hiddenByBlurAt < BLUR_CLICK_DEBOUNCE_MS) return;
    yield* show;
  }).pipe(Effect.withSpan("desktop.quickAsk.toggle"));

  const openMain = Effect.fn("desktop.quickAsk.openMain")(function* (path: string | null) {
    hidePopover();
    if (path !== null && isQuickAskAppPath(path)) {
      const main = yield* electronWindow.main;
      const ready =
        Option.isSome(main) &&
        !main.value.isDestroyed() &&
        !main.value.webContents.isLoadingMainFrame();
      if (ready) {
        yield* Ref.set(pendingNavigation, null);
        main.value.webContents.send(NAVIGATE_CHANNEL, path);
      } else {
        // A main window that is still loading takes the route once its renderer starts.
        yield* Ref.set(pendingNavigation, path);
      }
    }
    yield* desktopWindow.revealOrCreateMain.pipe(
      Effect.catchCause((cause) =>
        logWarning("quick ask could not open the main window", { cause: String(cause) }),
      ),
    );
  });

  const trayMenu = () =>
    Electron.Menu.buildFromTemplate([
      ...(environment.platform === "linux"
        ? [
            { label: m(msg("Quick Ask")), click: () => void runPromise(show) },
            { type: "separator" as const },
          ]
        : []),
      {
        label: m(msg("Open {appName}"), { appName: environment.displayName }),
        click: () => void runPromise(openMain(null)),
      },
      { type: "separator" },
      {
        label: m(msg("Quit {appName}"), { appName: environment.displayName }),
        click: () => void runPromise(electronApp.quit),
      },
    ]);

  const createTray = Effect.gen(function* () {
    if (state.tray !== null && !state.tray.isDestroyed()) return;
    const iconName = isMac ? "tray/trayTemplate.png" : "tray/tray.png";
    const iconPath = yield* assets
      .resolveResourcePath(iconName)
      .pipe(Effect.catch(() => Effect.succeedNone));
    if (Option.isNone(iconPath)) {
      yield* logWarning("tray icon is missing", { iconName });
      return;
    }
    const image = Electron.nativeImage.createFromPath(iconPath.value);
    if (isMac) image.setTemplateImage(true);
    const tray = new Electron.Tray(image);
    tray.setToolTip(environment.displayName);
    if (environment.platform === "linux") {
      // Many Linux trays only open a context menu, so Quick Ask lives in it.
      tray.setContextMenu(trayMenu());
    } else {
      if (isMac) tray.setIgnoreDoubleClickEvents(true);
      tray.on("click", () => void runPromise(toggle));
      tray.on("double-click", () => void runPromise(openMain(null)));
      tray.on("right-click", () => {
        hidePopover();
        tray.popUpContextMenu(trayMenu());
      });
    }
    state.tray = tray;
    yield* logInfo("tray icon created");
  });

  const destroyTray = () => {
    destroyPopover();
    const tray = state.tray;
    state.tray = null;
    if (tray !== null && !tray.isDestroyed()) tray.destroy();
  };

  yield* Effect.addFinalizer(() => Effect.sync(destroyTray));

  const setTrayEnabled = Effect.fn("desktop.quickAsk.setTrayEnabled")(function* (enabled: boolean) {
    if (enabled) yield* createTray;
    else destroyTray();
  });

  return DesktopQuickAsk.of({
    configure: Effect.gen(function* () {
      const settings = yield* desktopSettings.get;
      yield* setTrayEnabled(settings.trayEnabled);
    }).pipe(
      Effect.catchCause((cause) =>
        logWarning("tray icon could not be created", { cause: String(cause) }),
      ),
      Effect.withSpan("desktop.quickAsk.configure"),
    ),
    setTrayEnabled: Effect.fn("DesktopQuickAsk.setTrayEnabled")(function* (enabled) {
      yield* setTrayEnabled(enabled).pipe(
        Effect.catchCause((cause) =>
          logWarning("tray icon could not be updated", { cause: String(cause) }),
        ),
      );
    }),
    toggle,
    hide: Effect.sync(hidePopover),
    setHeight: Effect.fn("DesktopQuickAsk.setHeight")(function* (height) {
      if (!Number.isFinite(height) || height <= 0) return;
      yield* Effect.sync(() => {
        state.height = Math.ceil(height);
        const popover = livePopover();
        if (popover !== null) place(popover);
      });
    }),
    openMain,
    openSettings: Effect.gen(function* () {
      hidePopover();
      yield* desktopWindow
        .dispatchMenuAction("open-settings")
        .pipe(
          Effect.catchCause((cause) =>
            logWarning("quick ask could not open settings", { cause: String(cause) }),
          ),
        );
    }),
    takePendingNavigation: Ref.getAndSet(pendingNavigation, null),
    quit: electronApp.quit,
  });
});

export const layer = Layer.effect(DesktopQuickAsk, make);
