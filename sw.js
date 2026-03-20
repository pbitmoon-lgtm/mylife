// ═══════════════════════════════════════════════════════
// My Life — sw.js  Service Worker
// Strategia: Network First
// Quando carichi file nuovi su GitHub, il telefono
// li scarica automaticamente alla prossima apertura.
// ═══════════════════════════════════════════════════════

const CACHE   = 'mylife-v4';
const MODULES = [
  './', './index.html',
  './state.js', './boot.js', './hardware.js',
  './crypto.js', './db.js', './ui.js',
  './map.js', './notes.js', './chat.js',
  './sync.js', './settings.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(MODULES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network First: prova sempre la rete, aggiorna cache, fallback offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status===200) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
