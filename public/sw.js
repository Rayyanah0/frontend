/* Zenith service worker (hand-rolled, no build step).
 *
 * - Static build assets (/_next/static, hashed) and icons: cache-first, in a
 *   cache named by CACHE_VERSION so a deploy never mixes old and new assets.
 * - Public market GETs (spot, price, chain, iv, expiries): stale-while-revalidate.
 * - Anything carrying an Authorization header, any non-GET, and every other
 *   /api/ path is NEVER cached — it goes straight to the network.
 * - Page navigations: network-first, falling back to the last cached copy.
 *   RSC payload requests (?_rsc / RSC header) are never cached.
 * - Updates: a new worker waits; the page shows "New version available" and
 *   posts SKIP_WAITING, then reloads on controllerchange.
 * Bump CACHE_VERSION when changing this file's caching rules.
 */
const CACHE_VERSION = "zenith-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const MARKET_CACHE = `${CACHE_VERSION}-market`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const MARKET_PATHS = [/^\/api\/v1\/spot$/, /^\/api\/v1\/price$/, /^\/api\/v1\/chain$/, /^\/api\/v1\/iv$/, /^\/api\/v1\/expiries\//];

// Pure decision used by fetch below; kept simple so it can be unit tested.
function isCacheableMarketRequest(req) {
  if (req.method !== "GET") return false;
  if (req.headers.has("Authorization")) return false;
  const url = new URL(req.url);
  return MARKET_PATHS.some((re) => re.test(url.pathname));
}

self.addEventListener("install", () => { /* wait for SKIP_WAITING so open tabs keep a consistent version */ });

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await network) || new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("Authorization")) return; // never touch authed / mutating requests
  const url = new URL(req.url);

  if (isCacheableMarketRequest(req)) {
    e.respondWith(staleWhileRevalidate(req, MARKET_CACHE));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.searchParams.has("_rsc") || req.headers.get("RSC")) return;

  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || /^\/icon.*\.svg$/.test(url.pathname))) {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(PAGE_CACHE);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || (await cache.match("/")) || Response.error();
      }
    })());
  }
});
