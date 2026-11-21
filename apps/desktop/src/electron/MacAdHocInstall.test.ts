// @effect-diagnostics nodeBuiltinImport:off -- Runs the real swap script against a temporary bundle.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { appBundlePathFromExecPath, isAdHocSignature, MAC_SWAP_SCRIPT } from "./MacAdHocInstall.ts";

describe("appBundlePathFromExecPath", () => {
  it("finds the bundle around the main executable", () => {
    expect(appBundlePathFromExecPath("/Applications/AgentDock.app/Contents/MacOS/AgentDock")).toBe(
      "/Applications/AgentDock.app",
    );
  });

  it("returns null outside an app bundle", () => {
    expect(appBundlePathFromExecPath("/usr/local/bin/electron")).toBeNull();
    expect(appBundlePathFromExecPath("C:\\Program Files\\AgentDock\\AgentDock.exe")).toBeNull();
  });
});

describe("isAdHocSignature", () => {
  it("recognizes ad-hoc and unsigned bundles", () => {
    expect(isAdHocSignature("CodeDirectory v=20400 flags=0x20002(adhoc)\nSignature=adhoc\n")).toBe(
      true,
    );
    expect(isAdHocSignature("/X.app: code object is not signed at all")).toBe(true);
  });

  it("leaves Developer ID builds to Squirrel.Mac", () => {
    expect(
      isAdHocSignature(
        "Authority=Developer ID Application: Someone (ABCDE12345)\nTeamIdentifier=ABCDE12345",
      ),
    ).toBe(false);
  });
});

describe.skipIf(NodeOS.type() !== "Darwin")("MAC_SWAP_SCRIPT", () => {
  const makeBundle = (root: string, version: string) => {
    const bundle = NodePath.join(root, "AgentDock.app");
    NodeFS.mkdirSync(NodePath.join(bundle, "Contents"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(bundle, "Contents", "version"), version);
    return bundle;
  };

  const runSwap = (zip: string, app: string) => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "agentdock-swap-script-"));
    const script = NodePath.join(dir, "swap.sh");
    NodeFS.writeFileSync(script, MAC_SWAP_SCRIPT, { mode: 0o700 });
    const opened = NodePath.join(dir, "opened");
    const result = NodeChildProcess.spawnSync("/bin/bash", [script, "999999", zip, app], {
      encoding: "utf8",
      env: { ...process.env, AGENTDOCK_SWAP_OPEN: "/usr/bin/touch" },
      cwd: dir,
    });
    return { result, opened, script };
  };

  it("replaces the bundle with the one in the update zip", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "agentdock-swap-"));
    const installed = NodePath.join(root, "Applications");
    NodeFS.mkdirSync(installed);
    const app = makeBundle(installed, "old");
    const staged = NodePath.join(root, "staged");
    NodeFS.mkdirSync(staged);
    makeBundle(staged, "new");
    const zip = NodePath.join(root, "update.zip");
    NodeChildProcess.spawnSync("/usr/bin/ditto", [
      "-c",
      "-k",
      "--keepParent",
      NodePath.join(staged, "AgentDock.app"),
      zip,
    ]);

    const { result, script } = runSwap(zip, app);

    expect(result.status).toBe(0);
    expect(NodeFS.readFileSync(NodePath.join(app, "Contents", "version"), "utf8")).toBe("new");
    expect(NodeFS.readdirSync(installed)).toEqual(["AgentDock.app"]);
    expect(NodeFS.existsSync(script)).toBe(false);
    expect(NodeFS.existsSync(NodePath.dirname(script))).toBe(false);
  });

  it("keeps the installed bundle when the zip is unusable", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "agentdock-swap-"));
    const app = makeBundle(root, "old");
    const zip = NodePath.join(root, "broken.zip");
    NodeFS.writeFileSync(zip, "not a zip");

    const { result } = runSwap(zip, app);

    expect(result.status).toBe(1);
    expect(NodeFS.readFileSync(NodePath.join(app, "Contents", "version"), "utf8")).toBe("old");
  });

  it("aborts before moving the bundle if the old process is still alive after waiting", () => {
    expect(MAC_SWAP_SCRIPT).toContain('if kill -0 "$pid" 2>/dev/null; then exit 1; fi');
  });
});
