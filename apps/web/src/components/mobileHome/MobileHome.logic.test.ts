import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import {
  resolveMobileChatEnvironment,
  buildMobileHomeSections,
  filterMobileHomeProjectOptions,
  resolveMobileHomeFilters,
  resolveMobileNewThreadProject,
  resolveMobileTab,
  type MobileHomeProjectOption,
} from "./MobileHome.logic";

const mac = EnvironmentId.make("environment-mac");
const vps = EnvironmentId.make("environment-vps");

function thread(
  id: string,
  updatedAt: string,
  overrides: Partial<Thread> & { environmentId?: EnvironmentId } = {},
): Thread {
  const base = makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: overrides.environmentId ?? mac,
    projectId: overrides.projectId ?? ProjectId.make("project-app"),
  });
  return { ...base, updatedAt, ...overrides };
}

function running(id: string, updatedAt: string, overrides: Partial<Thread> = {}): Thread {
  return thread(id, updatedAt, {
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

const appOption: MobileHomeProjectOption = {
  projectKey: "group-app",
  displayName: "App",
  members: [
    { environmentId: mac, id: ProjectId.make("project-app") },
    { environmentId: vps, id: ProjectId.make("project-app-remote") },
  ],
};
const docsOption: MobileHomeProjectOption = {
  projectKey: "group-docs",
  displayName: "Docs",
  members: [{ environmentId: mac, id: ProjectId.make("project-docs") }],
};

const ids = (rows: ReadonlyArray<{ readonly thread: Thread }>) => rows.map((row) => row.thread.id);

describe("resolveMobileTab", () => {
  it("maps the tab pages and hides the bar everywhere else", () => {
    expect(resolveMobileTab("/")).toBe("threads");
    expect(resolveMobileTab("/pull-requests")).toBe("pullRequests");
    expect(resolveMobileTab("/usage")).toBe("usage");
    expect(resolveMobileTab("/settings")).toBe("settings");
    expect(resolveMobileTab("/settings/providers")).toBe("settings");
    expect(resolveMobileTab("/settingsx")).toBeNull();
    expect(resolveMobileTab("/environment-mac/thread-1")).toBeNull();
    expect(resolveMobileTab("/draft/abc")).toBeNull();
  });
});

describe("buildMobileHomeSections", () => {
  it("lists idle threads newest first and moves running ones to Working", () => {
    const sections = buildMobileHomeSections({
      threads: [
        thread("old", "2026-11-17T10:00:00.000Z"),
        running("busy", "2026-11-18T10:00:00.000Z"),
        thread("new", "2026-11-19T10:00:00.000Z"),
        thread("approval", "2026-11-18T12:00:00.000Z", { hasPendingApprovals: true }),
      ],
      delegatedUnderParent: new Set(),
      environmentId: null,
      projectOption: null,
    });
    expect(ids(sections.threads)).toEqual(["new", "approval", "old"]);
    expect(ids(sections.working)).toEqual(["busy"]);
    expect(sections.threads[1]?.status).toBe("approval");
  });

  it("orders by the latest user message over a later bookkeeping update", () => {
    const sections = buildMobileHomeSections({
      threads: [
        thread("touched", "2026-11-19T10:00:00.000Z", {
          latestUserMessageAt: "2026-11-10T10:00:00.000Z",
        }),
        thread("asked", "2026-11-12T10:00:00.000Z", {
          latestUserMessageAt: "2026-11-12T10:00:00.000Z",
        }),
      ],
      delegatedUnderParent: new Set(),
      environmentId: null,
      projectOption: null,
    });
    expect(ids(sections.threads)).toEqual(["asked", "touched"]);
  });

  it("drops archived threads and threads shown under a parent", () => {
    const sections = buildMobileHomeSections({
      threads: [
        thread("kept", "2026-11-19T10:00:00.000Z"),
        thread("archived", "2026-11-19T11:00:00.000Z", {
          archivedAt: "2026-11-19T11:00:00.000Z",
        }),
        thread("child", "2026-11-19T12:00:00.000Z", {
          lineage: {
            rootThreadId: ThreadId.make("kept"),
            parentThreadId: ThreadId.make("kept"),
            relationshipToParent: "subagent",
          },
        }),
      ],
      delegatedUnderParent: new Set(),
      environmentId: null,
      projectOption: null,
    });
    expect(ids(sections.threads)).toEqual(["kept"]);
  });

  it("filters by environment and by the members of a project group", () => {
    const threads = [
      thread("mac-app", "2026-11-19T10:00:00.000Z"),
      thread("vps-app", "2026-11-19T09:00:00.000Z", {
        environmentId: vps,
        projectId: ProjectId.make("project-app-remote"),
      }),
      thread("mac-docs", "2026-11-19T08:00:00.000Z", { projectId: ProjectId.make("project-docs") }),
      running("vps-busy", "2026-11-19T07:00:00.000Z", {
        environmentId: vps,
        projectId: ProjectId.make("project-other"),
      }),
    ];
    const build = (environmentId: string | null, projectOption: MobileHomeProjectOption | null) =>
      buildMobileHomeSections({
        threads,
        delegatedUnderParent: new Set(),
        environmentId,
        projectOption,
      });

    expect(ids(build(vps, null).threads)).toEqual(["vps-app"]);
    expect(ids(build(vps, null).working)).toEqual(["vps-busy"]);
    expect(ids(build(null, appOption).threads)).toEqual(["mac-app", "vps-app"]);
    expect(ids(build(null, appOption).working)).toEqual([]);
    expect(ids(build(mac, appOption).threads)).toEqual(["mac-app"]);
    expect(ids(build(null, docsOption).threads)).toEqual(["mac-docs"]);
  });
});

describe("project filter options", () => {
  it("keeps only projects with a member on the chosen environment", () => {
    expect(filterMobileHomeProjectOptions([appOption, docsOption], null)).toEqual([
      appOption,
      docsOption,
    ]);
    expect(filterMobileHomeProjectOptions([appOption, docsOption], vps)).toEqual([appOption]);
  });

  it("clears stored choices that no longer exist or no longer match", () => {
    const resolve = (environmentId: string | null, projectKey: string | null) =>
      resolveMobileHomeFilters({
        filters: { environmentId, projectKey },
        environmentIds: [mac, vps],
        projectOptions: [appOption, docsOption],
      });
    expect(resolve(vps, "group-app")).toEqual({ environmentId: vps, projectKey: "group-app" });
    expect(resolve("environment-gone", "group-app")).toEqual({
      environmentId: null,
      projectKey: "group-app",
    });
    expect(resolve(null, "group-gone")).toEqual({ environmentId: null, projectKey: null });
    expect(resolve(vps, "group-docs")).toEqual({ environmentId: vps, projectKey: null });
  });
});

describe("resolveMobileNewThreadProject", () => {
  const fallbackProjects = [
    { environmentId: mac, id: ProjectId.make("project-docs") },
    { environmentId: vps, id: ProjectId.make("project-other") },
  ];

  it("starts in the filtered project on the filtered environment", () => {
    expect(
      resolveMobileNewThreadProject({
        environmentId: vps,
        projectOption: appOption,
        fallbackProjects,
      }),
    ).toEqual({ environmentId: vps, id: "project-app-remote" });
    expect(
      resolveMobileNewThreadProject({
        environmentId: null,
        projectOption: appOption,
        fallbackProjects,
      }),
    ).toEqual({ environmentId: mac, id: "project-app" });
  });

  it("falls back to the most recent project, preferring the filtered environment", () => {
    expect(
      resolveMobileNewThreadProject({ environmentId: null, projectOption: null, fallbackProjects }),
    ).toEqual({ environmentId: mac, id: "project-docs" });
    expect(
      resolveMobileNewThreadProject({ environmentId: vps, projectOption: null, fallbackProjects }),
    ).toEqual({ environmentId: vps, id: "project-other" });
    expect(
      resolveMobileNewThreadProject({
        environmentId: null,
        projectOption: null,
        fallbackProjects: [],
      }),
    ).toBeNull();
  });
});

describe("resolveMobileChatEnvironment", () => {
  const machineById = new Map([
    ["laptop", "laptop"],
    ["mini", "mac-mini"],
  ]);
  it("starts new chats on the Mac mini, else the first computer", () => {
    expect(resolveMobileChatEnvironment({ environmentIds: ["laptop", "mini"], machineById })).toBe(
      "mini",
    );
    expect(resolveMobileChatEnvironment({ environmentIds: ["laptop"], machineById })).toBe(
      "laptop",
    );
  });
});
