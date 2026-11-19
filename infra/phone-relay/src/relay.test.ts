import { describe, expect, it } from "vite-plus/test";

import {
  buildUpstreamHeaders,
  buildUpstreamUrl,
  decideRegistration,
  isAcceptableSecret,
  parseTunnelOrigin,
  readBearerToken,
  sha256Hex,
} from "./relay.ts";

describe("parseTunnelOrigin", () => {
  it.each([
    ["https://quiet-river-1234.trycloudflare.com", "https://quiet-river-1234.trycloudflare.com"],
    ["https://Quiet-River.trycloudflare.com/", "https://quiet-river.trycloudflare.com"],
  ])("accepts %s", (input, expected) => {
    expect(parseTunnelOrigin(input)).toBe(expected);
  });

  it.each([
    "http://quiet-river.trycloudflare.com",
    "https://quiet-river.trycloudflare.com/path",
    "https://quiet-river.trycloudflare.com?x=1",
    "https://user:pass@quiet-river.trycloudflare.com",
    "https://quiet-river.trycloudflare.com:8443",
    "https://trycloudflare.com",
    "https://a.b.trycloudflare.com",
    "https://evil.example.com",
    "https://evil.example.com/.trycloudflare.com",
    "not a url",
    42,
    null,
  ])("rejects %s", (input) => {
    expect(parseTunnelOrigin(input)).toBeNull();
  });

  it("honors a configured suffix", () => {
    expect(parseTunnelOrigin("https://mac.example.net", ".example.net")).toBe(
      "https://mac.example.net",
    );
  });
});

describe("registration", () => {
  it("reads only bearer tokens", () => {
    expect(readBearerToken(new Headers({ authorization: "Bearer abc" }))).toBe("abc");
    expect(readBearerToken(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(readBearerToken(new Headers())).toBeNull();
  });

  it("requires a long printable secret", () => {
    expect(isAcceptableSecret("short")).toBe(false);
    expect(isAcceptableSecret("x".repeat(32))).toBe(true);
    expect(isAcceptableSecret(`${"x".repeat(32)} y`)).toBe(false);
  });

  it("claims on first use and then requires the same secret", async () => {
    const first = await sha256Hex("a".repeat(43));
    const other = await sha256Hex("b".repeat(43));
    expect(decideRegistration({ storedSecretHash: null, presentedSecretHash: first })).toEqual({
      kind: "claim",
    });
    expect(decideRegistration({ storedSecretHash: first, presentedSecretHash: first })).toEqual({
      kind: "update",
    });
    expect(decideRegistration({ storedSecretHash: first, presentedSecretHash: other })).toEqual({
      kind: "forbidden",
    });
  });
});

describe("proxied request", () => {
  it("keeps path and query and points at the tunnel", () => {
    expect(
      buildUpstreamUrl(
        new URL("https://agentdock-phone.example.workers.dev/pair?token=abc"),
        "https://quiet-river.trycloudflare.com",
      ).href,
    ).toBe("https://quiet-river.trycloudflare.com/pair?token=abc");
  });

  it("replaces forwarding headers with the relay's own", () => {
    const headers = buildUpstreamHeaders({
      incoming: new Headers({
        cookie: "session=1",
        origin: "https://agentdock-phone.example.workers.dev",
        "x-forwarded-host": "spoofed.example",
        "x-forwarded-proto": "http",
        "x-forwarded-for": "10.0.0.1",
        "cf-connecting-ip": "203.0.113.9",
      }),
      publicHost: "agentdock-phone.example.workers.dev",
      clientIp: "203.0.113.9",
    });
    expect(headers.get("x-forwarded-host")).toBe("agentdock-phone.example.workers.dev");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(headers.get("cf-connecting-ip")).toBeNull();
    expect(headers.get("cookie")).toBe("session=1");
    expect(headers.get("origin")).toBe("https://agentdock-phone.example.workers.dev");
  });
});
