import * as Application from "expo-application";
import Constants from "expo-constants";
import { useSyncExternalStore } from "react";
import { AppState, Linking, Platform } from "react-native";

import {
  buildItmsServicesInstallUrl,
  DEFAULT_IOS_OTA_MANIFEST_URL,
  isNewerBuildVersion,
  parseManifestBundleVersion,
  resolveSigningExpiryInfo,
  type SigningExpiryInfo,
} from "./iosOtaModel";

const FOREGROUND_RECHECK_INTERVAL_MS = 10 * 60 * 1_000;
const MANIFEST_FETCH_TIMEOUT_MS = 5_000;

interface StoreState {
  readonly checking: boolean;
  readonly remoteBuild: string | null;
  readonly lastCheckedAt: number | null;
  readonly error: string | null;
  readonly dismissedBannerKey: string | null;
}

export interface IosOtaSnapshot {
  readonly supported: boolean;
  readonly installedBuild: string | null;
  readonly remoteBuild: string | null;
  readonly hasNewerBuild: boolean;
  readonly checking: boolean;
  readonly lastCheckedAt: number | null;
  readonly error: string | null;
  readonly expiry: SigningExpiryInfo | null;
  readonly bannerKey: string | null;
  readonly shouldShowBanner: boolean;
}

let state: StoreState = {
  checking: false,
  remoteBuild: null,
  lastCheckedAt: null,
  error: null,
  dismissedBannerKey: null,
};

let cachedSnapshot: IosOtaSnapshot | null = null;
let cachedDayBucket = -1;
const listeners = new Set<() => void>();
let appStateSubscriptionInstalled = false;
let inFlightCheck: Promise<{
  readonly ok: boolean;
  readonly hasNewerBuild: boolean;
  readonly remoteBuild: string | null;
  readonly error: string | null;
}> | null = null;

function notify() {
  cachedSnapshot = null;
  for (const listener of listeners) listener();
}

function getManifestUrl(): string {
  const configured = Constants.expoConfig?.extra?.otaManifestUrl;
  return typeof configured === "string" && configured.trim().length > 0
    ? configured.trim()
    : DEFAULT_IOS_OTA_MANIFEST_URL;
}

export function isIosPersonalTeamOtaSupported(): boolean {
  return Platform.OS === "ios" && Constants.expoConfig?.extra?.iosPersonalTeamBuild === true;
}

function computeSnapshot(): IosOtaSnapshot {
  const supported = isIosPersonalTeamOtaSupported();
  const installedBuild = Application.nativeBuildVersion ?? null;
  const provisioningExpiresAt =
    typeof Constants.expoConfig?.extra?.provisioningExpiresAt === "string"
      ? Constants.expoConfig.extra.provisioningExpiresAt
      : null;
  const expiry = supported
    ? resolveSigningExpiryInfo({
        provisioningExpiresAt,
        nativeBuildVersion: installedBuild,
      })
    : null;
  const hasNewerBuild = supported && isNewerBuildVersion(installedBuild, state.remoteBuild);
  const bannerKey = hasNewerBuild
    ? `build:${state.remoteBuild}`
    : expiry?.expiringSoon
      ? `expiry:${expiry.formattedDate}:${String(expiry.daysRemaining)}`
      : null;
  const shouldShowBanner =
    supported && bannerKey !== null && state.dismissedBannerKey !== bannerKey;

  return {
    supported,
    installedBuild,
    remoteBuild: state.remoteBuild,
    hasNewerBuild,
    checking: state.checking,
    lastCheckedAt: state.lastCheckedAt,
    error: state.error,
    expiry,
    bannerKey,
    shouldShowBanner,
  };
}

function getSnapshot(): IosOtaSnapshot {
  const dayBucket = Math.floor(Date.now() / (60 * 60 * 1_000));
  if (cachedSnapshot !== null && cachedDayBucket === dayBucket) {
    return cachedSnapshot;
  }
  cachedDayBucket = dayBucket;
  cachedSnapshot = computeSnapshot();
  return cachedSnapshot;
}

function ensureLifecycleInstalled() {
  if (appStateSubscriptionInstalled || !isIosPersonalTeamOtaSupported()) return;
  appStateSubscriptionInstalled = true;
  void checkIosOtaUpdate();
  AppState.addEventListener("change", (nextState) => {
    if (nextState !== "active") return;
    if (
      state.lastCheckedAt === null ||
      Date.now() - state.lastCheckedAt >= FOREGROUND_RECHECK_INTERVAL_MS
    ) {
      void checkIosOtaUpdate();
    } else {
      notify();
    }
  });
}

function subscribe(listener: () => void): () => void {
  ensureLifecycleInstalled();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useIosOtaUpdate(): IosOtaSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export async function checkIosOtaUpdate(): Promise<{
  readonly ok: boolean;
  readonly hasNewerBuild: boolean;
  readonly remoteBuild: string | null;
  readonly error: string | null;
}> {
  if (!isIosPersonalTeamOtaSupported()) {
    return { ok: false, hasNewerBuild: false, remoteBuild: null, error: null };
  }
  if (inFlightCheck) return inFlightCheck;

  state = { ...state, checking: true, error: null };
  notify();

  inFlightCheck = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MANIFEST_FETCH_TIMEOUT_MS);
    try {
      const separator = getManifestUrl().includes("?") ? "&" : "?";
      const response = await fetch(`${getManifestUrl()}${separator}_t=${String(Date.now())}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${String(response.status)}`);
      }
      const xml = await response.text();
      const remoteBuild = parseManifestBundleVersion(xml);
      if (!remoteBuild) {
        throw new Error("Manifest bundle-version missing");
      }
      const hasNewerBuild = isNewerBuildVersion(Application.nativeBuildVersion, remoteBuild);
      state = {
        ...state,
        checking: false,
        remoteBuild,
        lastCheckedAt: Date.now(),
        error: null,
      };
      notify();
      return { ok: true, hasNewerBuild, remoteBuild, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reach OTA server";
      state = {
        ...state,
        checking: false,
        lastCheckedAt: Date.now(),
        error: message,
      };
      notify();
      return { ok: false, hasNewerBuild: false, remoteBuild: state.remoteBuild, error: message };
    } finally {
      clearTimeout(timer);
      inFlightCheck = null;
    }
  })();

  return inFlightCheck;
}

export async function installIosOtaUpdate(): Promise<void> {
  const url = buildItmsServicesInstallUrl(getManifestUrl());
  await Linking.openURL(url);
}

export function dismissIosOtaBanner(): void {
  const currentKey = getSnapshot().bannerKey;
  if (!currentKey) return;
  state = { ...state, dismissedBannerKey: currentKey };
  notify();
}
