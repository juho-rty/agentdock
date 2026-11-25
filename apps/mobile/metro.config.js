const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");
const extraThemes = require("./generated-uniwind-theme-names.json");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const generatedLicenseModuleRoot = path.join(__dirname, ".generated", "third-party-licenses");
const licenseGeneratorSource = path.join(
  workspaceRoot,
  "scripts",
  "lib",
  "third-party-licenses.ts",
);
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const generatedDeviceStreamRoot = path.join(__dirname, ".generated", "device-stream");
const generatedPreviewStreamRoot = path.join(__dirname, ".generated", "preview-stream");
const generatedLiteShimsRoot = path.join(__dirname, ".generated", "lite-shims");
const isLiteBuild = process.env.AGENTDOCK_MOBILE_FULL !== "1";

const LITE_SHIM_FILES = {
  "clerk-expo.js": [
    "exports.ClerkProvider = function ClerkProvider(props) { return props.children; };",
    "exports.getClerkInstance = function getClerkInstance() { return null; };",
    "exports.useAuth = function useAuth() { return { isLoaded: true, isSignedIn: false, userId: null, sessionId: null, getToken: async () => null, signOut: async () => {} }; };",
    "exports.useUser = function useUser() { return { isLoaded: true, isSignedIn: false, user: null }; };",
    "exports.useClerk = function useClerk() { return { signOut: async () => {} }; };",
  ].join("\n"),
  "clerk-token-cache.js": "exports.tokenCache = {};\n",
  "clerk-native-components.js": [
    "exports.AuthView = function AuthView() { return null; };",
    "exports.UserProfileView = function UserProfileView() { return null; };",
  ].join("\n"),
  "expo-observe.js":
    "exports.Observe = { reportError() {}, async dispatchEvents() {}, configure() {} };\n",
  "expo-updates.js": [
    "exports.isEnabled = false;",
    "exports.isEmbeddedLaunch = true;",
    "exports.checkForUpdateAsync = async () => ({ isAvailable: false, isRollBackToEmbedded: false });",
    "exports.fetchUpdateAsync = async () => ({ isNew: false, isRollBackToEmbedded: false });",
    "exports.reloadAsync = async () => {};",
    "exports.readLogEntriesAsync = async () => [];",
  ].join("\n"),
  "apple-transcription.js": [
    "const AppleTranscription = {",
    "  isAvailable: () => false,",
    "  prepare: async () => '',",
    "  transcribe: async () => ({ segments: [] }),",
    "};",
    "exports.default = AppleTranscription;",
    "module.exports = AppleTranscription;",
    "module.exports.default = AppleTranscription;",
  ].join("\n"),
};

const LITE_MODULE_REDIRECTS = {
  "@clerk/expo": path.join(generatedLiteShimsRoot, "clerk-expo.js"),
  "@clerk/expo/token-cache": path.join(generatedLiteShimsRoot, "clerk-token-cache.js"),
  "@clerk/expo/native-components": path.join(generatedLiteShimsRoot, "clerk-native-components.js"),
  "@clerk/expo-native-components": path.join(generatedLiteShimsRoot, "clerk-native-components.js"),
  "expo-observe": path.join(generatedLiteShimsRoot, "expo-observe.js"),
  "expo-updates": path.join(generatedLiteShimsRoot, "expo-updates.js"),
  "@react-native-ai/apple": path.join(generatedLiteShimsRoot, "apple-transcription.js"),
  "@react-native-ai/apple/src/NativeAppleTranscription": path.join(
    generatedLiteShimsRoot,
    "apple-transcription.js",
  ),
};

const upstreamResolveRequest = config.resolver?.resolveRequest;

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : config.resolver?.blockList
        ? [config.resolver.blockList]
        : []),
    new RegExp(`${escapedWorkspaceRoot}[/\\\\]\\.t3[/\\\\].*`),
  ],
  extraNodeModules: {
    ...config.resolver?.extraNodeModules,
    "@t3tools/mobile-third-party-licenses": generatedLicenseModuleRoot,
    "@t3tools/mobile-device-stream": generatedDeviceStreamRoot,
    "@t3tools/mobile-preview-stream": generatedPreviewStreamRoot,
  },
  resolveRequest: (context, moduleName, platform) => {
    if (isLiteBuild && Object.prototype.hasOwnProperty.call(LITE_MODULE_REDIRECTS, moduleName)) {
      return {
        type: "sourceFile",
        filePath: LITE_MODULE_REDIRECTS[moduleName],
      };
    }
    if (upstreamResolveRequest) {
      return upstreamResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

async function writeFileIfChanged(filePath, contents) {
  try {
    if ((await fs.promises.readFile(filePath, "utf8")) === contents) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.promises.writeFile(filePath, contents, "utf8");
}

async function generateMobileThirdPartyLicenses() {
  await fs.promises.mkdir(generatedLicenseModuleRoot, { recursive: true });
  const generatorVersion = (await fs.promises.stat(licenseGeneratorSource)).mtimeMs;
  const { generateThirdPartyLicenseManifest } = await import(
    `${pathToFileURL(licenseGeneratorSource).href}?version=${String(generatorVersion)}`
  );
  const manifest = await generateThirdPartyLicenseManifest({
    configFile: path.join(workspaceRoot, "third-party-licenses.config.json"),
    packageManifests: [{ bundle: "mobile", path: path.join(__dirname, "package.json") }],
  });

  await Promise.all([
    writeFileIfChanged(
      path.join(generatedLicenseModuleRoot, "index.js"),
      `module.exports = ${JSON.stringify(manifest)};\n`,
    ),
    writeFileIfChanged(
      path.join(generatedLicenseModuleRoot, "package.json"),
      '{"main":"index.js"}\n',
    ),
  ]);
}

async function prepareStreamScripts() {
  const { generateDeviceStreamScript, generatePreviewStreamScript } = await import(
    pathToFileURL(path.join(__dirname, "scripts", "generate-device-stream.mts")).href
  );
  const generateAll = () =>
    Promise.all([generateDeviceStreamScript(), generatePreviewStreamScript()]);
  await generateAll();
  if (process.env.NODE_ENV !== "production") {
    let rebuild = Promise.resolve();
    for (const [directory, files, generate] of [
      [
        "apps/mobile/src/features/devices",
        ["device-stream.browser.ts"],
        generateDeviceStreamScript,
      ],
      [
        "apps/mobile/src/features/browser",
        ["preview-stream.browser.ts"],
        generatePreviewStreamScript,
      ],
      ["packages/client-runtime/src/device", ["stream.ts", "hubAccess.ts"], generateAll],
      [
        "packages/client-runtime/src/preview",
        ["serverBrowserStream.ts"],
        generatePreviewStreamScript,
      ],
    ]) {
      fs.watch(path.join(workspaceRoot, directory), { persistent: false }, (_event, filename) => {
        if (filename && !files.includes(String(filename))) return;
        rebuild = rebuild
          .then(generate)
          .then(() => undefined)
          .catch((error) => {
            console.error("Could not rebuild a WebView stream script:", error);
          });
      });
    }
  }
}

async function generateLiteShims() {
  await fs.promises.mkdir(generatedLiteShimsRoot, { recursive: true });
  await Promise.all(
    Object.entries(LITE_SHIM_FILES).map(([filename, contents]) =>
      writeFileIfChanged(path.join(generatedLiteShimsRoot, filename), contents),
    ),
  );
}

module.exports = Promise.all([
  generateLiteShims(),
  generateMobileThirdPartyLicenses(),
  prepareStreamScripts(),
]).then(() =>
  withUniwindConfig(config, {
    cssEntryFile: "./global.css",
    extraThemes,
    polyfills: { rem: 14 },
  }),
);
