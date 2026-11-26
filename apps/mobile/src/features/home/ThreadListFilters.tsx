import { useGT } from "gt-react-native";
import { Pressable, ScrollView, View } from "react-native";
import type { ThreadListMode } from "@t3tools/client-runtime/state/projects";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListFilterMenu } from "../layout/workspace/ListFilterMenu";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  HomeListFilterMenuEnvironment,
  HomeListFilterMenuProject,
} from "./home-list-filter-menu";
import type { HomeThreadSortOrder } from "./home-list-options";

export function ThreadListFilters(props: {
  readonly environments: ReadonlyArray<HomeListFilterMenuEnvironment>;
  readonly projects: ReadonlyArray<HomeListFilterMenuProject>;
  readonly selectedEnvironmentId: EnvironmentId | null;
  readonly selectedProjectKey: string | null;
  readonly onEnvironmentChange: (environmentId: EnvironmentId | null) => void;
  readonly onProjectChange: (projectKey: string | null) => void;
  readonly threadMode: ThreadListMode;
  readonly onThreadModeChange: (mode: ThreadListMode) => void;
  readonly threadSortOrder: HomeThreadSortOrder;
  readonly onThreadSortOrderChange: (sortOrder: HomeThreadSortOrder) => void;
  /** List padding the scroller bleeds through so pills start where row content does. */
  readonly gutter: number;
}) {
  const gt = useGT();
  const selectedEnvironment = props.environments.find(
    (environment) => environment.environmentId === props.selectedEnvironmentId,
  );
  const selectedProject = props.projects.find(
    (project) => project.key === props.selectedProjectKey,
  );
  return (
    <View>
      <View style={{ marginHorizontal: 20 - props.gutter, paddingTop: 2, paddingBottom: 10 }}>
        <SegmentedControl
          options={[
            {
              value: "agent",
              label: gt("Agent", { $context: "thread list mode: project threads" }),
            },
            { value: "chat", label: gt("Chat", { $context: "thread list mode: plain chats" }) },
          ]}
          selected={props.threadMode}
          onSelect={props.onThreadModeChange}
          size="compact"
          role="tab"
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -props.gutter, overflow: "visible" }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 2,
          paddingBottom: 10,
          gap: 8,
        }}
      >
        {props.threadMode === "chat" ? null : (
          <>
            <ListFilterMenu
              label={selectedEnvironment?.label ?? gt("All environments")}
              accessibilityLabel={gt("Filter threads by environment")}
              active={selectedEnvironment !== undefined}
              actions={[
                {
                  id: "all",
                  title: gt("All environments"),
                  state: props.selectedEnvironmentId === null ? "on" : "off",
                },
                ...props.environments.map((environment) => ({
                  id: JSON.stringify(environment.environmentId),
                  title: environment.label,
                  state:
                    environment.environmentId === props.selectedEnvironmentId
                      ? ("on" as const)
                      : ("off" as const),
                })),
              ]}
              onSelect={(id) => {
                if (id === "all") props.onEnvironmentChange(null);
                else {
                  const environment = props.environments.find(
                    (candidate) => JSON.stringify(candidate.environmentId) === id,
                  );
                  if (environment) props.onEnvironmentChange(environment.environmentId);
                }
              }}
            />
            <ListFilterMenu
              label={selectedProject?.label ?? gt("All projects")}
              accessibilityLabel={gt("Filter threads by project")}
              active={selectedProject !== undefined}
              actions={[
                {
                  id: "all",
                  title: gt("All projects"),
                  state: props.selectedProjectKey === null ? "on" : "off",
                },
                ...props.projects.map((project) => ({
                  id: JSON.stringify(project.key),
                  title: project.label,
                  state:
                    project.key === props.selectedProjectKey ? ("on" as const) : ("off" as const),
                })),
              ]}
              onSelect={(id) => {
                if (id === "all") props.onProjectChange(null);
                else {
                  const project = props.projects.find(
                    (candidate) => JSON.stringify(candidate.key) === id,
                  );
                  if (project) props.onProjectChange(project.key);
                }
              }}
            />
          </>
        )}
        <ListFilterMenu
          label={props.threadSortOrder === "recent" ? gt("Newest first") : gt("Sort")}
          accessibilityLabel={gt("Sort")}
          active={props.threadSortOrder === "recent"}
          actions={[
            {
              id: "default",
              title: gt("Default"),
              state: props.threadSortOrder === "default" ? "on" : "off",
            },
            {
              id: "recent",
              title: gt("Newest first"),
              state: props.threadSortOrder === "recent" ? "on" : "off",
            },
          ]}
          onSelect={(id) => props.onThreadSortOrderChange(id === "recent" ? "recent" : "default")}
        />
        {props.threadMode !== "chat" &&
        (props.selectedEnvironmentId !== null || props.selectedProjectKey !== null) ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={gt("Reset thread filters")}
            className="h-8 w-8 items-center justify-center"
            onPress={() => {
              props.onEnvironmentChange(null);
              props.onProjectChange(null);
            }}
          >
            <SymbolView name="xmark.circle.fill" size={18} tintColorClassName="accent-icon-muted" />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
