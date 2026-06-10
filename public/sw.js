// Service Worker — Pachanguitas FC
// Estrategia:
//  - index.html (navegación): RED primero, caché solo como fallback offline.
//    La app se actualiza a menudo; nunca servimos HTML viejo si hay conexión.
//  - Estáticos (imágenes, iconos, cartas): caché primero, se actualizan en
//    segundo plano (stale-while-revalidate).
//  - Firebase (datos/auth) no se toca: siempre va directo a la red.

const CACHE = 'pfc-v1';
const PRECACHE = [
  '/',
  '/bg.jpg',
  '/login-bg-opt.jpg',
  '/cards/card-bg.png',
  '/cards/card-toty.jpg',
  '/cards/card-neon.jpg',
  '/cards/card-hero.jpg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Solo GET y nunca interceptar Firebase / Google APIs
  if (e.request.method !== 'GET') return;
  if (url.hostname.includes('firebase') || url.hostname.includes('googleapis')
   || url.hostname.includes('gstatic') || url.hostname.includes('google')) return;

  // Navegación (HTML): red primero, caché si no hay conexión
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Estáticos mismo origen: caché primero + actualización en segundo plano
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    );
  }
});
