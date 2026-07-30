/* Portfolio Tracker — service worker (phone shell).
 *
 * Registered ONLY in shell mode (cloud.js gates on github.io) — local dev via
 * server.py never fights a cache. All shell paths are RELATIVE so precache
 * resolves against the Pages project scope.
 *
 * Strategy:
 *   - App shell + static assets (relative, same-origin): cache-first, precached.
 *   - Navigations: cache-first to 'index.html'.
 *   - CDN scripts (cdn.jsdelivr.net) + Google Fonts: stale-while-revalidate
 *     runtime cache — the app (and sign-in) keeps working offline. SRI still
 *     verifies every cached byte at execute time.
 *   - Same-origin '/data/': NETWORK ONLY (local-mode paths; never on Pages).
 *   - Supabase auth/data (cross-origin): untouched — never intercepted, never
 *     cached. Portfolio data must not sit in a shared HTTP cache.
 *
 * Bump VERSION on any shell change — activate deletes all older caches.
 * tools/publish_shell.py asserts the published version matches this constant.
 */
const VERSION = 'v1.0.2';
const SHELL_CACHE = `portfolio-shell-${VERSION}`;
const RUNTIME_CACHE = `portfolio-runtime-${VERSION}`;

const SHELL = [
  'index.html',
  'cloud.js',
  'app.js',
  'style.css',
  'manifest.webmanifest',
  'static/icon.svg',
  'static/icon-180.png',
  'static/icon-192.png',
  'static/icon-512.png',
  'static/icon-512-maskable.png',
];

// Cross-origin hosts allowed in the runtime cache (static assets only).
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // {cache:'reload'} bypasses the HTTP cache so a version bump always
      // precaches the freshly deployed shell, never a heuristically-cached copy.
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('portfolio-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // saves/auth pass straight through

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Local-mode data paths: network only, never cached (defensive — the shell
  // never requests these, but a stale cache here would be a data bug).
  if (sameOrigin && url.pathname.includes('/data/')) {
    event.respondWith(fetch(req));
    return;
  }

  // CDN + fonts: stale-while-revalidate.
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const refresh = fetch(req)
          .then((resp) => {
            if (resp && (resp.ok || resp.type === 'opaque')) cache.put(req, resp.clone());
            return resp;
          })
          .catch(() => cached);
        return cached || refresh;
      })
    );
    return;
  }

  // Anything else cross-origin (Supabase, price proxies): untouched.
  if (!sameOrigin) return;

  // Navigations: serve the shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match('index.html');
        return cached || fetch(req);
      })
    );
    return;
  }

  // App shell + static assets within our scope: cache-first with network fill.
  const scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(scopePath)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const resp = await fetch(req);
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      })
    );
  }
});
