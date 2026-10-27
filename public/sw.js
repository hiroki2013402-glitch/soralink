const CACHE_NAME = "soralink-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(cached => cached || caches.match("/"))));
});
// Web Push: show a notification for a new direct message. The server sends JSON { title, body, url, tag }.
// A notification is always shown (browsers require one per push). When the app is already on screen it is shown silently, without sound or vibration.
self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "SoraLink", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appVisible = windows.some(client => client.visibilityState === "visible");
    await self.registration.showNotification(data.title || "SoraLink", {
      body: data.body || "新着メッセージがあります",
      icon: "/icons/android-icon-192x192.png",
      tag: data.tag || "soralink",
      renotify: !appVisible,
      silent: appVisible,
      data: { url: data.url || "/page/messages" }
    });
  })());
});

// Tapping a notification opens the conversation: reuse an open window if there is one, otherwise open a new one.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/page/messages", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        return client.navigate(target).catch(() => undefined).then(() => client.focus());
      }
    }
    return self.clients.openWindow(target);
  }));
});
