/*
 * Service worker — the site keeps working without a network.
 *
 * Everything here is self-hosted already: no framework, no runtime
 * dependency, and the landing page falls back to the plain table view when the
 * CDN that serves Three.js cannot be reached. So a reader who has opened a
 * page has, in principle, everything that page needs. This makes that true in
 * practice.
 *
 * Network first, cache second
 * ---------------------------
 * The tempting strategy is cache-first: it makes a repeat visit instant. It
 * also makes a stale one. Nothing on this site carries a content hash in its
 * filename — styles.css is styles.css in every version — so a cache-first
 * worker can serve last week's stylesheet against this week's markup, and the
 * reader has no way to ask for the current one. That failure is silent, it
 * survives a reload, and it is the reason service workers have the reputation
 * they do.
 *
 * So the network is always asked first and the cache is only the answer when
 * there is no network. Online, a reader is never a version behind; offline,
 * every page they have already opened still works. HTTP caching already makes
 * the repeat visit fast, and it revalidates, which is the part that matters.
 *
 * The promise, stated exactly: pages you have visited work offline. A page you
 * have never opened gets offline.html, because its markup was never fetched
 * and inventing something for it would be a lie about what is stored.
 */

// Bumped with the package version; tests/offline.test.mjs fails if the two
// disagree. The name is the whole invalidation story — a new version is a new
// cache, and activate deletes every older one.
const VERSION = "1.63.0";
const CACHE = `science-lab-v${VERSION}`;

// The one page that has to be there before it is ever requested: it is what a
// reader sees when they follow a link, offline, to somewhere they have not
// been. Everything else is cached because it was fetched.
const FALLBACK = new URL("offline.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(FALLBACK, { cache: "reload" })).catch(() => {});
    // Take over as soon as the new worker is ready rather than waiting for
    // every tab to close. Safe here because the worker holds no state a page
    // depends on, and the alternative is a reader stuck on an old worker for
    // as long as they keep a tab open.
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE && key.startsWith("science-lab-v")) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Three.js and gsap come from a CDN, and their own caching is none of this
  // worker's business. Letting them fall through also keeps the wall's
  // "CDN unreachable" path exactly as it was: a failed request, not a hit on
  // some copy stored here.
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(req));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // Only successful, complete responses are worth keeping. A 404 stored now
    // is a 404 served offline forever, and an opaque response cannot be
    // inspected to know either way.
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (request.mode === "navigate") {
      const shell = await cache.match(FALLBACK);
      if (shell) return shell;
    }
    throw err;
  }
}
