import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { useState } from "react";
import { page, userEvent } from "vite-plus/test/browser";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { render } from "../../../test/render";
import { makeThreadFixture } from "../../test-fixtures";
import type { Thread } from "../../types";
import { MobileHomeView } from "./MobileHome";
import {
  buildMobileHomeSections,
  NO_MOBILE_HOME_FILTERS,
  type MobileHomeFilters,
  type MobileHomeProjectOption,
} from "./MobileHome.logic";
import { MobileTabBarView } from "./MobileTabBar";

const mac = EnvironmentId.make("environment-mac");
const vps = EnvironmentId.make("environment-vps");
const appProjectId = ProjectId.make("project-app");
const serverProjectId = ProjectId.make("project-server");

function project(environmentId: EnvironmentId, id: ProjectId, title: string) {
  return {
    id,
    environmentId,
    title,
    workspaceRoot: `/work/${title}`,
    repositoryIdentity: null,
    defaultModelSelection: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    scripts: [],
    projectIcon: { kind: "monogram", text: title.slice(0, 2).toUpperCase(), color: "blue" },
  } as unknown as EnvironmentProject;
}

function thread(
  id: string,
  title: string,
  updatedAt: string,
  overrides: Partial<Thread> & { environmentId?: EnvironmentId } = {},
): Thread {
  const base = makeThreadFixture({
    id: ThreadId.make(id),
    environmentId: overrides.environmentId ?? mac,
    projectId: overrides.projectId ?? appProjectId,
    title,
  });
  return { ...base, updatedAt, ...overrides };
}

const threads = [
  thread("thread-old", "Fix the login redirect", "2026-11-17T10:00:00.000Z"),
  thread("thread-new", "Port the settings page to the new layout", "2026-11-19T10:00:00.000Z"),
  thread("thread-remote", "Tune the nightly backup", "2026-11-18T10:00:00.000Z", {
    environmentId: vps,
    projectId: serverProjectId,
  }),
  thread("thread-busy", "Refactor the relay", "2026-11-19T09:00:00.000Z", {
    runtime: {
      status: "running",
      providerName: "Codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      activeRunId: null,
      lastError: null,
      updatedAt: "2026-11-19T09:00:00.000Z",
    },
  }),
];

const projectOptions: MobileHomeProjectOption[] = [
  {
    projectKey: "group-app",
    displayName: "App",
    members: [{ environmentId: mac, id: appProjectId }],
  },
  {
    projectKey: "group-server",
    displayName: "Server",
    members: [{ environmentId: vps, id: serverProjectId }],
  },
];

function Home(props: { readonly onSearch: () => void }) {
  const [filters, setFilters] = useState<MobileHomeFilters>(NO_MOBILE_HOME_FILTERS);
  const [workingExpanded, setWorkingExpanded] = useState(true);
  return (
    <>
      <MobileHomeView
        environments={[
          { environmentId: mac, label: "MacBook" },
          { environmentId: vps, label: "Build server" },
        ]}
        projectOptions={projectOptions}
        filters={filters}
        onFiltersChange={setFilters}
        sections={buildMobileHomeSections({
          threads,
          delegatedUnderParent: new Set(),
          environmentId: filters.environmentId,
          projectOption:
            projectOptions.find((option) => option.projectKey === filters.projectKey) ?? null,
        })}
        loaded
        workingExpanded={workingExpanded}
        onWorkingExpandedChange={setWorkingExpanded}
        onSearch={props.onSearch}
        context={{
          projectByKey: new Map([
            [`${mac}:${appProjectId}`, project(mac, appProjectId, "App")],
            [`${vps}:${serverProjectId}`, project(vps, serverProjectId, "Server")],
          ]),
          environmentLabelById: new Map([
            [mac, "MacBook"],
            [vps, "Build server"],
          ]),
          machineById: new Map(),
          providerEntriesByEnvironment: new Map(),
        }}
      />
      <MobileTabBarView
        activeTab="threads"
        pullRequestsSupported
        onNewThread={() => {}}
        variant="floating"
      />
    </>
  );
}

const rowIds = (root: ParentNode) =>
  [...root.querySelectorAll("[data-mobile-thread-row]")].map((row) =>
    row.getAttribute("data-mobile-thread-row"),
  );

describe("phone home", () => {
  it("lists threads newest first with a Working section and the floating tab bar", async () => {
    await page.viewport(390, 844);
    const onSearch = vi.fn();
    await using screen = await render(<Home onSearch={onSearch} />);

    await expect.element(screen.getByRole("heading", { name: "AgentDock" })).toBeVisible();
    expect(rowIds(screen.container)).toEqual([
      "thread-new",
      "thread-remote",
      "thread-old",
      "thread-busy",
    ]);
    const working = screen.getByRole("list", { name: "Working" });
    await expect.element(working).toBeVisible();
    expect(rowIds(working.element())).toEqual(["thread-busy"]);
    await expect.element(screen.getByText("Build server")).toBeVisible();

    // The row fits the phone: nothing scrolls sideways.
    const scroller = screen.container.querySelector("[data-mobile-home] > div")!;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(390);
    const row = screen.container.querySelector('[data-mobile-thread-row="thread-new"]')!;
    expect(row.getAttribute("href")).toBe("/environment-mac/thread-new");

    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onSearch).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Working" }));
    expect(rowIds(screen.container)).not.toContain("thread-busy");
    await expect.element(screen.getByRole("button", { name: "Working (1)" })).toBeVisible();

    // The bar floats at the bottom edge, with the new-thread button to its right.
    const bar = screen.getByRole("navigation", { name: "Main tabs" });
    const barRect = bar.element().getBoundingClientRect();
    expect(Math.round(barRect.bottom)).toBe(844);
    const tabs = bar.getByRole("link").elements();
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Threads",
      "Pull requests",
      "Usage",
      "Settings",
    ]);
    expect(tabs[0]?.getAttribute("aria-current")).toBe("page");
    const newThread = bar.getByRole("button", { name: "New thread" }).element();
    expect(newThread.getBoundingClientRect().left).toBeGreaterThan(
      tabs[3]!.getBoundingClientRect().right,
    );
  });

  it("filters the list by environment and resets", async () => {
    await page.viewport(390, 844);
    await using screen = await render(<Home onSearch={() => {}} />);

    await userEvent.click(screen.getByRole("button", { name: "Filter threads by environment" }));
    await userEvent.click(page.getByRole("menuitemradio", { name: "Build server" }));
    await vi.waitFor(() => expect(rowIds(screen.container)).toEqual(["thread-remote"]));

    await userEvent.click(screen.getByRole("button", { name: "Reset thread filters" }));
    await vi.waitFor(() => expect(rowIds(screen.container)).toHaveLength(4));
  });
});
