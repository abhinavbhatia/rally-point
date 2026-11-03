// Offline support: cache the app shell, serve it when there is no network.
const CACHE = 'rally-point-v3';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'engine.js', 'court.js', 'scene.js', 'lessons.js', 'umpire.js', 'play.js', 'live.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Never cache Firebase's reserved URLs or Firestore traffic.
  if (url.pathname.startsWith('/__/') || url.hostname.includes('googleapis.com') && !url.hostname.startsWith('fonts')) return;
  const sameOrigin = url.origin === location.origin;
  const cacheable = sameOrigin || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'www.gstatic.com';
  if (!cacheable) return;
  // Stale-while-revalidate: answer from cache, refresh in the background.
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: sameOrigin });
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit || (e.request.mode === 'navigate' ? c.match('index.html') : undefined));
      return hit || net;
    }),
  );
});
