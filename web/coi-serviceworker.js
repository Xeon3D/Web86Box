// Web86Box - cross-origin isolation via a service worker.
//
// SharedArrayBuffer (wasm threads) requires the page to be served with
// Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.
// Static hosts such as GitHub Pages cannot set headers, so this worker
// re-serves same-origin responses with them added. As a page script it
// registers itself and reloads once; it does nothing if the page is
// already isolated.
/* eslint-disable no-restricted-globals */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    e.respondWith(fetch(req).then((res) => {
      if (res.status === 0 || res.type === 'opaque') return res;
      const headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }).catch((err) => {
      console.error('coi-serviceworker fetch failed', err);
      throw err;
    }));
  });
} else if (!window.crossOriginIsolated && window.isSecureContext && navigator.serviceWorker) {
  const reloaded = sessionStorage.getItem('coiReloaded');
  navigator.serviceWorker.register(document.currentScript.src).then((reg) => {
    const reload = () => {
      if (reloaded) return; // avoid loops if isolation still fails
      sessionStorage.setItem('coiReloaded', '1');
      location.reload();
    };
    if (reg.active && !navigator.serviceWorker.controller) reload();
    else if (!navigator.serviceWorker.controller) {
      (reg.installing || reg.waiting)?.addEventListener('statechange', (ev) => {
        if (ev.target.state === 'activated') reload();
      });
    }
  }).catch((err) => console.warn('coi-serviceworker registration failed', err));
} else if (window.crossOriginIsolated) {
  sessionStorage.removeItem('coiReloaded');
}
