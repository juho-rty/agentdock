import type { SVGProps } from "react";

/** One-color AgentDock mark (three agents on a dock) for small inline icons. */
export function AgentDockMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="9" width="7" height="8" rx="3" opacity="0.55" />
      <rect x="15" y="9" width="7" height="8" rx="3" opacity="0.55" />
      <rect x="7" y="4" width="10" height="13" rx="4.5" />
      <rect x="3" y="18.5" width="18" height="3" rx="1.5" />
    </svg>
  );
}
