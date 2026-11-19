export interface QuickAskRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const QUICK_ASK_WIDTH = 390;
export const QUICK_ASK_INITIAL_HEIGHT = 420;
const SCREEN_MARGIN = 8;
const MENU_BAR_GAP = 4;

/** Electron reports all-zero tray bounds on some Linux and Windows shells. */
export function hasTrayBounds(bounds: QuickAskRect | null): bounds is QuickAskRect {
  return (
    bounds !== null && (bounds.width > 0 || bounds.height > 0 || bounds.x !== 0 || bounds.y !== 0)
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function clampQuickAskHeight(height: number, workArea: QuickAskRect): number {
  const maxHeight = Math.max(1, workArea.height - SCREEN_MARGIN * 2);
  return Math.round(clamp(Number.isFinite(height) ? height : 0, 1, maxHeight));
}

/**
 * macOS hangs the popover under its menu bar icon. Elsewhere it sits in the corner
 * nearest the tray: the top when the taskbar is at the top, otherwise the bottom.
 */
export function resolveQuickAskPosition(input: {
  readonly trayBounds: QuickAskRect | null;
  readonly cursor: { readonly x: number; readonly y: number };
  readonly workArea: QuickAskRect;
  readonly width: number;
  readonly height: number;
  readonly platform: NodeJS.Platform;
}): { readonly x: number; readonly y: number } {
  const { workArea: area, width } = input;
  const height = clampQuickAskHeight(input.height, area);
  const anchor = hasTrayBounds(input.trayBounds)
    ? input.trayBounds
    : { x: input.cursor.x, y: input.cursor.y, width: 0, height: 0 };
  const minX = area.x + SCREEN_MARGIN;
  const maxX = Math.max(minX, area.x + area.width - width - SCREEN_MARGIN);
  const x = clamp(anchor.x + anchor.width / 2 - width / 2, minX, maxX);
  const minY = area.y + SCREEN_MARGIN;
  const maxY = Math.max(minY, area.y + area.height - height - SCREEN_MARGIN);
  if (input.platform === "darwin") {
    return {
      x: Math.round(x),
      y: Math.round(clamp(anchor.y + anchor.height + MENU_BAR_GAP, area.y, maxY)),
    };
  }
  const trayAtTop = anchor.y < area.y + SCREEN_MARGIN && anchor.height > 0;
  return { x: Math.round(x), y: Math.round(trayAtTop ? minY : maxY) };
}
