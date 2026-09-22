/* Only public app assets enter this cache. IndexedDB is never cleared here. */
const VERSION = 'loft-public-v6';
const SHELL = [
  './',
  './cloud.js',
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
const PUBLIC = new Set(SHELL.map(path => new URL(path, self.location.href).pathname));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== VERSION && (/^home-v/.test(key) || /^loft-public-/.test(key))).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.search || !PUBLIC.has(url.pathname) || req.headers.has('Authorization')) return;
  event.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req);
    if (hit) return hit;
    // Uncached responses are returned, never dynamically added to the cache.
    return fetch(req);
  }));
});
self.addEventListener('message', event => {if(event.data === 'skipWaiting') self.skipWaiting();});
