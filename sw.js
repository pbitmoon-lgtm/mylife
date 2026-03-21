// ═══════════════════════════════════════════════════════
// My Life — sw.js
// Strategia: Cache-First + Stale-While-Revalidate
//
// PRINCIPIO LOCAL-FIRST:
//   L'app si apre ISTANTANEAMENTE dalla cache locale.
//   Nel frattempo, in background, controlla GitHub
//   per aggiornamenti e li prepara per il prossimo avvio.
//   Connessione lenta o assente = zero impatto sull'avvio.
// ═══════════════════════════════════════════════════════

const CACHE   = 'mylife-v4';
const MODULES = [
  './', './index.html',
  './state.js', './boot.js', './hardware.js',
  './crypto.js', './db.js', './ui.js',
  './map.js', './notes.js', './chat.js',
  './calendar.js', './backup.js', './sync.js',
  './zk-worker.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

// ─── INSTALL ──────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(MODULES))
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE ─────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─── FETCH: Cache-First + Stale-While-Revalidate ──────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {

      // Aggiornamento silenzioso in background
      const revalidate = fetch(e.request)
        .then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => null); // offline: non blocca nulla

      // Risposta istantanea dalla cache
      // Solo al primissimo avvio (niente in cache) aspetta la rete
      return cached || revalidate;
    })
  );
});
