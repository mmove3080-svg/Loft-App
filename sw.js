/* Home — service worker.
   Precaches the shell, serves it cache-first, and swaps in a new version
   only after the whole new shell has downloaded. User media never touches
   this cache: it lives in IndexedDB on the device. */
const VERSION = 'home-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './photos/0-portrait.jpg',
  './photos/1-sporting.jpg',
  './photos/2-manutd.jpg',
  './photos/3-realmadrid.jpg',
  './photos/4-juventus.jpg',
  './photos/5-manutd-return.jpg',
  './photos/6-alnassr.jpg',
  './photos/7-portugal.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: cache-first on the shell so cold starts are instant offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((hit) =>
        hit || fetch(req).catch(() => caches.match('./'))
      )
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
