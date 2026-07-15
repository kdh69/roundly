// Roundly service worker — offline app shell.
//
// Home health means cell dead zones: without this, the app is a blank white
// page the moment there's no signal. Strategy:
//   - The app page itself: NETWORK-FIRST (deploys land immediately when
//     online), with the cached copy as the offline fallback.
//   - Self-hosted static assets under /vendor/ (Leaflet, supabase-js, fonts):
//     CACHE-FIRST — they only change with a deliberate version bump, which
//     must come with a CACHE name bump below.
//   - Everything else (Supabase API, OSRM, Photon, Census, map tiles, the NPI
//     Netlify function): NEVER intercepted — data freshness and error
//     handling stay the app's job. No PHI is ever cached.
const CACHE = 'roundly-shell-v2';
const SHELL = [
  '/',
  '/manifest.json',
  '/vendor/fonts/nunito.css',
  '/vendor/fonts/XRXV3I6Li01BKofINeaB.woff2',      // latin
  '/vendor/fonts/XRXV3I6Li01BKofIMeaBXso.woff2',   // latin-ext
  '/vendor/fonts/XRXV3I6Li01BKofIOOaBXso.woff2',
  '/vendor/fonts/XRXV3I6Li01BKofIO-aBXso.woff2',
  '/vendor/fonts/XRXV3I6Li01BKofIOuaBXso.woff2',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/supabase/supabase.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Add individually — one CDN hiccup must not void the whole shell.
    await Promise.allSettled(SHELL.map(u => c.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // The app page: network-first, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('/', fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match('/');
        return hit || Response.error();
      }
    })());
    return;
  }

  const url = new URL(req.url);
  const isShellAsset = url.origin === self.location.origin &&
    (url.pathname.startsWith('/vendor/') || url.pathname === '/manifest.json');
  if (isShellAsset) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh.ok) {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
  // All other requests fall through untouched.
});
