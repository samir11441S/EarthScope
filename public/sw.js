// EarthScope service worker: makes the app installable, keeps the last live data for offline use,
// and shows alert notifications. Map tiles from NASA/Esri are not cached (too large).
// Registered as /sw.js?v=<build id>, so every deployment gets a fresh cache and old ones are deleted.
const VERSION = `earthscope-${new URL(self.location.href).searchParams.get("v") || "v4"}`;
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/favicon.svg"];
// Live data whose last good answer is useful offline.
const LIVE_API = ["/api/disasters", "/api/heat", "/api/safe-places", "/api/climate"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request, { ignoreSearch: false })) || (fallbackUrl && (await cache.match(fallbackUrl))) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // tiles and third-party APIs go straight to the network
  if (request.mode === "navigate") { event.respondWith(networkFirst(request, "/")); return; }
  if (LIVE_API.some(p => url.pathname.startsWith(p))) { event.respondWith(networkFirst(request)); return; }
  if (url.pathname === "/api/clouds") { event.respondWith(cacheFirst(request)); return; } // one immutable map per date
  if (url.pathname.startsWith("/api/")) return; // AI and other dynamic routes: never cached
  // Built assets have content-hashed names, so cache-first is safe; fonts, icons and data likewise.
  if (/\/(_next|assets)\/|\.(js|css|woff2?|png|jpe?g|svg|json|webmanifest)$/.test(url.pathname)) event.respondWith(cacheFirst(request));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const open = list.find(c => new URL(c.url).origin === self.location.origin);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
