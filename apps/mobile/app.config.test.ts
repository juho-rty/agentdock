import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => ({ APP_VARIANT: process.env.APP_VARIANT }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("configures streamlined AgentDock Personal Team iOS builds without paid entitlements", async () => {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", "production");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");
  vi.stubEnv("T3CODE_IOS_TEAM_ID", "FA4T62CK96");
  const config = (await import("./app.config.ts")).default;

  expect(config.name).toBe("AgentDock");
  expect(config.scheme).toEqual(["agentdock", "t3code"]);
  expect(config.ios?.bundleIdentifier).toBe("kr.ac.snu.jeongjuho.agentdock");
  expect(config.ios?.appleTeamId).toBe("FA4T62CK96");
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.ios?.infoPlist?.UIBackgroundModes).toBeUndefined();
  expect(config.updates).toBeUndefined();
  expect(config.extra?.liteBuild).toBe(true);
});
