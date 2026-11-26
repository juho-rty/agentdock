import { useIsFocused } from "@react-navigation/native";
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useGT } from "gt-react-native";
import { useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { SymbolView } from "../../components/ui/AppSymbol";

const PANEL_HEIGHT = 300;
const MAX_CAPTURE_EDGE = 1920;
const CAPTURE_JPEG_QUALITY = 0.82;

function subscribeAppState(onStoreChange: () => void) {
  const subscription = AppState.addEventListener("change", onStoreChange);
  return () => subscription.remove();
}

function getAppActiveSnapshot() {
  return AppState.currentState === "active";
}

function nextFlashMode(mode: FlashMode): FlashMode {
  if (mode === "off") return "auto";
  if (mode === "auto") return "on";
  return "off";
}

async function optimizeCapturedPhoto(photo: {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}): Promise<string> {
  const longestEdge = Math.max(photo.width, photo.height);
  if (longestEdge <= MAX_CAPTURE_EDGE) return photo.uri;
  const scale = MAX_CAPTURE_EDGE / longestEdge;
  const targetSize = {
    width: Math.max(1, Math.round(photo.width * scale)),
    height: Math.max(1, Math.round(photo.height * scale)),
  };
  try {
    const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
    const rendered = await ImageManipulator.manipulate(photo.uri).resize(targetSize).renderAsync();
    try {
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: CAPTURE_JPEG_QUALITY,
      });
      try {
        const { File } = await import("expo-file-system");
        const original = new File(photo.uri);
        if (original.exists) original.delete();
      } catch {
        // Best-effort cleanup of the full-sensor camera cache file.
      }
      return saved.uri;
    } finally {
      rendered.release();
    }
  } catch {
    return photo.uri;
  }
}

async function takeAndCapturePhoto(
  cameraView: CameraView,
  onCapture: (uri: string) => Promise<void>,
): Promise<void> {
  try {
    const photo = await cameraView.takePictureAsync({ quality: 0.85, exif: false });
    if (photo?.uri) {
      const optimizedUri = await optimizeCapturedPhoto(photo);
      await onCapture(optimizedUri);
    }
  } catch (error) {
    console.warn("[composer-camera] capture failed", error);
  }
}

/**
 * Live camera shown under the composer, like ChatGPT's attachment tray:
 * the shutter adds a photo to the draft and the panel stays open for more.
 */
export function ComposerCameraPanel(props: {
  readonly supportsFiles: boolean;
  readonly onCapture: (uri: string) => Promise<void>;
  readonly onPickMedia: () => Promise<void>;
  readonly onPickFiles: () => Promise<void>;
  readonly onClose: () => void;
}) {
  const gt = useGT();
  const camera = useRef<CameraView>(null);
  const isFocused = useIsFocused();
  const appActive = useSyncExternalStore(subscribeAppState, getAppActiveSnapshot);
  // Asks on first open, like ChatGPT's tray; later opens reuse the answer.
  const [permission, requestPermission] = useCameraPermissions({ request: true });
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const granted = permission?.granted === true;
  const cameraActive = granted && isFocused && appActive;

  const capture = async () => {
    const cameraView = camera.current;
    if (!cameraView || capturing || !ready || !cameraActive) return;
    setCapturing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await takeAndCapturePhoto(cameraView, props.onCapture);
    setCapturing(false);
  };

  const pickFrom = (pick: () => Promise<void>) => {
    props.onClose();
    void pick();
  };

  const flashIcon =
    flash === "on" ? "bolt.fill" : flash === "auto" ? "bolt.circle" : "bolt.slash.fill";
  const flashLabel =
    flash === "on" ? gt("Flash on") : flash === "auto" ? gt("Flash auto") : gt("Flash off");

  return (
    <Animated.View
      entering={FadeIn.duration(160)}
      exiting={FadeOut.duration(120)}
      className="mt-2 gap-2"
    >
      <View
        className="overflow-hidden bg-black"
        style={{ height: PANEL_HEIGHT, borderRadius: 24, borderCurve: "continuous" }}
      >
        {granted ? (
          <CameraView
            ref={camera}
            active={cameraActive}
            animateShutter
            facing={facing}
            flash={facing === "back" ? flash : "off"}
            mode="picture"
            onCameraReady={() => setReady(true)}
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-3 px-6">
            <SymbolView name="camera" size={28} tintColor="#ffffff" type="monochrome" />
            <Text className="text-center text-[15px] text-white">
              {permission && !permission.canAskAgain
                ? gt("Camera access is off. Allow it in Settings to take photos here.")
                : gt("Allow camera access to take photos here.")}
            </Text>
            <Pressable
              accessibilityRole="button"
              className="rounded-full bg-white/20 px-4 py-2 active:opacity-70"
              onPress={() =>
                permission && !permission.canAskAgain
                  ? void Linking.openSettings()
                  : void requestPermission()
              }
            >
              <Text className="text-[15px] font-medium text-white">
                {permission && !permission.canAskAgain ? gt("Open Settings") : gt("Allow Camera")}
              </Text>
            </Pressable>
          </View>
        )}

        {granted && facing === "back" ? (
          <Pressable
            accessibilityLabel={flashLabel}
            accessibilityRole="button"
            className="absolute left-3 top-3 size-9 items-center justify-center rounded-full bg-black/45 active:opacity-70"
            onPress={() => setFlash(nextFlashMode)}
          >
            <SymbolView
              name={flashIcon}
              size={16}
              tintColor={flash === "off" ? "#ffffff" : "#ffd60a"}
              type="monochrome"
            />
          </Pressable>
        ) : null}

        <Pressable
          accessibilityLabel={gt("Close camera")}
          accessibilityRole="button"
          className="absolute right-3 top-3 size-9 items-center justify-center rounded-full bg-black/45 active:opacity-70"
          onPress={props.onClose}
        >
          <SymbolView name="xmark" size={16} tintColor="#ffffff" type="monochrome" />
        </Pressable>

        {granted ? (
          <View className="absolute inset-x-0 bottom-4 flex-row items-center justify-center">
            <Pressable
              accessibilityLabel={gt("Take photo")}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready || capturing || !cameraActive }}
              disabled={!ready || capturing || !cameraActive}
              className="size-[66px] items-center justify-center rounded-full border-[4px] border-white active:opacity-70"
              onPress={() => void capture()}
            >
              {capturing ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <View className="size-[52px] rounded-full bg-white" />
              )}
            </Pressable>
            <Pressable
              accessibilityLabel={gt("Switch camera")}
              accessibilityRole="button"
              className="absolute right-5 size-10 items-center justify-center rounded-full bg-black/45 active:opacity-70"
              onPress={() => {
                setReady(false);
                setFacing((current) => (current === "back" ? "front" : "back"));
              }}
            >
              <SymbolView name="camera.rotate" size={20} tintColor="#ffffff" type="monochrome" />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View className="flex-row gap-2">
        <PanelButton
          icon="photo"
          label={gt("Photo Library")}
          onPress={() => pickFrom(props.onPickMedia)}
        />
        {props.supportsFiles ? (
          <PanelButton
            icon="folder"
            label={gt("Choose Files")}
            onPress={() => pickFrom(props.onPickFiles)}
          />
        ) : null}
      </View>
    </Animated.View>
  );
}

function PanelButton(props: {
  readonly icon: "photo" | "folder";
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-full bg-foreground/10 active:opacity-70"
      onPress={props.onPress}
    >
      <SymbolView name={props.icon} size={18} tintColorClassName="accent-icon" type="monochrome" />
      <Text className="text-[15px] font-medium text-foreground">{props.label}</Text>
    </Pressable>
  );
}
