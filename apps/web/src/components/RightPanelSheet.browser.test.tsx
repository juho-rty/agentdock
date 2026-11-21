import { expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import appCss from "~/index.css?inline";
import { RightPanelSheet } from "./RightPanelSheet";

it("names the open right-panel dialog", async () => {
  await using _screen = await render(
    <RightPanelSheet open animationDurationMs={0} onClose={() => {}}>
      <div>Panel content</div>
    </RightPanelSheet>,
  );
  const dialog = page.getByRole("dialog");
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog).not.toHaveAccessibleName("");
});

it("covers the header's controls when it fills a phone", async () => {
  const size = [window.innerWidth, window.innerHeight] as const;
  await page.viewport(390, 844);
  const style = document.createElement("style");
  style.textContent = appCss;
  document.head.append(style);
  try {
    await using _screen = await render(
      <>
        {/* Stands in for the app shell's fixed control, which sits where the sheet's own does. */}
        <button type="button" className="fixed top-2 left-2 z-50 size-11">
          Shell control
        </button>
        <RightPanelSheet open animationDurationMs={0} onClose={() => {}}>
          <div className="size-full">Panel content</div>
        </RightPanelSheet>
      </>,
    );
    const dialog = page.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().contains(document.elementFromPoint(24, 24))).toBe(true);
  } finally {
    style.remove();
    await page.viewport(size[0], size[1]);
  }
});
