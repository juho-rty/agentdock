import { describe, expect, it } from "vite-plus/test";

import {
  normalizeFinderOutput,
  parseExplorerWindows,
  pickExplorerFolder,
} from "./FileManagerFolder.ts";

const existing = (paths: ReadonlyArray<string>) => (path: string) => paths.includes(path);

describe("normalizeFinderOutput", () => {
  it.each([
    ["/Users/me/Projects/app/\n", ["/Users/me/Projects/app"], "/Users/me/Projects/app"],
    ["/\n", ["/"], "/"],
    ["\n", ["/"], null],
    ["/Volumes/Gone/\n", [], null],
  ])("normalizes %j", (output, paths, expected) => {
    expect(normalizeFinderOutput(output, existing(paths))).toBe(expected);
  });
});

describe("parseExplorerWindows", () => {
  it.each([
    ["", []],
    ["not json", []],
    ["null", []],
    ['{"hwnd":1}', [{ hwnd: 1 }]],
    ['[{"hwnd":1},{"hwnd":2}]', [{ hwnd: 1 }, { hwnd: 2 }]],
  ])("parses %j", (output, expected) => {
    expect(parseExplorerWindows(output)).toEqual(expected);
  });
});

describe("pickExplorerFolder", () => {
  it("prefers the front visible window over minimized and back windows", () => {
    const entries = [
      { hwnd: 1, z: 0, min: true, name: "a", title: "a", path: "C:\\min" },
      { hwnd: 2, z: 9, min: false, name: "b", title: "b", path: "C:\\back" },
      { hwnd: 3, z: 4, min: false, name: "c", title: "c", path: "C:\\front\\" },
    ];
    expect(pickExplorerFolder(entries, existing(["C:\\min", "C:\\back", "C:\\front"]))).toBe(
      "C:\\front",
    );
  });

  it("uses the active tab of a tabbed window", () => {
    const entries = [
      { hwnd: 7, z: 1, name: "docs", title: "src - File Explorer", path: "D:\\docs" },
      { hwnd: 7, z: 1, name: "src", title: "src - File Explorer", path: "D:\\repo\\src" },
    ];
    expect(pickExplorerFolder(entries, existing(["D:\\docs", "D:\\repo\\src"]))).toBe(
      "D:\\repo\\src",
    );
  });

  it("skips virtual folders and missing paths, keeps drive roots and UNC shares", () => {
    const exists = existing(["E:\\", "\\\\nas\\share"]);
    expect(
      pickExplorerFolder(
        [
          { hwnd: 1, z: 0, path: "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}" },
          { hwnd: 2, z: 1, path: "C:\\deleted" },
          { hwnd: 3, z: 2, path: "E:\\" },
        ],
        exists,
      ),
    ).toBe("E:\\");
    expect(pickExplorerFolder([{ hwnd: 4, z: 0, path: "\\\\nas\\share\\" }], exists)).toBe(
      "\\\\nas\\share",
    );
    expect(pickExplorerFolder([], exists)).toBeNull();
  });
});
