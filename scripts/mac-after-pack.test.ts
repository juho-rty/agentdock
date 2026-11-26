import { describe, expect, it } from "vite-plus/test";

import { adHocSealArgs, rewriteExecutableUuid, uuidOffsets } from "./mac-after-pack.ts";

function thinMachO(uuid: Buffer): Buffer {
  const buffer = Buffer.alloc(32 + 16 + 24);
  buffer.writeUInt32LE(0xfeedfacf, 0);
  buffer.writeUInt32LE(2, 16);
  buffer.writeUInt32LE(40, 20);
  buffer.writeUInt32LE(0x19, 32);
  buffer.writeUInt32LE(16, 36);
  buffer.writeUInt32LE(0x1b, 48);
  buffer.writeUInt32LE(24, 52);
  uuid.copy(buffer, 56);
  return buffer;
}

describe("rewriteExecutableUuid", () => {
  const electronUuid = Buffer.from("4C4C448B55553144A137BC5609565491", "hex");

  it("finds the LC_UUID payload after other load commands", () => {
    expect(uuidOffsets(thinMachO(electronUuid))).toEqual([56]);
  });

  it("replaces the shared Electron UUID with a stable one derived from the app id", () => {
    const first = thinMachO(electronUuid);
    const second = thinMachO(electronUuid);
    expect(rewriteExecutableUuid(first, "com.agentdock.desktop")).toBe(1);
    rewriteExecutableUuid(second, "com.agentdock.desktop");
    const uuid = first.subarray(56, 72);
    expect(uuid.equals(electronUuid)).toBe(false);
    expect(uuid.equals(second.subarray(56, 72))).toBe(true);
    expect(uuid[6]! >> 4).toBe(5);

    const other = thinMachO(electronUuid);
    rewriteExecutableUuid(other, "com.t3tools.t3code");
    expect(other.subarray(56, 72).equals(uuid)).toBe(false);
  });

  it("ignores files that are not 64-bit Mach-O", () => {
    expect(rewriteExecutableUuid(Buffer.alloc(64), "com.agentdock.desktop")).toBe(0);
  });
});

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
