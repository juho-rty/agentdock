import { createFileRoute } from "@tanstack/react-router";

import { QuickAskView } from "../components/quickAsk/QuickAskView";

export const Route = createFileRoute("/quick-ask")({
  component: QuickAskView,
});
