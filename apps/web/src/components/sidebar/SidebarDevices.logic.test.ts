import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import { workingThreadCountByEnvironment } from "./SidebarDevices.logic";

const mac = EnvironmentId.make("environment-mac");
const windows = EnvironmentId.make("environment-windows");
const updatedAt = "2026-11-19T10:00:00.000Z";

function thread(id: string, environmentId: EnvironmentId, overrides: Partial<Thread> = {}): Thread {
  return { ...makeThreadFixture({ id: ThreadId.make(id), environmentId }), ...overrides };
}

function running(id: string, environmentId: EnvironmentId, overrides: Partial<Thread> = {}) {
  return thread(id, environmentId, {
    runtime: {
      status: "running",
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      activeRunId: null,
      lastError: null,
      updatedAt,
    },
    ...overrides,
  });
}

describe("workingThreadCountByEnvironment", () => {
  it("counts running threads per computer and skips idle and archived ones", () => {
    const counts = workingThreadCountByEnvironment([
      running("a", mac),
      running("b", mac),
      running("c", windows, { archivedAt: updatedAt }),
      thread("d", windows),
    ]);
    expect(counts.get(mac)).toBe(2);
    expect(counts.has(windows)).toBe(false);
  });
});
