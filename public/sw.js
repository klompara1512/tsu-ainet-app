const CACHE_NAME = "tsu-ainet-v15-3-0";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon-64.png",
  "/icon-192.png",
  "/icon-512.png",
  "/tsu-ainet-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Navigation and compiled app assets must prefer the network so mobile
  // installations receive new releases immediately instead of stale bundles.
  if (event.request.mode === "navigate" || /\.(?:js|css)$/i.test(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) =>
              cache.put(event.request.mode === "navigate" ? "/index.html" : event.request, copy)
            );
          }
          return response;
        })
        .catch(() =>
          event.request.mode === "navigate"
            ? caches.match("/index.html")
            : caches.match(event.request)
        )
    );
    return;
  }

  // Images/fonts: fast cache first, refresh silently in the background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
