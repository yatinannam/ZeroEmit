// Bump the version whenever caching behaviour changes — activate deletes
// every cache that doesn't match, so stale entries from old builds go away.
const CACHE_NAME = "zeroemit-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/zeroemit.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });

// Network first, cache as the offline fallback. Only successful same-origin
// responses are cached (never 404/500 pages), and only page navigations fall
// back to the cached app shell — a failed script or image request getting
// the home page's HTML back would break in confusing ways.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).then((response) => {
    if (response.ok && response.type === "basic") { const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === "navigate" && (await caches.match("/"))) || Response.error()));
});

// Each notification carries the page it's about in `data.url` (e.g. /log for
// a charge confirmation): reuse an open ZeroEmit window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (!existing) return self.clients.openWindow(url);
    const focused = await existing.focus();
    return focused.url === url || !("navigate" in focused) ? focused : focused.navigate(url);
  }));
});
