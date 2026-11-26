import Svg, { Rect } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedRect = withUniwind(Rect);

// viewBox 0 0 24 24; same geometry as the tray icon and the web AgentDockMark.
const MARK_RECTS = [
  { x: 2, y: 9, width: 7, height: 8, rx: 3, opacity: 0.55 },
  { x: 15, y: 9, width: 7, height: 8, rx: 3, opacity: 0.55 },
  { x: 7, y: 4, width: 10, height: 13, rx: 4.5, opacity: 1 },
  { x: 3, y: 18.5, width: 18, height: 3, rx: 1.5, opacity: 1 },
] as const;

/** The colorless AgentDock mark, drawn in the theme foreground. */
export function AgentDockMark(props: { readonly size: number; readonly colorClassName?: string }) {
  return (
    <Svg width={props.size} height={props.size} viewBox="0 0 24 24" accessible={false}>
      {MARK_RECTS.map(({ opacity, ...rect }) => (
        <ThemedRect
          key={`${rect.x}-${rect.y}`}
          {...rect}
          colorClassName={props.colorClassName ?? "accent-foreground"}
          fill="currentColor"
          fillOpacity={opacity}
        />
      ))}
    </Svg>
  );
}
