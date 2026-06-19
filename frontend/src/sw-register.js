/**
 * sw-register — registers the service worker, drives the
 * auto-update flow, and recovers from the "stale bundle"
 * black-screen failure mode.
 *
 * Recovery behaviour:
 *   1. Listens for `RELOAD_REQUIRED` messages from sw.js
 *      (fired when a hashed CRA bundle 404s). The first time
 *      we receive one we force `location.reload()` — but we
 *      do it AT MOST ONCE per page-view so we never enter a
 *      reload loop if the server is genuinely returning 404
 *      for a deeper reason.
 *   2. Listens for the SW's `controllerchange` event and
 *      reloads once when a new SW takes over after a deploy.
 *   3. Surfaces failed asset URLs to the global console with
 *      `[asset-fail]` prefix so production monitoring can
 *      grep for them without revealing user data.
 */

const RELOAD_FLAG = 'ourrealm.sw.reloaded.once';
const SW_PATH     = '/sw.js';

// Tiny structured logger — never logs secrets, only public URLs.
function logAssetFail(detail) {
  try {
    console.warn('[asset-fail]', detail);
  } catch { /* */ }
}

function safeReloadOnce(reason) {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === '1') {
      logAssetFail({ reason, action: 'reload-skipped (already reloaded once this session)' });
      return;
    }
    sessionStorage.setItem(RELOAD_FLAG, '1');
    logAssetFail({ reason, action: 'reload' });
    // location.reload() picks up the fresh index.html which
    // points to the current hashed bundles.
    setTimeout(() => { window.location.reload(); }, 30);
  } catch {
    // If sessionStorage is denied (private mode / cookie
    // restrictions), still reload — we accept the worst-case
    // single-loop possibility because the page is otherwise
    // unrecoverable.
    setTimeout(() => { window.location.reload(); }, 30);
  }
}

export function registerOurRealmSW() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  // Only register on https or localhost — browsers reject SW
  // registration over plain http (which is the same rule the
  // CRA built-in registration uses).
  const ok =
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (!ok) return;

  // Defer registration until after first paint so it never
  // blocks the initial bundle download.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_PATH, { scope: '/' })
      .then((reg) => {
        // Whenever a new SW finishes installing, ask it to
        // take over immediately. The controllerchange handler
        // below will then trigger a single reload.
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (
              nw.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              try { nw.postMessage({ type: 'SKIP_WAITING' }); } catch { /* */ }
            }
          });
        });
        // Hourly update check while the tab is open — picks up
        // a fresh deploy without requiring a manual refresh.
        setInterval(() => {
          reg.update().catch(() => { /* */ });
        }, 60 * 60 * 1000);
      })
      .catch((err) => {
        logAssetFail({ reason: 'sw-register-failed', message: String(err) });
      });

    // Message channel from sw.js → page. Two events we care
    // about: stale bundle 404 (must reload) and clean activate
    // (clears the reload-once flag so the next genuine 404
    // can also recover).
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.type === 'RELOAD_REQUIRED') {
        logAssetFail({ reason: data.reason || 'reload-required', url: data.url });
        safeReloadOnce(data.reason || 'sw-reload-required');
      }
      if (data.type === 'SW_ACTIVATED') {
        try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* */ }
      }
    });

    // controllerchange fires the first time the SW assumes
    // control of the page (i.e. immediately after a redeploy
    // where the new SW called clients.claim()). Reload once
    // so the page picks up the new hashed bundles atomically.
    let didReloadFromController = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (didReloadFromController) return;
      didReloadFromController = true;
      safeReloadOnce('controllerchange');
    });
  });

  // Best-effort recovery for the case where the user is
  // already in the broken state (no SW, stale HTML referencing
  // a missing bundle). The CRA error overlay would have caught
  // a script load failure in dev, but in prod we get a silent
  // black screen — listen on `window.error` for the missing
  // script and trigger the same single-reload recovery.
  window.addEventListener(
    'error',
    (event) => {
      const src = event?.target?.src || event?.target?.href;
      if (!src) return;
      if (!/\/static\/(js|css|media)\//.test(src)) return;
      // CRA bundle / chunk failed to load — almost always a
      // stale-HTML-referencing-deleted-hash scenario.
      logAssetFail({ reason: 'asset-load-failed', url: src });
      safeReloadOnce('asset-load-failed');
    },
    true,  // capture phase — script errors don't bubble
  );
}
