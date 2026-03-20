// ═══════════════════════════════════════════════
// My Life — sw.js  Service Worker
// Strategia: Network First
// Se la rete è disponibile → scarica sempre la
// versione più recente da GitHub.
// Se offline → usa la cache.
// ═══════════════════════════════════════════════

const CACHE = 'mylife-v3';
const FILES = [
  './',
  './index.html',
  './crypto.js',
  './auth.js',
  './db.js',
  './app.js',
  './map.js',
  './notes.js',
  './chat.js',
  './sync.js',
  './settings.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

// Installazione: pre-cacha i file essenziali
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES))
      .then(() => self.skipWaiting()) // attiva subito
  );
});

// Attivazione: cancella cache vecchie
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // prende controllo subito
  );
});

// Fetch: Network First
// Prova sempre la rete — se riesce aggiorna la cache.
// Se la rete fallisce → usa la cache (offline).
self.addEventListener('fetch', e => {
  // Solo richieste GET
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Risposta valida → aggiorna cache e restituisci
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => {
        // Rete non disponibile → usa cache
        return caches.match(e.request);
      })
  );
});
