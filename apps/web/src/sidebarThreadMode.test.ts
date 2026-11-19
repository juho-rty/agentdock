import { describe, expect, it } from "vite-plus/test";

import { chatProjectKeys, filterThreadsForMode, withoutChatProjects } from "./sidebarThreadMode";

const projects = [
  { environmentId: "env", id: "app" },
  { environmentId: "env", id: "chats", isChat: true as const },
];
const threads = [
  { id: "t1", environmentId: "env", projectId: "app" },
  { id: "t2", environmentId: "env", projectId: "chats" },
  { id: "t3", environmentId: "other", projectId: "chats" },
];

describe("sidebarThreadMode", () => {
  it("lists project threads in Agent and chat threads in Chat", () => {
    const keys = chatProjectKeys(projects);
    expect(filterThreadsForMode(threads, "agent", keys).map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(filterThreadsForMode(threads, "chat", keys).map((t) => t.id)).toEqual(["t2"]);
  });

  it("shows nothing in Chat without a chat project", () => {
    expect(filterThreadsForMode(threads, "chat", new Set())).toEqual([]);
    expect(filterThreadsForMode(threads, "agent", new Set())).toBe(threads);
  });

  it("drops chat projects from project lists", () => {
    expect(withoutChatProjects(projects).map((p) => p.id)).toEqual(["app"]);
  });
});
