// AgentDock's service worker. It exists only for push notifications: it caches nothing and
// answers no fetches, so the page always loads from the server exactly as it does without it.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const FALLBACK = { title: "AgentDock", body: "A thread needs your attention.", url: "/", tag: "" };

function readMessage(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (data === null || typeof data !== "object") return FALLBACK;
    return {
      title: typeof data.title === "string" && data.title !== "" ? data.title : FALLBACK.title,
      body: typeof data.body === "string" ? data.body : "",
      // Only a path on this origin is ever opened, whatever the message says.
      url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/",
      tag: typeof data.tag === "string" ? data.tag : "",
    };
  } catch {
    return FALLBACK;
  }
}

function windowClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

self.addEventListener("push", (event) => {
  const message = readMessage(event);
  event.waitUntil(
    windowClients().then((clients) => {
      // iOS withdraws a subscription that receives pushes without showing them, so every
      // push shows. When the app is on screen it already plays its own sound, so the
      // banner stays quiet.
      const appOnScreen = clients.some((client) => client.visibilityState === "visible");
      return self.registration.showNotification(message.title, {
        body: message.body,
        icon: "/icon-192x192.png",
        badge: "/icon-192x192.png",
        data: { url: message.url },
        silent: appOnScreen,
        ...(message.tag === "" ? {} : { tag: message.tag }),
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/";
  const target = new URL(path, self.location.origin);
  event.waitUntil(
    windowClients().then(async (clients) => {
      const open = clients.find((client) => new URL(client.url).origin === target.origin);
      if (open === undefined) return self.clients.openWindow(target.href);
      // The open app moves to the thread itself, which keeps its state and its connection.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Client.postMessage takes none.
      open.postMessage({ type: "agentdock:open-thread", url: target.pathname });
      return open.focus().catch(() => undefined);
    }),
  );
});
