/**
 * Phone push notifications for the browser build. The server sends a push when a thread
 * needs the user or ends; the service worker in `public/sw.js` shows it, so it arrives
 * with the page closed. The desktop app never registers the worker.
 */
import * as Effect from "effect/Effect";

import { isElectron } from "./env";
import { PrimaryEnvironmentHttpClient } from "./environments/primary/httpClient";
import { runPrimaryHttp } from "./lib/runtime";
import {
  applicationServerKey,
  resolveWebPushAvailability,
  subscriptionPayload,
  threadPathFromWorkerMessage,
  type WebPushAvailability,
} from "./webPush.logic";

const ENABLED_STORAGE_KEY = "agentdock:web-push-enabled";
const WORKER_URL = "/sw.js";

export function webPushAvailability(): WebPushAvailability {
  if (typeof window === "undefined") return "unsupported";
  return resolveWebPushAvailability({
    isElectron,
    isSecureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone:
      (navigator as { readonly standalone?: boolean }).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
  });
}

/**
 * Whether this device has push turned on. While it does, the page leaves system
 * notifications to the service worker so an alert never shows twice.
 */
export function isWebPushEnabled(): boolean {
  if (isElectron) return false;
  try {
    return window.localStorage.getItem(ENABLED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(ENABLED_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ENABLED_STORAGE_KEY);
  } catch {
    // Without storage the switch simply reads as off after a reload.
  }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function sendSubscription(subscription: PushSubscription): Promise<boolean> {
  const payload = subscriptionPayload(subscription.toJSON());
  if (payload === null) return false;
  await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.webPush.subscribe({ headers: {}, payload })),
    ),
  );
  return true;
}

export type EnableWebPushResult = "enabled" | "permission-denied" | "failed";

async function subscribeBrowserPush(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  const { publicKey } = await runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap((client) => client.webPush.vapidPublicKey({ headers: {} })),
    ),
  );
  const options = {
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey),
  };
  try {
    return await registration.pushManager.subscribe(options);
  } catch {
    // A subscription made for another server key blocks a new one until it is dropped.
    const stale = await registration.pushManager.getSubscription();
    if (stale === null) return null;
    await stale.unsubscribe();
    return registration.pushManager.subscribe(options);
  }
}

/** Must run from a tap: iOS only shows the permission prompt for a user gesture. */
export async function enableWebPush(): Promise<EnableWebPushResult> {
  if (webPushAvailability() !== "available") return "failed";
  try {
    // First, before anything else awaits, so the prompt still counts as part of the tap.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "permission-denied";
    const registration = await readyRegistration();
    const subscription = await subscribeBrowserPush(registration);
    if (subscription === null || !(await sendSubscription(subscription))) return "failed";
    rememberEnabled(true);
    return "enabled";
  } catch {
    return "failed";
  }
}

export async function disableWebPush(): Promise<void> {
  rememberEnabled(false);
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await runPrimaryHttp(
      PrimaryEnvironmentHttpClient.pipe(
        Effect.flatMap((client) =>
          client.webPush.unsubscribe({ headers: {}, payload: { endpoint } }),
        ),
      ),
    );
  } catch {
    // The browser side is already off; the server drops the endpoint on its next failed send.
  }
}

/**
 * On app start: follows notification clicks to their thread and, when push is on, renews
 * the subscription with the server so it stays tied to the current sign-in.
 */
export function startWebPush(router: { readonly history: { push: (path: string) => void } }): void {
  if (webPushAvailability() !== "available") return;
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "agentdock:refresh-push-subscription") {
      if (!isWebPushEnabled() || Notification.permission !== "granted") return;
      void readyRegistration()
        .then(async (registration) => {
          const current =
            (await registration.pushManager.getSubscription()) ??
            (await subscribeBrowserPush(registration));
          if (current !== null) await sendSubscription(current);
        })
        .catch(() => undefined);
      return;
    }
    const path = threadPathFromWorkerMessage(event.data);
    if (path !== null) router.history.push(path);
  });
  if (!isWebPushEnabled()) return;
  void (async () => {
    try {
      if (Notification.permission !== "granted") {
        rememberEnabled(false);
        return;
      }
      const registration = await readyRegistration();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await subscribeBrowserPush(registration));
      if (subscription === null) rememberEnabled(false);
      else await sendSubscription(subscription);
    } catch {
      // Offline or signed out; the next start tries again.
    }
  })();
}
