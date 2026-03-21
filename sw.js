// ═══════════════════════════════════════════════════════
// My Life — sw.js (PRODUZIONE - SICURO)
// Cache-First + Stale-While-Revalidate
// + Notifica aggiornamento critico alla UI
//
// STRATEGIA:
//   Risposta istantanea dalla cache (zero latenza).
//   Aggiornamento silenzioso in background.
//   Se c'è una nuova versione → notifica la UI con
//   UPDATE_AVAILABLE → l'utente può scegliere di
//   ricaricare subito (critico per patch di sicurezza).
// ═══════════════════════════════════════════════════════

const CACHE   = 'mylife-v5'; // incrementa per forzare update immediato
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
      .then(() => self.skipWaiting()) // attiva subito senza aspettare
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

      // Revalidazione silenziosa in background
      const revalidate = fetch(e.request)
        .then(networkRes => {
          if (!networkRes || networkRes.status !== 200 || networkRes.type === 'opaque') {
            return networkRes;
          }

          // Controlla se il file è cambiato rispetto alla cache
          const newRes = networkRes.clone();
          caches.open(CACHE).then(async cache => {
            const oldRes = await cache.match(e.request);

            if (oldRes) {
              // Confronta ETag o Last-Modified per rilevare cambiamenti
              const oldEtag = oldRes.headers.get('ETag');
              const newEtag = networkRes.headers.get('ETag');
              const oldMod  = oldRes.headers.get('Last-Modified');
              const newMod  = networkRes.headers.get('Last-Modified');

              const hasChanged =
                (oldEtag && newEtag && oldEtag !== newEtag) ||
                (oldMod  && newMod  && oldMod  !== newMod);

              if (hasChanged) {
                // Aggiorna la cache con la nuova versione
                await cache.put(e.request, newRes.clone());

                // Notifica TUTTE le tab aperte che c'è una nuova versione
                // La UI mostrerà un banner "Riavvia per sicurezza"
                self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
                  clients.forEach(client => {
                    client.postMessage({ type: 'UPDATE_AVAILABLE' });
                  });
                });
              }
            } else {
              // Prima volta in cache
              await cache.put(e.request, newRes.clone());
            }
          });

          return networkRes;
        })
        .catch(() => null); // offline: ignora silenziosamente

      // Risposta istantanea dalla cache
      // Solo al primissimo avvio (niente in cache) aspetta la rete
      return cached || revalidate;
    })
  );
});
