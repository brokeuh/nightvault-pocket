// Nightvault Pocket: lets the phone install it as an app and open it without internet.
// Always tries the newest version first, so uploads to GitHub show up straight away.
const CACHE = 'nv-pocket-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if(r.ok){ const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)) } return r })
    .catch(() => caches.match(e.request).then(r => r || caches.match('./'))));
});
