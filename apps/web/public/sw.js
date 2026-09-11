/*
 * The service worker (T-082, D-042): an installable shell with an honest
 * offline page. It never serves a cached page as if it were current — live
 * scores are live or they are not shown (rule 4). Navigations go to the
 * network; when that fails the offline page is shown. Only the offline page,
 * the manifest, the icons and Next's immutable static assets are cached.
 */
const VERSION = 'fmip-shell-v1';
const OFFLINE_PATH = '/en/offline';
const SHELL = [OFFLINE_PATH, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, the offline page when there is no network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_PATH)
          .then(
            (cached) =>
              cached ??
              new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } }),
          ),
      ),
    );
    return;
  }

  // Immutable build assets and the shell: cache first, then network.
  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
  // Everything else (the web app's own API routes, streams) is never cached.
});
