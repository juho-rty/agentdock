import { describe, expect, it } from "vite-plus/test";

import {
  buildItmsServicesInstallUrl,
  DEFAULT_IOS_OTA_MANIFEST_URL,
  isNewerBuildVersion,
  parseManifestBundleVersion,
  resolveSigningExpiryInfo,
} from "./iosOtaModel";

describe("iosOtaModel", () => {
  it("parses bundle-version from an Apple OTA manifest plist", () => {
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>items</key><array><dict>
<key>metadata</key><dict><key>bundle-identifier</key><string>kr.ac.snu.jeongjuho.agentdock</string><key>bundle-version</key><string>202611261530</string></dict>
</dict></array></dict></plist>`;
    expect(parseManifestBundleVersion(plist)).toBe("202611261530");
    expect(parseManifestBundleVersion("<plist></plist>")).toBeNull();
  });

  it("compares timestamp build versions numerically", () => {
    expect(isNewerBuildVersion("202611261345", "202611261530")).toBe(true);
    expect(isNewerBuildVersion("202611261530", "202611261530")).toBe(false);
    expect(isNewerBuildVersion("202611261530", "202611261345")).toBe(false);
  });

  it("builds an itms-services manifest URL matching iOS OTA expectations", () => {
    expect(buildItmsServicesInstallUrl(DEFAULT_IOS_OTA_MANIFEST_URL)).toBe(
      "itms-services://?action=download-manifest&url=https://s-mac-mini.tail029af8.ts.net/ios/manifest.plist",
    );
    expect(buildItmsServicesInstallUrl("https://example.com/manifest.plist?a=1&b=2")).toBe(
      "itms-services://?action=download-manifest&url=https%3A%2F%2Fexample.com%2Fmanifest.plist%3Fa%3D1%26b%3D2",
    );
  });

  it("computes remaining signing days and warns at 2 days or less", () => {
    const nowMs = Date.parse("2026-11-26T06:00:00Z");
    const healthy = resolveSigningExpiryInfo({
      provisioningExpiresAt: "2026-12-03T06:00:00Z",
      nativeBuildVersion: "202611261500",
      nowMs,
    });
    expect(healthy?.daysRemaining).toBe(7);
    expect(healthy?.expiringSoon).toBe(false);

    const warning = resolveSigningExpiryInfo({
      provisioningExpiresAt: "2026-11-28T01:00:00Z",
      nativeBuildVersion: "202611211000",
      nowMs,
    });
    expect(warning?.daysRemaining).toBe(2);
    expect(warning?.expiringSoon).toBe(true);
  });
});
