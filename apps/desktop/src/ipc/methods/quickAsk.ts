import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopQuickAsk from "../../quickAsk/DesktopQuickAsk.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const setQuickAskHeight = makeIpcMethod({
  channel: IpcChannels.QUICK_ASK_SET_HEIGHT_CHANNEL,
  payload: Schema.Number,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickAsk.setHeight")(function* (height) {
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    yield* quickAsk.setHeight(height);
  }),
});

export const closeQuickAsk = makeIpcMethod({
  channel: IpcChannels.QUICK_ASK_CLOSE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickAsk.close")(function* () {
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    yield* quickAsk.hide;
  }),
});

export const openMainFromQuickAsk = makeIpcMethod({
  channel: IpcChannels.QUICK_ASK_OPEN_MAIN_CHANNEL,
  payload: Schema.NullOr(Schema.String),
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickAsk.openMain")(function* (path) {
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    yield* quickAsk.openMain(path);
  }),
});

export const openSettingsFromQuickAsk = makeIpcMethod({
  channel: IpcChannels.QUICK_ASK_OPEN_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickAsk.openSettings")(function* () {
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    yield* quickAsk.openSettings;
  }),
});

export const quitFromQuickAsk = makeIpcMethod({
  channel: IpcChannels.QUICK_ASK_QUIT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickAsk.quit")(function* () {
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    yield* quickAsk.quit;
  }),
});

export const takePendingNavigation = makeIpcMethod({
  channel: IpcChannels.TAKE_PENDING_NAVIGATION_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.quickAsk.takePendingNavigation")(function* () {
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    return yield* quickAsk.takePendingNavigation;
  }),
});

export const getTrayEnabled = makeIpcMethod({
  channel: IpcChannels.GET_TRAY_ENABLED_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.quickAsk.getTrayEnabled")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    return (yield* appSettings.get).trayEnabled;
  }),
});

export const setTrayEnabled = makeIpcMethod({
  channel: IpcChannels.SET_TRAY_ENABLED_CHANNEL,
  payload: Schema.Boolean,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.quickAsk.setTrayEnabled")(function* (enabled) {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    const quickAsk = yield* DesktopQuickAsk.DesktopQuickAsk;
    yield* appSettings.setTrayEnabled(enabled);
    yield* quickAsk.setTrayEnabled(enabled);
  }),
});
