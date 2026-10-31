// Bump the version whenever caching behaviour changes — activate deletes
// every cache that doesn't match, so stale entries from old builds go away.
const CACHE_NAME = "zeroemit-v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/zeroemit.svg", "/icons/icon-192.png"];

self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))); self.clients.claim(); });

// How long a page load waits on a stalled connection before a cached copy
// (if there is one) is shown instead.
const NAVIGATION_TIMEOUT_MS = 4000;

// Network first, cache as the offline fallback. Only successful same-origin
// responses are cached (never 404/500 pages), and only page navigations fall
// back to the cached app shell — a failed script or image request getting
// the home page's HTML back would break in confusing ways. Build assets
// under /_next/static never change once built, so those come from the cache
// first. Next's in-app navigation payloads (?_rsc=) depend on request
// headers the cache can't key on, so they're never stored.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const store = !url.searchParams.has("_rsc") && !request.headers.has("RSC");
  const network = () => fetch(request).then((response) => {
    if (store && response.ok && response.type === "basic") {
      const copy = response.clone();
      const write = caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      // Too late to extend the event once a cached page already answered; the write still finishes.
      try { event.waitUntil(write); } catch { /* event already settled */ }
    }
    return response;
  });
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((hit) => hit || network()));
    return;
  }
  if (request.mode !== "navigate") {
    event.respondWith(network().catch(async () => (await caches.match(request)) || Response.error()));
    return;
  }
  // Resolves only when a cached copy exists; otherwise the network keeps the page.
  const cachedAfterTimeout = new Promise((resolve) => setTimeout(() => { caches.match(request).then((hit) => { if (hit) resolve(hit); }); }, NAVIGATION_TIMEOUT_MS));
  event.respondWith(Promise.race([network(), cachedAfterTimeout]).catch(async () => (await caches.match(request)) || (await caches.match("/")) || Response.error()));
});

// Scheduled notifications from the server (src/app/lib/server/push-scheduler.ts):
// { title, body, url, tag, actions? }. Actions show as buttons where the
// platform supports them (not iPhone); "log" opens the quick-log form.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(payload.title || "ZeroEmit", { body: payload.body || "", icon: "/icons/icon-192.png", tag: payload.tag || "zeroemit", actions: Array.isArray(payload.actions) ? payload.actions : [], data: { url: payload.url || "/" } }));
});

// Each notification carries the page it's about in `data.url` (e.g. /log for
// a charge confirmation): reuse an open ZeroEmit window if there is one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.action === "log" ? "/log?quick=1" : event.notification.data?.url || "/";
  const url = new URL(target, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (!existing) return self.clients.openWindow(url);
    const focused = await existing.focus();
    // navigate() rejects for a window this worker doesn't control yet.
    return focused.url === url || !("navigate" in focused) ? focused : focused.navigate(url).catch(() => self.clients.openWindow(url));
  }));
});
