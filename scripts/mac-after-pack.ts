// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

interface AfterPackContext {
  readonly appOutDir: string;
  readonly electronPlatformName: string;
  readonly packager: {
    readonly appInfo: { readonly id: string; readonly productFilename: string };
  };
}

const prepareServerCompileCache: (context: AfterPackContext) => Promise<void> =
  NodeModule.createRequire(import.meta.url)("./prepare-server-compile-cache.cjs");

const MH_MAGIC_64 = 0xfeedfacf;
const FAT_MAGIC = 0xcafebabe;
const LC_UUID = 0x1b;

function machOUuidOffsets(buffer: Buffer, base: number): Array<number> {
  if (buffer.readUInt32LE(base) !== MH_MAGIC_64) return [];
  const commandCount = buffer.readUInt32LE(base + 16);
  const offsets: Array<number> = [];
  let cursor = base + 32;
  for (let index = 0; index < commandCount; index += 1) {
    const command = buffer.readUInt32LE(cursor);
    const size = buffer.readUInt32LE(cursor + 4);
    if (command === LC_UUID) offsets.push(cursor + 8);
    cursor += size;
  }
  return offsets;
}

// Offsets of every LC_UUID payload in a thin 64-bit or universal Mach-O.
export function uuidOffsets(buffer: Buffer): Array<number> {
  if (buffer.readUInt32BE(0) !== FAT_MAGIC) return machOUuidOffsets(buffer, 0);
  const archCount = buffer.readUInt32BE(4);
  const offsets: Array<number> = [];
  for (let index = 0; index < archCount; index += 1) {
    offsets.push(...machOUuidOffsets(buffer, buffer.readUInt32BE(8 + index * 20 + 8)));
  }
  return offsets;
}

// Every app built on the same Electron release ships the same main executable, with the same
// LC_UUID. macOS Local Network privacy maps the blocked process back to an app by that UUID, so
// it can land on another Electron app (an old T3 Code install, say), find that app's stored
// answer, and never prompt for AgentDock. Give the executable a UUID derived from our app id.
export function rewriteExecutableUuid(buffer: Buffer, appId: string): number {
  const offsets = uuidOffsets(buffer);
  for (const offset of offsets) {
    const original = buffer.subarray(offset, offset + 16);
    const digest = NodeCrypto.createHash("sha256").update(appId).update(original).digest();
    digest[6] = (digest[6]! & 0x0f) | 0x50;
    digest[8] = (digest[8]! & 0x3f) | 0x80;
    digest.copy(buffer, offset, 0, 16);
  }
  return offsets.length;
}

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
  const { id, productFilename } = context.packager.appInfo;
  const appPath = NodePath.join(context.appOutDir, `${productFilename}.app`);
  const executable = NodePath.join(appPath, "Contents", "MacOS", productFilename);
  const binary = NodeFS.readFileSync(executable);
  if (rewriteExecutableUuid(binary, id) === 0) {
    throw new Error(`No LC_UUID found in ${executable}`);
  }
  NodeFS.writeFileSync(executable, binary);
  // Signed builds are sealed by electron-builder's own signing step after this hook.
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") return;
  NodeChildProcess.execFileSync("codesign", [...adHocSealArgs(appPath)], { stdio: "inherit" });
}
