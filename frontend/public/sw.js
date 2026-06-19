/* OurRealm — minimal cache-bust service worker.
 *
 * Goal: prevent the "black screen + missing asset icon" failure
 * mode caused by a previously-installed PWA caching an old
 * `index.html` that references a hashed bundle file
 * (e.g. /static/js/main.abc123.js) that no longer exists after
 * a new deployment.
 *
 * Strategy (deliberately small):
 *   1. install →  skipWaiting() so a freshly-deployed SW takes
 *                 over without waiting for tabs to close.
 *   2. activate → clients.claim()  + delete every cache from a
 *                 previous version (cache name carries a static
 *                 prefix; everything not matching the current
 *                 SW_VERSION is wiped).
 *   3. fetch    → NETWORK-FIRST for navigations + hashed asset
 *                 files. If the network 404s a hashed bundle
 *                 the user is stuck on, broadcast a
 *                 RELOAD_REQUIRED message to all clients so the
 *                 register-script can do `location.reload(true)`.
 *
 * We never precache the React bundle. The bundle filename
 * changes on every build, so a stale precache is exactly the
 * bug we're solving — keeping the SW lean and network-first
 * means the browser always asks the server for the current
 * filename and the server (or CDN) is the source of truth.
 *
 * NOTE: this file is intentionally HOSTED AT THE ROOT of
 * /public so the scope covers the entire app.
 */

// Bump this on every change to this file. The cache name
// includes the version so old caches get evicted on activate.
const SW_VERSION = 'ourrealm-v1';

self.addEventListener('install', (event) => {
  // Take over immediately on next page load. Combined with
  // clients.claim() below, this guarantees that one navigation
  // after a redeploy is enough to flush the old SW.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Delete every cache that doesn't belong to the current
    // SW version. This is what removes the dangling
    // `main.<oldhash>.js` reference for users stuck on a
    // previous deploy.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name !== SW_VERSION)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
    // Tell every open tab that a new SW is now in control so
    // they can choose to reload if they're currently mid-broken.
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const c of clients) {
      try { c.postMessage({ type: 'SW_ACTIVATED', version: SW_VERSION }); } catch {}
    }
  })());
});

// Allow the page to imperatively swap in a waiting SW (used by
// the register script's "update available" flow).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Helper — is this a request for one of CRA's hashed assets?
// They all live under /static/(js|css|media)/ and contain a
// dot-hash before the extension. We only care about these for
// the broken-bundle broadcast — every other GET passes
// straight through to the network.
function isHashedAsset(url) {
  try {
    const u = new URL(url);
    return /\/static\/(js|css|media)\//.test(u.pathname);
  } catch { return false; }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 1. Navigations (HTML documents) — network first so users
  //    always see the latest index.html.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        return res;
      } catch (e) {
        // Offline fallback — let the browser surface its own
        // default offline page; don't serve stale HTML.
        return new Response(
          '<!doctype html><meta charset=utf-8><title>Offline</title>'
          + '<body style="background:#04060A;color:#fff;font:14px system-ui;padding:24px;">'
          + 'You appear to be offline. Reconnect and refresh.</body>',
          { status: 503, headers: { 'Content-Type': 'text/html' } },
        );
      }
    })());
    return;
  }

  // 2. Hashed CRA bundles — if the network returns 404, the
  //    page is currently broken (referencing a deleted bundle).
  //    Broadcast a reload request to the page so the register
  //    script can force a hard refresh.
  if (isHashedAsset(req.url)) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.status === 404) {
          const clients = await self.clients.matchAll({ type: 'window' });
          for (const c of clients) {
            try {
              c.postMessage({ type: 'RELOAD_REQUIRED', url: req.url, reason: 'stale_bundle_404' });
            } catch {}
          }
        }
        return res;
      } catch (e) {
        // Network error on a hashed asset = currently broken.
        // Surface the same reload signal so the client can recover.
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const c of clients) {
          try {
            c.postMessage({ type: 'RELOAD_REQUIRED', url: req.url, reason: 'network_error' });
          } catch {}
        }
        throw e;
      }
    })());
    return;
  }
  // Every other request: pass through unmodified.
});
