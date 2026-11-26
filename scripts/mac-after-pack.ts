// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

interface AfterPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: { readonly appInfo: { readonly productFilename: string } };
}

const prepareServerCompileCache: (context: AfterPackContext) => Promise<void> =
  NodeModule.createRequire(import.meta.url)("./prepare-server-compile-cache.cjs");

// An unsigned build keeps only the linker's ad-hoc signature on the main binary: no sealed
// resources, Info.plist not bound, identifier "Electron". macOS then cannot tie the process to
// AgentDock's bundle, so Local Network access is denied with no prompt and AgentDock never
// appears under Privacy & Security > Local Network. Sealing the whole bundle ad-hoc fixes that.
export function adHocSealArgs(appPath: string): ReadonlyArray<string> {
  return ["--force", "--deep", "--sign", "-", appPath];
}

export default async function afterPack(context: AfterPackContext): Promise<void> {
  await prepareServerCompileCache(context);
  if (context.electronPlatformName !== "darwin") return;
  // Signed builds are sealed by electron-builder's own signing step after this hook.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") return;
  const appPath = NodePath.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  NodeChildProcess.execFileSync("codesign", [...adHocSealArgs(appPath)], { stdio: "inherit" });
}
