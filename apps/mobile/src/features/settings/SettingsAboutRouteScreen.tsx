import { T, useGT } from "gt-react-native";
import * as Dialog from "../../components/ui/Dialog";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import * as Application from "expo-application";
import Constants from "expo-constants";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { useDeadlinePassed } from "../../lib/clock";
import {
  type AppUpdateCheckState,
  isAppUpdateCheckAvailable,
  registerHiddenUpdateTap,
  runAppUpdateCheck,
} from "../updates/app-updates";
import { checkIosOtaUpdate, installIosOtaUpdate, useIosOtaUpdate } from "../updates/iosOtaUpdate";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";

export function SettingsAboutRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const ota = useIosOtaUpdate();

  return (
    <SettingsScreen title={gt("About")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <AppSettingsSection />
        {ota.supported ? <IosWirelessUpdateSection /> : null}
      </ScrollView>
    </SettingsScreen>
  );
}

function IosWirelessUpdateSection() {
  const gt = useGT();
  const ota = useIosOtaUpdate();
  const [confirmedCurrentUntil, setConfirmedCurrentUntil] = useState<number | null>(null);
  const confirmationExpired = useDeadlinePassed(confirmedCurrentUntil);
  const showUpToDate =
    confirmedCurrentUntil !== null && !confirmationExpired && !ota.hasNewerBuild && !ota.checking;

  async function handleManualCheck() {
    const outcome = await checkIosOtaUpdate();
    if (!outcome.ok && outcome.error) {
      Dialog.alert(
        gt("Update check failed"),
        gt("Make sure Tailscale is connected ({reason}).", { reason: outcome.error }),
      );
      return;
    }
    if (!outcome.hasNewerBuild) {
      setConfirmedCurrentUntil(Date.now() + 3_000);
    }
  }

  async function handleInstall() {
    try {
      await installIosOtaUpdate();
    } catch (error) {
      Dialog.alert(
        gt("Update failed"),
        error instanceof Error ? error.message : gt("Could not start wireless installation."),
      );
    }
  }

  const expiry = ota.expiry;
  const expiryValue = expiry
    ? expiry.expired
      ? gt("Expired")
      : gt("{days}d left", { days: expiry.daysRemaining })
    : null;

  return (
    <SettingsSection title={gt("Wireless Update")}>
      {expiry ? (
        <View className="flex-row items-center gap-4 border-b border-border p-4">
          <SymbolView
            name={expiry.expiringSoon ? "exclamationmark.triangle" : "checkmark.circle"}
            size={22}
            tintColorClassName={expiry.expiringSoon ? "accent-primary-text" : "accent-icon"}
            type="monochrome"
            weight="regular"
          />
          <Text className="flex-1 text-lg text-foreground">
            <T>Signing</T>
          </Text>
          <View className="items-end">
            <Text className="text-lg text-foreground-muted">{expiryValue}</Text>
            <Text className="text-xs text-foreground-muted/70">{expiry.formattedDate}</Text>
          </View>
        </View>
      ) : null}
      <SettingsActionRow
        icon="arrow.clockwise"
        label={
          ota.hasNewerBuild && ota.remoteBuild
            ? gt("Build {build} available", { build: ota.remoteBuild })
            : showUpToDate
              ? gt("Up to date")
              : gt("Check for wireless update")
        }
        disabled={ota.checking}
        loading={ota.checking}
        onPress={() => void handleManualCheck()}
      />
      <SettingsActionRow
        icon="arrow.up.circle"
        label={
          ota.hasNewerBuild && ota.remoteBuild
            ? gt("Install wireless update ({build})", { build: ota.remoteBuild })
            : gt("Reinstall wireless build")
        }
        onPress={() => void handleInstall()}
      />
    </SettingsSection>
  );
}

function AppSettingsSection() {
  const gt = useGT();
  const [checkState, setCheckState] = useState<{
    readonly state: AppUpdateCheckState;
    // "Up to date" is a confirmation that fades back to idle.
    readonly settledUntil: number | null;
  }>({ state: "idle", settledUntil: null });
  const confirmationExpired = useDeadlinePassed(checkState.settledUntil);
  const updateState =
    checkState.state === "current" && confirmationExpired ? "idle" : checkState.state;
  const updateInFlight = useRef(false);
  const hiddenUpdateTapCount = useRef(0);

  const version = Constants.expoConfig?.version ?? "0.0.0";
  // Match app.config.ts's production fallback to avoid mislabeling builds as development.
  const variant = (Constants.expoConfig?.extra?.appVariant as string | undefined) ?? "production";
  const variantLabel = variant === "production" ? "" : capitalize(variant);
  // EAS assigns build numbers remotely; only the installed binary knows its own.
  const build = Application.nativeBuildVersion;
  const versionWithBuild = build ? `${version} (${build})` : version;
  const versionLabel = variantLabel ? `${versionWithBuild} · ${variantLabel}` : versionWithBuild;
  const updateCheckAvailable = isAppUpdateCheckAvailable();
  const busy =
    updateState === "checking" || updateState === "downloading" || updateState === "restarting";

  async function checkForUpdate() {
    // disabled updates next render; the ref blocks same-frame double taps.
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    // Failures arrive through onFailure; the settled result only matters for unlocking.
    await settlePromise(() =>
      runAppUpdateCheck({
        applyMode: "immediate",
        onFailure: (message) => Dialog.alert(gt("Update failed"), message),
        onStateChange: (state) =>
          setCheckState({
            state,
            settledUntil: state === "current" ? Date.now() + 3000 : null,
          }),
      }),
    );
    updateInFlight.current = false;
  }

  function handleVersionPress() {
    if (!updateCheckAvailable || updateInFlight.current) return;
    const tap = registerHiddenUpdateTap(hiddenUpdateTapCount.current);
    hiddenUpdateTapCount.current = tap.nextCount;
    if (tap.shouldCheck) {
      void checkForUpdate();
    }
  }

  const statusLabel =
    updateState === "checking"
      ? gt("Checking…")
      : updateState === "downloading"
        ? gt("Downloading…")
        : updateState === "ready"
          ? gt("Update ready")
          : updateState === "restarting"
            ? gt("Restarting…")
            : updateState === "current"
              ? gt("Up to date")
              : null;

  const versionRow = (
    <View className="flex-row items-center gap-4 p-4">
      <SymbolView
        name="info.circle"
        size={22}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="regular"
      />
      <Text className="flex-1 text-lg text-foreground">
        <T>Version</T>
      </Text>
      <View className="items-end">
        <Text className="text-lg text-foreground-muted">{versionLabel}</Text>
        {statusLabel ? (
          <Text className="text-xs text-foreground-muted/70">{statusLabel}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <SettingsSection title={gt("App", { $context: "settings section about this mobile app" })}>
      <SettingsRow
        icon="internaldrive"
        label={gt("Client Storage")}
        target="SettingsClientStorage"
      />
      <SettingsRow icon="stethoscope" label={gt("Diagnostics")} target="SettingsDiagnostics" />
      <SettingsRow
        icon="doc.on.doc"
        label={gt("Open source licenses")}
        target="SettingsOpenSourceLicenses"
      />
      <SettingsRow icon="doc.text" label={gt("Legal")} fullScreenTarget="SettingsLegal" />
      {updateCheckAvailable ? (
        <Pressable
          accessibilityLabel={gt("Version {version}", { version: versionLabel })}
          accessibilityRole="text"
          disabled={busy}
          onPress={handleVersionPress}
        >
          {versionRow}
        </Pressable>
      ) : (
        versionRow
      )}
    </SettingsSection>
  );
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}
