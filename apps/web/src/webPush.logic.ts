/** Why push notifications can or cannot be turned on in this browser. */
export type WebPushAvailability =
  /** The desktop app has its own system notifications. */
  | "desktop-app"
  | "insecure"
  /** iOS delivers pushes only to a page added to the home screen. */
  | "ios-needs-home-screen"
  | "unsupported"
  | "available";

export interface WebPushEnvironment {
  readonly isElectron: boolean;
  readonly isSecureContext: boolean;
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  /** Launched from the home screen, with no browser chrome. */
  readonly standalone: boolean;
  readonly hasServiceWorker: boolean;
  readonly hasPushManager: boolean;
  readonly hasNotification: boolean;
}

/** iPadOS reports itself as a Mac; a Mac with a touch screen does not exist. */
export function isIosDevice(environment: {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
}): boolean {
  return (
    /iPad|iPhone|iPod/u.test(environment.userAgent) ||
    (environment.platform === "MacIntel" && environment.maxTouchPoints > 1)
  );
}

export function resolveWebPushAvailability(environment: WebPushEnvironment): WebPushAvailability {
  if (environment.isElectron) return "desktop-app";
  if (!environment.isSecureContext) return "insecure";
  // Safari on iOS hides the push API until the page runs from the home screen.
  if (isIosDevice(environment) && !environment.standalone) return "ios-needs-home-screen";
  if (
    !environment.hasServiceWorker ||
    !environment.hasPushManager ||
    !environment.hasNotification
  ) {
    return "unsupported";
  }
  return "available";
}

/** The VAPID key in the form `pushManager.subscribe` takes. */
export function applicationServerKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface WebPushSubscriptionPayload {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

/** What the server stores, from `PushSubscription.toJSON()`; null when the browser left a part out. */
export function subscriptionPayload(json: {
  readonly endpoint?: string | undefined;
  readonly keys?: Record<string, string> | undefined;
}): WebPushSubscriptionPayload | null {
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

/** The in-app path a notification click asks for, or null for anything that is not one. */
export function threadPathFromWorkerMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as { readonly type?: unknown; readonly url?: unknown };
  if (message.type !== "agentdock:open-thread" || typeof message.url !== "string") return null;
  return message.url.startsWith("/") && !message.url.startsWith("//") ? message.url : null;
}
