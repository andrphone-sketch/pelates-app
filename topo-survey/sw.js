/* Service Worker — offline-first για την εφαρμογή κροκιού */
const CACHE = 'topo-survey-v1';
const ASSETS = [
  'index.html', 'app.js', 'style.css', 'egas87.js', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/proj4.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  // Προσπάθεια cache πρώτα, αλλιώς δίκτυο (οι χάρτες περνούν από το δίκτυο)
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      // αποθήκευσε tiles/πόρους που δεν είναι στον στατικό κατάλογο
      if (e.request.method === 'GET' && resp && resp.status === 200 && !e.request.url.includes('tile.openstreetmap')) {
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
      }
      return resp;
    }).catch(() => {
      // για tiles που λείπουν offline, επέστρεψε πλαίσιο κενό
      if (e.request.url.includes('tile.openstreetmap')) return new Response('', { status: 204 });
    }))
  );
});
