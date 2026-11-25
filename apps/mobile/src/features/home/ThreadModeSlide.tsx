import type { ThreadListMode } from "@t3tools/client-runtime/state/projects";
import type { ReactNode } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

const SLIDE_DISTANCE = 72;
const SLIDE_DURATION_MS = 260;

/**
 * Slides list content in from the side of the newly picked Agent/Chat tab.
 * One shared value drives every row, so recycled rows stay in step.
 */
export function useThreadModeSlide(): {
  readonly progress: SharedValue<number>;
  readonly slideTo: (mode: ThreadListMode) => void;
} {
  const progress = useSharedValue(0);
  // Chat sits to the right of Agent, so it enters from the right.
  const slideTo = (mode: ThreadListMode) =>
    progress.set(
      withSequence(
        withTiming(mode === "chat" ? 1 : -1, { duration: 0 }),
        withTiming(0, { duration: SLIDE_DURATION_MS, easing: Easing.out(Easing.cubic) }),
      ),
    );
  return { progress, slideTo };
}

export function ThreadModeSlide(props: {
  readonly progress: SharedValue<number>;
  readonly children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(props.progress.get())) * 0.85,
    transform: [{ translateX: props.progress.get() * SLIDE_DISTANCE }],
  }));
  return <Animated.View style={style}>{props.children}</Animated.View>;
}
