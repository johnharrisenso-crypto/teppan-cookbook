// Teppan Cookbook 0.7 (CS-066): caches the app shell so it opens with no signal.
// Data is not cached here: the page keeps its own copy (recipes, the list and queued changes) in browser storage.
// Bump CACHE on every publish so phones pick up the new page.
const CACHE = 'teppan-shell-0.7.0';
const SHELL = ['./', './index.html', './manifest.json', './apple-touch-icon.png', './icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return; // the endpoint and fonts go straight to the network
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
});
