import { describe, expect, it } from "vite-plus/test";

import {
  applicationServerKey,
  isIosDevice,
  resolveWebPushAvailability,
  subscriptionPayload,
  threadPathFromWorkerMessage,
  type WebPushEnvironment,
} from "./webPush.logic";

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const environment = (overrides: Partial<WebPushEnvironment> = {}): WebPushEnvironment => ({
  isElectron: false,
  isSecureContext: true,
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36",
  platform: "MacIntel",
  maxTouchPoints: 0,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  ...overrides,
});

describe("resolveWebPushAvailability", () => {
  it("is available in a browser with the push API over HTTPS", () => {
    expect(resolveWebPushAvailability(environment())).toBe("available");
  });

  it("leaves the desktop app to its own notifications", () => {
    expect(resolveWebPushAvailability(environment({ isElectron: true }))).toBe("desktop-app");
  });

  it("needs a secure page", () => {
    expect(resolveWebPushAvailability(environment({ isSecureContext: false }))).toBe("insecure");
  });

  it("asks an iPhone in Safari to add the page to the home screen first", () => {
    const iphone = { userAgent: IPHONE_UA, platform: "iPhone", maxTouchPoints: 5 };
    expect(
      resolveWebPushAvailability(
        environment({ ...iphone, hasPushManager: false, hasNotification: false }),
      ),
    ).toBe("ios-needs-home-screen");
    expect(resolveWebPushAvailability(environment({ ...iphone, standalone: true }))).toBe(
      "available",
    );
  });

  it("reports an old home-screen iOS without the push API as unsupported", () => {
    expect(
      resolveWebPushAvailability(
        environment({
          userAgent: IPHONE_UA,
          platform: "iPhone",
          standalone: true,
          hasPushManager: false,
        }),
      ),
    ).toBe("unsupported");
  });
});

describe("isIosDevice", () => {
  it("recognizes an iPad that claims to be a Mac", () => {
    expect(isIosDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 })).toBe(
      true,
    );
    expect(isIosDevice({ userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 0 })).toBe(
      false,
    );
  });
});

describe("applicationServerKey", () => {
  it("decodes unpadded base64url", () => {
    expect([...applicationServerKey("BP-_AQ")]).toEqual([0x04, 0xff, 0xbf, 0x01]);
    expect(applicationServerKey("").length).toBe(0);
  });
});

describe("subscriptionPayload", () => {
  it("keeps the endpoint and both keys", () => {
    expect(
      subscriptionPayload({
        endpoint: "https://web.push.apple.com/a",
        keys: { p256dh: "key", auth: "secret", extra: "x" },
      }),
    ).toEqual({
      endpoint: "https://web.push.apple.com/a",
      keys: { p256dh: "key", auth: "secret" },
    });
  });

  it("is null when a part is missing", () => {
    expect(subscriptionPayload({ keys: { p256dh: "key", auth: "secret" } })).toBeNull();
    expect(subscriptionPayload({ endpoint: "https://x", keys: { p256dh: "key" } })).toBeNull();
  });
});

describe("threadPathFromWorkerMessage", () => {
  it("accepts an in-app path from the service worker", () => {
    expect(threadPathFromWorkerMessage({ type: "agentdock:open-thread", url: "/env/thread" })).toBe(
      "/env/thread",
    );
  });

  it("ignores other messages and anything that is not a path on this origin", () => {
    expect(threadPathFromWorkerMessage(null)).toBeNull();
    expect(threadPathFromWorkerMessage({ type: "other", url: "/a" })).toBeNull();
    expect(
      threadPathFromWorkerMessage({ type: "agentdock:open-thread", url: "https://evil.example" }),
    ).toBeNull();
    expect(
      threadPathFromWorkerMessage({ type: "agentdock:open-thread", url: "//evil.example" }),
    ).toBeNull();
  });
});
