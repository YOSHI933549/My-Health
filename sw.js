/* Offline cache for the health tracker PWA.

   IMPORTANT: the browser only re-installs this service worker when this
   file's bytes change. If only index.html/css/js change, the worker never
   updates on its own — so the app-shell strategy below is network-first
   (always fetch the latest HTML/CSS/JS when online, cache it, and fall back
   to the cache only when offline). That way a normal reload always picks up
   the newest deploy, even if this file itself hasn't changed. Bumping
   CACHE_VERSION is still good practice (it prunes old cache entries) but is
   no longer required just to ship an update. */
const CACHE_VERSION = "v24";
const CACHE_NAME = `yoshi-health-tracker-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/codex-sync.js",
  "./js/sync.js",
  "./js/n8n-sync.js",
  "./js/ocr.js",
  "./manifest.json",
];
const STATIC_ASSETS = ["./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

const SHELL_PATHS = new Set(APP_SHELL.map((p) => new URL(p, self.location).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          [...APP_SHELL, ...STATIC_ASSETS].map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => (res.ok ? cache.put(url, res) : null))
              .catch(() => null)
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isShell = event.request.mode === "navigate" || SHELL_PATHS.has(url.pathname);

  if (isShell) {
    // Network-first: always try to get the latest deploy. `cache: "reload"`
    // is important here — without it, `fetch()` can still be satisfied by
    // the browser's own HTTP cache (GitHub Pages serves these with a
    // Cache-Control max-age), silently defeating "network-first" even
    // though this handler never touches the stale Cache Storage entry.
    // Cache the fresh response for offline use, and only fall back to the
    // Cache Storage copy when the network truly fails.
    event.respondWith(
      fetch(event.request, { cache: "reload" })
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (icons etc.) that rarely change.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
