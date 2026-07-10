// Roundly service worker — offline app shell.
//
// Home health means cell dead zones: without this, the app is a blank white
// page the moment there's no signal. Strategy:
//   - The app page itself: NETWORK-FIRST (deploys land immediately when
//     online), with the cached copy as the offline fallback.
//   - Versioned CDN assets (Leaflet, supabase-js, fonts): CACHE-FIRST — their
//     URLs are immutable, refetching them every cold start is pure waste.
//   - Everything else (Supabase API, OSRM, Photon, Census, map tiles, the NPI
//     Netlify function): NEVER intercepted — data freshness and error
//     handling stay the app's job.
const CACHE = 'roundly-shell-v1';
const SHELL = [
  '/',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js'
];
// Hosts whose GETs are safe to serve cache-first (immutable/versioned).
const CACHE_FIRST_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

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
  if (CACHE_FIRST_HOSTS.includes(url.hostname) || url.pathname === '/manifest.json') {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      // Opaque responses (no-cors CDN fetches) are cacheable and servable.
      if (fresh.ok || fresh.type === 'opaque') {
        const c = await caches.open(CACHE);
        c.put(req, fresh.clone());
      }
      return fresh;
    })());
  }
  // All other requests fall through untouched.
});
