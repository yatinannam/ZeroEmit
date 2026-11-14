// Pages are cached per deploy: the page registers this worker as
// /sw.js?v=<deploy id> (pwa-register.tsx), so every deploy installs a new
// worker whose page cache starts fresh, and activate deletes the old one. A
// page kept from an earlier deploy would point at build files that deploy has
// since deleted, and load unstyled and dead. Bump PAGE_CACHE_PREFIX whenever
// caching behaviour changes.
const BUILD = new URL(self.location.href).searchParams.get("v") || "0";
const PAGE_CACHE_PREFIX = "zeroemit-pages-v4-";
const CACHE_NAME = PAGE_CACHE_PREFIX + BUILD;
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/zeroemit.svg", "/icons/icon-192.png"];
// Every invite code, recap period and forecast day is its own URL, so the page
// cache is capped too (the app shell is never trimmed).
const MAX_PAGE_ENTRIES = 40;
// Build assets (/_next/static) get their own cache. Their names change with
// every deploy, so old builds' files would pile up forever: only the newest
// MAX_STATIC_ENTRIES are kept (a build has a few dozen, so the current one
// and the last couple stay available offline).
const STATIC_CACHE = "zeroemit-static-v1";
const MAX_STATIC_ENTRIES = 150;

// Oldest first: Cache Storage lists entries in the order they were added.
async function trimStaticCache() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((key) => cache.delete(key)));
}

async function trimPageCache() {
  const cache = await caches.open(CACHE_NAME);
  const shell = new Set(APP_SHELL.map((path) => new URL(path, self.location.origin).href));
  const pages = (await cache.keys()).filter((key) => !shell.has(key.url));
  await Promise.all(pages.slice(0, Math.max(0, pages.length - MAX_PAGE_ENTRIES)).map((key) => cache.delete(key)));
}

// Build assets cached by earlier versions alongside the pages move to their
// own cache (in their original order) rather than being lost, so offline
// loads keep working through this update.
async function moveStaticAssets() {
  const target = await caches.open(STATIC_CACHE);
  for (const name of await caches.keys()) {
    if (name === STATIC_CACHE) continue;
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      if (!new URL(request.url).pathname.startsWith("/_next/static/")) continue;
      const response = await cache.match(request);
      if (response && !(await target.match(request))) await target.put(request, response);
      await cache.delete(request);
    }
  }
}

// "reload" skips the browser's HTTP cache, so the shell is this deploy's.
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL.map((path) => new Request(path, { cache: "reload" }))))); self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  event.waitUntil(moveStaticAssets()
    .then(() => caches.keys())
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== STATIC_CACHE).map((key) => caches.delete(key))))
    .then(trimStaticCache));
  self.clients.claim();
});

// Shown offline for a screen this device hasn't opened since the last deploy.
// Home's page under another screen's URL lit the wrong tab and never said why.
const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline · ZeroEmit</title><style>
:root{--page:#dfe9df;--card:#fff;--ink:#141e14;--muted:#40493d;--primary:#0d631b;--on-primary:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--page:#070b07;--card:#1b231b;--ink:#dfe7da;--muted:#a9b4a4;--primary:#88d982;--on-primary:#00390a}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;min-height:100svh;display:grid;place-items:center;padding:16px;background:var(--page);color:var(--ink);font-family:Inter,Arial,sans-serif}
main{width:100%;max-width:360px;padding:28px 24px;border-radius:24px;background:var(--card)}
h1{margin:0 0 8px;font-size:24px;line-height:1.2}p{margin:0 0 20px;color:var(--muted);font-size:15px;line-height:1.5}
.actions{display:grid;gap:8px}a,button{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:999px;font:inherit;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}
button{border:0;background:var(--primary);color:var(--on-primary)}a{border:1px solid var(--muted);color:var(--ink)}
:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
</style></head><body><main><h1>You're offline</h1><p>This screen hasn't been opened on this device yet, so there's no saved copy. It opens once you're back online.</p><div class="actions"><button type="button" onclick="location.reload()">Try again</button><a href="/">Open Home</a></div></main></body></html>`;

// Offline: the page itself, else the same screen under another query string
// (/log for /log?quick=1, the shortcut and the notification action), else
// Home for Home, else the offline page.
async function cachedPage(request) {
  const options = { cacheName: CACHE_NAME };
  const hit = (await caches.match(request, options)) || (await caches.match(request, { ...options, ignoreSearch: true }));
  if (hit) return hit;
  if (new URL(request.url).pathname === "/") return (await caches.match("/", options)) || Response.error();
  return new Response(OFFLINE_PAGE, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

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
  const isStatic = url.pathname.startsWith("/_next/static/");
  const network = () => fetch(request).then((response) => {
    if (store && response.ok && response.type === "basic") {
      const copy = response.clone();
      const write = isStatic
        ? caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)).then(trimStaticCache)
        : caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).then(trimPageCache);
      // Too late to extend the event once a cached page already answered; the write still finishes.
      try { event.waitUntil(write); } catch { /* event already settled */ }
    }
    return response;
  });
  if (isStatic) {
    event.respondWith(caches.match(request).then((hit) => hit || network()));
    return;
  }
  if (request.mode !== "navigate") {
    event.respondWith(network().catch(async () => (await caches.match(request)) || Response.error()));
    return;
  }
  // Resolves only when a cached copy exists; otherwise the network keeps the page.
  const cachedAfterTimeout = new Promise((resolve) => setTimeout(() => { caches.match(request, { cacheName: CACHE_NAME }).then((hit) => { if (hit) resolve(hit); }); }, NAVIGATION_TIMEOUT_MS));
  event.respondWith(Promise.race([network(), cachedAfterTimeout]).catch(() => cachedPage(request)));
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
