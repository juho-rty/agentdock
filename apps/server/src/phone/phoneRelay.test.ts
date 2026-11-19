import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_PHONE_RELAY_URL,
  classifyRegistrationResponse,
  encodePhoneRelaySecret,
  isTunnelConnectionRegistered,
  parseQuickTunnelUrl,
  quickTunnelArgs,
  resolvePhoneRelayUrl,
} from "./phoneRelay.ts";

describe("resolvePhoneRelayUrl", () => {
  it("uses the built-in relay when empty", () => {
    expect(resolvePhoneRelayUrl("  ")).toBe(DEFAULT_PHONE_RELAY_URL);
  });

  it("keeps a bare https origin", () => {
    expect(resolvePhoneRelayUrl("https://relay.example.workers.dev/")).toBe(
      "https://relay.example.workers.dev",
    );
  });

  it.each(["http://relay.example.dev", "https://relay.example.dev/path", "nope"])(
    "rejects %s",
    (value) => {
      expect(resolvePhoneRelayUrl(value)).toBeNull();
    },
  );
});

describe("quick tunnel", () => {
  it("rewrites Host to the relay's host", () => {
    const args = quickTunnelArgs({
      localOrigin: "http://127.0.0.1:3773",
      relayUrl: "https://agentdock-phone.example.workers.dev",
    });
    expect(args).toContain("--no-autoupdate");
    expect(args.slice(args.indexOf("--url"), args.indexOf("--url") + 2)).toEqual([
      "--url",
      "http://127.0.0.1:3773",
    ]);
    expect(args.slice(args.indexOf("--http-host-header"))).toEqual([
      "--http-host-header",
      "agentdock-phone.example.workers.dev",
    ]);
  });

  it("finds the assigned URL in cloudflared's banner", () => {
    expect(
      parseQuickTunnelUrl(
        "2026-11-19T08:00:00Z INF |  https://wind-thy-college-part.trycloudflare.com                                 |",
      ),
    ).toBe("https://wind-thy-college-part.trycloudflare.com");
    expect(
      parseQuickTunnelUrl("INF Requesting new quick Tunnel on https://api.trycloudflare.com..."),
    ).toBeNull();
    expect(parseQuickTunnelUrl("INF Starting metrics server")).toBeNull();
  });

  it("notices the first edge connection", () => {
    expect(
      isTunnelConnectionRegistered(
        "INF Registered tunnel connection connIndex=0 connection=abc event=0 ip=198.41.192.7 location=icn05 protocol=quic",
      ),
    ).toBe(true);
    expect(isTunnelConnectionRegistered("INF Starting tunnel")).toBe(false);
  });
});

describe("classifyRegistrationResponse", () => {
  it("maps relay answers to what the server does next", () => {
    expect(classifyRegistrationResponse(200, '{"status":"claimed"}')).toEqual({
      kind: "registered",
    });
    expect(classifyRegistrationResponse(403, '{"error":"claimed_by_another_install"}')).toEqual({
      kind: "claimed_elsewhere",
    });
    expect(classifyRegistrationResponse(400, '{"error":"invalid_origin"}')).toEqual({
      kind: "rejected",
      reason: "invalid_origin (HTTP 400)",
    });
    expect(classifyRegistrationResponse(503, "<html>")).toEqual({
      kind: "retry",
      reason: "HTTP 503",
    });
  });
});

describe("encodePhoneRelaySecret", () => {
  it("is long enough for the relay and URL-safe", () => {
    const secret = encodePhoneRelaySecret(new Uint8Array(32).fill(255));
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});
