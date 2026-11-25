import { useGT } from "gt-react-native";
import { Pressable } from "react-native";

import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";
import { SymbolView } from "../../components/ui/AppSymbol";

/** Toggles the composer's camera tray, which also offers the photo library and files. */
export function ComposerAttachmentButton(props: {
  readonly disabled?: boolean;
  readonly size?: "regular" | "large";
  readonly open: boolean;
  readonly onPress: () => void;
}) {
  const gt = useGT();
  const { scale } = useAndroidControlSizing();
  return (
    <Pressable
      accessibilityLabel={props.open ? gt("Close attachments") : gt("Add attachment")}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled, expanded: props.open }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <SymbolView
        name={props.open ? "xmark" : "plus"}
        size={Math.round((props.size === "large" ? 26 : 20) * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    </Pressable>
  );
}
