import type { AppRouter } from "./router";

export const QUICK_ASK_PATH = "/quick-ask";

/** The tray popover loads the app at this hash route and must skip main-window services. */
export function isQuickAskWindow(location: Pick<Location, "hash"> = window.location): boolean {
  return (
    window.desktopBridge?.quickAskClose !== undefined &&
    (location.hash === `#${QUICK_ASK_PATH}` || location.hash.startsWith(`#${QUICK_ASK_PATH}?`))
  );
}

/** Only in-app routes from the desktop shell; anything else is ignored. */
function isDesktopNavigationPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\");
}

/** Lets Quick Ask route the main window, including to a route chosen before this window loaded. */
export function startDesktopNavigation(router: AppRouter): void {
  const bridge = window.desktopBridge;
  if (!bridge?.onNavigate) return;
  const navigate = (path: string) => {
    if (isDesktopNavigationPath(path)) router.history.push(path);
  };
  bridge.onNavigate(navigate);
  void bridge
    .takePendingNavigation?.()
    .then((path) => {
      if (path !== null) navigate(path);
    })
    .catch(() => undefined);
}
