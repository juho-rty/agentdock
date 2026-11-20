import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { needsAntigravityModelDiscovery } from "./antigravityModelDiscovery.ts";

const added = {
  instanceId: ProviderInstanceId.make("antigravity_second"),
  driver: ProviderDriverKind.make("antigravity"),
  status: "warning",
  enabled: true,
  installed: true,
  auth: { status: "unknown" },
  checkedAt: "2026-11-20T00:00:00.000Z",
  version: "1.5.10",
  models: [],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;

describe("needsAntigravityModelDiscovery", () => {
  it("loads models for an added account that already holds a sign-in", () => {
    expect(needsAntigravityModelDiscovery(added)).toBe(true);
    expect(
      needsAntigravityModelDiscovery({
        ...added,
        status: "ready",
        auth: { status: "authenticated" },
      }),
    ).toBe(true);
  });

  it("leaves accounts that have models, cannot run, or must sign in first", () => {
    const model = { slug: "gemini", name: "Gemini", isCustom: false, capabilities: null };
    expect(needsAntigravityModelDiscovery({ ...added, models: [model] })).toBe(false);
    expect(needsAntigravityModelDiscovery({ ...added, enabled: false })).toBe(false);
    expect(needsAntigravityModelDiscovery({ ...added, installed: false })).toBe(false);
    expect(needsAntigravityModelDiscovery({ ...added, status: "error" })).toBe(false);
    expect(needsAntigravityModelDiscovery({ ...added, auth: { status: "unauthenticated" } })).toBe(
      false,
    );
    expect(
      needsAntigravityModelDiscovery({ ...added, driver: ProviderDriverKind.make("codex") }),
    ).toBe(false);
  });
});
