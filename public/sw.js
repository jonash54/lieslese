/* lieslese service worker — fully static app, works offline after first visit.
   Books live in IndexedDB (not the cache), so opened books read offline anyway. */
const CACHE = 'lieslese-v1';
const SHELL = [
  '/', '/index.html', '/reader.html',
  '/css/weltsein.css', '/css/app.css', '/css/reader.css',
  '/js/db.js', '/js/lib.js', '/js/theme.js', '/js/library.js', '/js/reader.js',
  '/vendor/foliate-js/view.js',
  '/favicon.svg', '/placeholder-cover.svg', '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const net = fetch(req).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
    return res;
  }).catch(() => cached);
  return cached || net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch the autofill API etc.
  e.respondWith(staleWhileRevalidate(req));
});
