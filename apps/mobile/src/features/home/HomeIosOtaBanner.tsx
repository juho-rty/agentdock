import { useGT } from "gt-react-native";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { dismissIosOtaBanner, installIosOtaUpdate, useIosOtaUpdate } from "../updates/iosOtaUpdate";

export function HomeIosOtaBanner() {
  const gt = useGT();
  const ota = useIosOtaUpdate();

  if (!ota.shouldShowBanner) return null;

  const message =
    ota.hasNewerBuild && ota.remoteBuild
      ? gt("Wireless update ready ({build})", { build: ota.remoteBuild })
      : ota.expiry?.expired
        ? gt("Signing expired: reinstall wirelessly")
        : gt("Signing expires in {days}d: refresh wirelessly", {
            days: ota.expiry?.daysRemaining ?? 0,
          });

  const handleInstall = async () => {
    try {
      await installIosOtaUpdate();
    } catch (error) {
      Dialog.alert(
        gt("Update failed"),
        error instanceof Error ? error.message : gt("Could not start wireless installation."),
      );
    }
  };

  return (
    <View className="mx-4 mb-2 flex-row items-center gap-2.5 rounded-2xl border border-border-subtle bg-grouped-card px-3.5 py-2.5">
      <SymbolView
        name={ota.hasNewerBuild ? "arrow.up.circle" : "exclamationmark.triangle"}
        size={17}
        tintColorClassName="accent-primary-text"
        type="monochrome"
        weight="medium"
      />
      <Text numberOfLines={1} className="flex-1 text-[13px] font-t3-medium text-foreground">
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        className="rounded-full bg-foreground px-3 py-1.5 active:opacity-75"
        onPress={() => void handleInstall()}
      >
        <Text className="text-xs font-t3-semibold text-background">
          {gt("Update", { $context: "verb, install an update" })}
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel={gt("Dismiss")}
        accessibilityRole="button"
        hitSlop={8}
        className="size-6 items-center justify-center rounded-full active:opacity-60"
        onPress={dismissIosOtaBanner}
      >
        <SymbolView
          name="xmark"
          size={12}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
      </Pressable>
    </View>
  );
}
