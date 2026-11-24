import { describe, expect, it } from "vite-plus/test";

import {
  clampQuickAskHeight,
  findUnpromotedWindowsTrayRegistryKeys,
  hasTrayBounds,
  resolveQuickAskPosition,
} from "./QuickAskPlacement.ts";

const macArea = { x: 0, y: 25, width: 1440, height: 875 };
const windowsArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe("resolveQuickAskPosition", () => {
  it("hangs under the macOS menu bar icon", () => {
    expect(
      resolveQuickAskPosition({
        trayBounds: { x: 1200, y: 0, width: 24, height: 24 },
        cursor: { x: 0, y: 0 },
        workArea: macArea,
        width: 390,
        height: 500,
        platform: "darwin",
      }),
    ).toEqual({ x: 1017, y: 28 });
  });

  it("keeps a macOS popover near the right edge inside the work area", () => {
    expect(
      resolveQuickAskPosition({
        trayBounds: { x: 1420, y: 0, width: 24, height: 24 },
        cursor: { x: 0, y: 0 },
        workArea: macArea,
        width: 390,
        height: 500,
        platform: "darwin",
      }).x,
    ).toBe(1440 - 390 - 8);
  });

  it("sits above a bottom Windows taskbar tray icon", () => {
    expect(
      resolveQuickAskPosition({
        trayBounds: { x: 1700, y: 1048, width: 24, height: 32 },
        cursor: { x: 0, y: 0 },
        workArea: windowsArea,
        width: 390,
        height: 400,
        platform: "win32",
      }),
    ).toEqual({ x: 1517, y: 1040 - 400 - 8 });
  });

  it("drops below a taskbar at the top of the screen", () => {
    expect(
      resolveQuickAskPosition({
        trayBounds: { x: 1700, y: 0, width: 24, height: 32 },
        cursor: { x: 0, y: 0 },
        workArea: { x: 0, y: 40, width: 1920, height: 1040 },
        width: 390,
        height: 400,
        platform: "win32",
      }),
    ).toEqual({ x: 1517, y: 48 });
  });

  it("anchors to the cursor when the tray reports no bounds", () => {
    expect(
      resolveQuickAskPosition({
        trayBounds: { x: 0, y: 0, width: 0, height: 0 },
        cursor: { x: 600, y: 1060 },
        workArea: windowsArea,
        width: 390,
        height: 400,
        platform: "linux",
      }),
    ).toEqual({ x: 405, y: 632 });
  });

  it("clamps a popover taller than the screen", () => {
    expect(
      resolveQuickAskPosition({
        trayBounds: { x: 1700, y: 1048, width: 24, height: 32 },
        cursor: { x: 0, y: 0 },
        workArea: { x: 0, y: 0, width: 1280, height: 600 },
        width: 390,
        height: 2000,
        platform: "win32",
      }).y,
    ).toBe(8);
  });
});

describe("hasTrayBounds", () => {
  it("rejects missing and all-zero bounds", () => {
    expect(hasTrayBounds(null)).toBe(false);
    expect(hasTrayBounds({ x: 0, y: 0, width: 0, height: 0 })).toBe(false);
    expect(hasTrayBounds({ x: 10, y: 0, width: 24, height: 24 })).toBe(true);
  });
});

describe("clampQuickAskHeight", () => {
  it("fits the work area and ignores bad input", () => {
    expect(clampQuickAskHeight(300.4, windowsArea)).toBe(300);
    expect(clampQuickAskHeight(5000, windowsArea)).toBe(1024);
    expect(clampQuickAskHeight(Number.NaN, windowsArea)).toBe(1);
  });
});

describe("findUnpromotedWindowsTrayRegistryKeys", () => {
  it("matches full paths and KnownFolder GUID paths without touching user-configured keys", () => {
    const regOutput = [
      "HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\97695540589408293",
      "    ExecutablePath    REG_SZ    {F1B32785-6FBA-4FCF-9D55-7B8E7F157091}\\Programs\\agentdock\\AgentDock.exe",
      "    IconSnapshot    REG_BINARY    89504E47",
      "",
      "HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\11111111111111111",
      "    ExecutablePath    REG_SZ    C:\\Users\\chosp\\AppData\\Local\\Programs\\agentdock\\AgentDock.exe",
      "    IsPromoted    REG_DWORD    0x0",
      "",
      "HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\22222222222222222",
      "    ExecutablePath    REG_SZ    C:\\Users\\chosp\\AppData\\Local\\AgentDock\\deps\\.agentdock-runtime-609a4f\\AgentDock.exe",
      "",
    ].join("\r\n");

    expect(
      findUnpromotedWindowsTrayRegistryKeys(
        regOutput,
        "C:\\Users\\chosp\\AppData\\Local\\Programs\\agentdock\\AgentDock.exe",
      ),
    ).toEqual(["HKEY_CURRENT_USER\\Control Panel\\NotifyIconSettings\\97695540589408293"]);
  });
});
