import Constants from "expo-constants";

/** True when built as the streamlined AgentDock iPhone client (Option A). */
export function isMobileLiteBuild(): boolean {
  return Constants.expoConfig?.extra?.liteBuild === true;
}
