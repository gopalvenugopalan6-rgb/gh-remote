// Cache the app shell so the remote opens instantly and still works when the
// phone has flaky internet. It never caches TV traffic -- that is WebSocket,
// which a service worker does not touch.

const VERSION = 'gh-remote-v1';
const SHELL = [
  '.',
  'index.html',
  'css/theme.css',
  'css/app.css',
  'js/app.js',
  'js/ui.js',
  'js/webos.js',
  'js/store.js',
  'js/discover.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // Individual failures must not sink the whole install (a missing icon
      // should never stop the app from working offline).
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch TV requests

  // Network-first so a deploy shows up immediately, cache as the offline net.
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('index.html')))
  );
});
