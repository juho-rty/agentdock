import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";

/** Defers evaluating secondary route modules until navigated to while preserving exact screen types. */
export function lazyScreen<Screen extends ComponentType<any>>(
  load: () => Promise<{ readonly default: Screen }>,
): Screen {
  const LazyComponent = lazy(load);
  function DeferredScreen(props: ComponentProps<Screen>) {
    return (
      <Suspense fallback={null}>
        <LazyComponent {...props} />
      </Suspense>
    );
  }
  return DeferredScreen as unknown as Screen;
}
