const CACHE_NAME = "tsu-ainet-v18-3-0-beta-15";
const APP_SHELL = [
  "/index.html",
  "/manifest.webmanifest",
  "/favicon-64.png",
  "/icon-192.png",
  "/icon-512.png",
  "/tsu-ainet-logo.png",
  "/tsu-ainet-hero.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
    }),
  );
});


self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

  try {
    const response = await fetch(request, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (fallbackUrl ? await cache.match(fallbackUrl) : undefined) ||
      Response.error()
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());

  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "/index.html"));
    return;
  }

  const destination = request.destination;

  // JavaScript und CSS immer zuerst frisch laden. Dadurch kann kein alter
  // PWA-Cache mehr auf gelöschte Vite-Chunk-Dateien verweisen.
  if (destination === "script" || destination === "style" || destination === "worker") {
    event.respondWith(networkFirst(request));
    return;
  }

  // Bilder und Schriften dürfen schnell aus dem Cache kommen und werden
  // im Hintergrund aktualisiert.
  if (destination === "image" || destination === "font") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

// RC10 mobile hero clear-image update

// RC10 hero soft side-edge update
