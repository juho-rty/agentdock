import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import { readFileManagerFolder } from "../../shell/FileManagerFolder.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getFileManagerFolder = makeIpcMethod({
  channel: IpcChannels.GET_FILE_MANAGER_FOLDER_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.fileManagerFolder.get")(function* () {
    const appSettings = yield* DesktopAppSettings.DesktopAppSettings;
    // The folder only means something to a backend on this machine.
    if (!(yield* appSettings.get).localEnvironmentEnabled) return null;
    const platform = yield* HostProcess.Platform;
    return yield* Effect.promise(() => readFileManagerFolder(platform));
  }),
});
