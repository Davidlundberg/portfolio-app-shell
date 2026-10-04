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
 *
 * Updates WAIT (2026-10-03). This worker used to skipWaiting() at install, so
 * a publish took over silently: the launch that downloaded it kept running
 * the old shell (navigations are cache-first), the next launch ran the new
 * one, and nothing on screen said which was which — an old shell could send
 * an old Ask brief to a new edge prompt. Now a new worker installs and waits;
 * the page asks for VERSION (shown in the ⋯ menu), sees the waiting worker,
 * offers "Update ready — reload", and only that tap sends SKIP_WAITING.
 * Ignoring the offer costs nothing: once no window uses the old worker (the
 * app fully closed) the waiting one takes over by itself, so a closed-and-
 * reopened app runs the new shell on the same launch as before (checked in
 * Chromium, shell sandbox — including the first hop from v1.10.5, whose page
 * has no offer to show).
 */
const VERSION = 'v1.12.0';
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
    // No skipWaiting() here — see the header: the page decides when to swap.
  );
});

// The page's side of the update handshake (cloud.js, "Shell version").
//   GET_VERSION  → reply on the transferred port with this worker's VERSION,
//                  so the ⋯ menu names the shell that actually served the page.
//   SKIP_WAITING → the user tapped "Update ready — reload".
self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  } else if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
