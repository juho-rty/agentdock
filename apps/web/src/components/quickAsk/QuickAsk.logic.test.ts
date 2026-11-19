import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import {
  abbreviateHomePath,
  buildQuickAskProjectChips,
  folderNameFromPath,
  selectQuickAskThreads,
} from "./QuickAsk.logic";

const environmentId = EnvironmentId.make("environment-local");

function thread(id: string, updatedAt: string, overrides: Partial<Thread> = {}): Thread {
  const base = makeThreadFixture({ id: ThreadId.make(id), environmentId });
  return { ...base, updatedAt, ...overrides };
}

function running(id: string, updatedAt: string): Thread {
  return thread(id, updatedAt, {
    runtime: {
      status: "running",
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      activeRunId: null,
      lastError: null,
      updatedAt,
    },
  });
}

function project(id: string, workspaceRoot: string, overrides: Partial<EnvironmentProject> = {}) {
  return {
    id: ProjectId.make(id),
    environmentId,
    title: folderNameFromPath(workspaceRoot),
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    scripts: [],
    ...overrides,
  } as EnvironmentProject;
}

describe("selectQuickAskThreads", () => {
  it("puts approvals first, then running threads, then the most recent idle ones", () => {
    const result = selectQuickAskThreads(
      [
        thread("idle-new", "2026-11-19T10:00:00.000Z"),
        running("busy", "2026-11-18T10:00:00.000Z"),
        thread("approval", "2026-11-17T10:00:00.000Z", { hasPendingApprovals: true }),
        thread("archived", "2026-11-19T11:00:00.000Z", { archivedAt: "2026-11-19T11:00:00.000Z" }),
      ],
      3,
    );

    expect(result.attention.map((row) => row.thread.id)).toEqual(["approval"]);
    expect(result.attention[0]?.status).toBe("approval");
    expect(result.recent.map((row) => row.thread.id)).toEqual(["busy", "idle-new"]);
    expect(result.workingCount).toBe(1);
  });
});

describe("buildQuickAskProjectChips", () => {
  it("leads with the file-manager folder and orders projects by thread activity", () => {
    const alpha = project("alpha", "/Users/me/alpha");
    const beta = project("beta", "/Users/me/beta");
    const hidden = project("hidden", "/Users/me/hidden", {
      archivedAt: "2026-11-02T00:00:00.000Z",
    });
    const chips = buildQuickAskProjectChips({
      fileManagerFolder: "/Users/me/alpha",
      projects: [alpha, beta, hidden],
      threads: [
        { ...thread("t1", "2026-11-19T10:00:00.000Z"), projectId: beta.id },
        { ...thread("t2", "2026-11-10T10:00:00.000Z"), projectId: alpha.id },
      ],
    });

    expect(chips.map((chip) => [chip.kind, chip.label])).toEqual([
      ["folder", "alpha"],
      ["project", "beta"],
    ]);
    expect(chips[0]?.project?.id).toBe(alpha.id);
  });

  it("offers an unregistered folder without a project", () => {
    const chips = buildQuickAskProjectChips({
      fileManagerFolder: "/Users/me/Downloads/",
      projects: [],
      threads: [],
    });

    expect(chips).toEqual([
      {
        kind: "folder",
        key: "folder:/Users/me/Downloads/",
        path: "/Users/me/Downloads/",
        label: "Downloads",
        project: null,
      },
    ]);
  });
});

describe("abbreviateHomePath", () => {
  it.each([
    ["/Users/me/code/app", "~/code/app"],
    ["/home/me", "~"],
    ["C:\\Users\\me\\code", "~/code"],
    ["/opt/work", "/opt/work"],
  ])("abbreviates %s", (input, expected) => {
    expect(abbreviateHomePath(input)).toBe(expected);
  });
});
