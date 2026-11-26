import { describe, expect, it } from "vite-plus/test";

import { adHocSealArgs } from "./mac-after-pack.ts";

describe("adHocSealArgs", () => {
  it("re-signs the whole bundle ad-hoc so macOS binds Info.plist and resources", () => {
    expect(adHocSealArgs("/out/AgentDock.app")).toEqual([
      "--force",
      "--deep",
      "--sign",
      "-",
      "/out/AgentDock.app",
    ]);
  });
});
