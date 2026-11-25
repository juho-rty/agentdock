import { describe, expect, it } from "vite-plus/test";

import {
  buildPairingUrl,
  candidateMobilePairingHosts,
  extractPairingUrlFromQrPayload,
  parsePairingUrl,
} from "./pairing";

describe("buildPairingUrl", () => {
  it("uses HTTP for a schemeless IP address", () => {
    expect(buildPairingUrl("192.168.1.100:3773", "pairing-token")).toBe(
      "http://192.168.1.100:3773/#token=pairing-token",
    );
  });

  it("keeps HTTPS as the default for a schemeless hostname", () => {
    expect(buildPairingUrl("remote.example.com", "pairing-token")).toBe(
      "https://remote.example.com/#token=pairing-token",
    );
  });

  it("preserves an explicit scheme for an IP address", () => {
    expect(buildPairingUrl("https://192.168.1.100:3773", "pairing-token")).toBe(
      "https://192.168.1.100:3773/#token=pairing-token",
    );
  });
});

describe("extractPairingUrlFromQrPayload", () => {
  it("unwraps mobile deep links that carry an encoded pairing url", () => {
    expect(
      extractPairingUrlFromQrPayload(
        "t3code://pair?pairingUrl=https%3A%2F%2Fremote.example.com%2Fpair%23token%3Dpairing-token",
      ),
    ).toBe("https://remote.example.com/pair#token=pairing-token");
  });

  it("unwraps agentdock:// deep links too", () => {
    expect(
      extractPairingUrlFromQrPayload(
        "agentdock://pair?pairingUrl=https%3A%2F%2Fs-mac-mini.tail029af8.ts.net%3A8443%2F%23token%3Dpairing-token",
      ),
    ).toBe("https://s-mac-mini.tail029af8.ts.net:8443/#token=pairing-token");
  });
});

describe("parsePairingUrl", () => {
  it("reads hosted pairing links into backend host fields", () => {
    expect(
      parsePairingUrl(
        "https://app.t3.codes/pair?host=https%3A%2F%2Fdesktop.tailnet.ts.net%2F#token=pairing-token",
      ),
    ).toEqual({
      host: "https://desktop.tailnet.ts.net",
      code: "pairing-token",
    });
  });
});

describe("candidateMobilePairingHosts", () => {
  it("prefers directUrl (Tailscale/LAN) over relayUrl and drops blanks", () => {
    expect(
      candidateMobilePairingHosts({
        directUrl: " https://gmktecm8.tail029af8.ts.net:8443 ",
        relayUrl: "https://relay.example.com",
      }),
    ).toEqual(["https://gmktecm8.tail029af8.ts.net:8443", "https://relay.example.com"]);
    expect(
      candidateMobilePairingHosts({
        directUrl: "https://mac-macbookpro.tail029af8.ts.net:8443",
        relayUrl: "",
      }),
    ).toEqual(["https://mac-macbookpro.tail029af8.ts.net:8443"]);
  });
});
