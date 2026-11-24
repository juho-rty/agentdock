import { T, useGT } from "gt-react";
import { useEffect, useState } from "react";

import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function TraySetting() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const bridge = window.desktopBridge;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the desktop process owns this setting; read it once when the row mounts
  useEffect(() => {
    let active = true;
    void bridge
      ?.getTrayEnabled?.()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) setEnabled(null);
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  if (!bridge?.getTrayEnabled || !bridge.setTrayEnabled) return null;
  const setTrayEnabled = bridge.setTrayEnabled;
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <>
      <SettingsRow
        {...searchableSetting("tray-quick-ask")}
        description={
          isMac ? (
            <T>Ask agents and check running threads from the menu bar icon.</T>
          ) : (
            <T>
              Keep AgentDock running in the background when the window closes and open Quick Ask
              from the system tray icon.
            </T>
          )
        }
        control={
          <Switch
            checked={enabled ?? true}
            disabled={enabled === null || isUpdating}
            onCheckedChange={(checked) => {
              const next = Boolean(checked);
              setIsUpdating(true);
              setEnabled(next);
              void setTrayEnabled(next)
                .catch(() => setEnabled(!next))
                .finally(() => setIsUpdating(false));
            }}
            aria-label={gt("Show in menu bar / system tray")}
          />
        }
      />
      <LaunchAtLoginSetting />
    </>
  );
}

function LaunchAtLoginSetting() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const bridge = window.desktopBridge;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads OS login-item state from the desktop process when mounted
  useEffect(() => {
    let active = true;
    void bridge
      ?.getLaunchAtLogin?.()
      .then((value) => {
        if (active) setEnabled(value);
      })
      .catch(() => {
        if (active) setEnabled(null);
      });
    return () => {
      active = false;
    };
  }, [bridge]);

  if (!bridge?.getLaunchAtLogin || !bridge.setLaunchAtLogin || enabled === null) return null;
  const setLaunchAtLogin = bridge.setLaunchAtLogin;

  return (
    <SettingsRow
      {...searchableSetting("launch-at-login")}
      description={<T>Start AgentDock automatically in the background when you sign in.</T>}
      control={
        <Switch
          checked={enabled}
          disabled={isUpdating}
          onCheckedChange={(checked) => {
            const next = Boolean(checked);
            setIsUpdating(true);
            setEnabled(next);
            void setLaunchAtLogin(next)
              .then((actual) => setEnabled(actual))
              .catch(() => setEnabled(!next))
              .finally(() => setIsUpdating(false));
          }}
          aria-label={gt("Start at login")}
        />
      }
    />
  );
}
