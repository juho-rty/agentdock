import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { rowWindows } from "./SidebarProviderUsage";

describe("rowWindows", () => {
  it("prefers Claude's overall weekly limit over tighter model-scoped weekly limits", () => {
    const windows: ServerProviderUsageWindow[] = [
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        windowDurationMins: 300,
        usedPercent: 0,
      },
      {
        id: "seven_day",
        kind: "weekly",
        label: "Weekly",
        windowDurationMins: 10080,
        usedPercent: 18,
      },
      {
        id: "seven_day_fable",
        kind: "weekly",
        label: "Weekly · Fable",
        windowDurationMins: 10080,
        usedPercent: 70,
      },
    ];

    expect(rowWindows(windows).map((window) => window.id)).toEqual(["five_hour", "seven_day"]);
  });

  it("falls back to the tightest weekly window when no overall seven_day window exists", () => {
    const windows: ServerProviderUsageWindow[] = [
      {
        id: "gemini-5h",
        kind: "session",
        label: "Gemini · 5h",
        windowDurationMins: 300,
        usedPercent: 3,
      },
      { id: "3p-5h", kind: "session", label: "3P · 5h", windowDurationMins: 300, usedPercent: 1 },
      {
        id: "gemini-weekly",
        kind: "weekly",
        label: "Gemini · Weekly",
        windowDurationMins: 10080,
        usedPercent: 5,
      },
      {
        id: "3p-weekly",
        kind: "weekly",
        label: "3P · Weekly",
        windowDurationMins: 10080,
        usedPercent: 40,
      },
    ];

    expect(rowWindows(windows).map((window) => window.id)).toEqual(["gemini-5h", "3p-weekly"]);
  });
});
