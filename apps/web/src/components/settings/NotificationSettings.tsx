import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useGT, useMessages } from "gt-react";
import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  unlockNotificationAudio,
} from "../../threadNotifications";
import {
  disableWebPush,
  enableWebPush,
  isWebPushEnabled,
  webPushAvailability,
} from "../../webPush";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/** Push for a phone or browser: alerts that arrive with the page closed. */
function PhonePushSetting() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const [availability] = useState(webPushAvailability);
  const [enabled, setEnabled] = useState(isWebPushEnabled);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The desktop app shows its own system notifications.
  if (availability === "desktop-app") return null;

  const unavailable =
    availability === "ios-needs-home-screen"
      ? gt(
          "Add this page to your home screen first: tap Share, then Add to Home Screen. Open AgentDock from the home screen and turn this on there.",
        )
      : availability === "insecure"
        ? gt("Push notifications need this page to be open over HTTPS.")
        : availability === "unsupported"
          ? gt("This browser does not support push notifications.")
          : null;

  return (
    <SettingsRow
      {...searchableSetting("phone-push-notifications")}
      description={
        unavailable ??
        problem ??
        gt(
          "Alerts on this device when a thread finishes, fails, or needs input or approval, even when AgentDock is closed.",
        )
      }
      control={
        <Switch
          checked={enabled}
          disabled={busy || unavailable !== null}
          aria-label={gt("Push notifications on this device")}
          onCheckedChange={async (next) => {
            setProblem(null);
            setBusy(true);
            if (next) {
              const result = await enableWebPush();
              setEnabled(result === "enabled");
              if (result === "permission-denied") {
                setProblem(
                  gt(
                    "Allow notifications for AgentDock in your device settings, then turn this on again.",
                  ),
                );
              } else if (result === "failed") {
                setProblem(gt("Push notifications could not be turned on. Try again."));
              }
            } else {
              await disableWebPush();
              setEnabled(false);
            }
            setBusy(false);
          }}
        />
      }
    />
  );
}

export function NotificationSettings() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <>
      <SettingsRow
        {...searchableSetting("thread-notifications")}
        description={
          permissionMessage ??
          gt(
            "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while AgentDock is open.",
          )
        }
        control={
          <Select
            value={mode}
            disabled={requesting}
            onValueChange={async (value) => {
              if (
                value !== "off" &&
                value !== "notifications" &&
                value !== "sound" &&
                value !== "notifications-and-sound"
              )
                return;
              setPermissionMessage(null);
              if (hasNotificationSound(value)) unlockNotificationAudio();
              if (hasDesktopNotifications(value)) {
                if (typeof Notification === "undefined" || !window.isSecureContext) {
                  setPermissionMessage(
                    gt(
                      "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                    ),
                  );
                  return;
                }
                setRequesting(true);
                const permission = await settlePromise(() => Notification.requestPermission());
                setRequesting(false);
                if (permission._tag === "Failure") {
                  setPermissionMessage(
                    gt(
                      "Notifications are unavailable in this browser. Sound only is still available.",
                    ),
                  );
                  return;
                }
                if (permission.value !== "granted") {
                  setPermissionMessage(
                    gt(
                      "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                    ),
                  );
                  return;
                }
              }
              updateSettings({ notificationMode: value });
            }}
          >
            <SelectTrigger
              size="sm"
              className="w-full sm:w-56"
              aria-label={gt("Thread notifications")}
            >
              <SelectValue>{m(NOTIFICATION_MODE_LABELS[mode])}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {m(label)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <PhonePushSetting />
    </>
  );
}
