/* BushBIM service worker: makes the app installable and keeps recently opened pages,
   sheets and photos available offline. Changes made offline are kept by the page itself
   (IndexedDB outbox) and synced when the connection is back; this worker only caches GETs. */

const VERSION = "v1";
const PAGES = `bushbim-pages-${VERSION}`;
const FILES = `bushbim-files-${VERSION}`;
const STATIC = `bushbim-static-${VERSION}`;
const KEEP = [PAGES, FILES, STATIC];
// limits keep the cache small on phones: the most recently opened pages and files win
const MAX_PAGES = 60;
const MAX_FILES = 30;
const MAX_STATIC = 300;
const NETWORK_TIMEOUT_MS = 8000;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((c) => c.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("bushbim-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Stores a response, dropping the oldest entries beyond `max`. */
async function remember(cacheName, request, response, max) {
  if (!response || !response.ok || response.status !== 200 || response.type === "opaque") return;
  const cache = await caches.open(cacheName);
  const key = typeof request === "string" ? request : request.url;
  await cache.delete(key, { ignoreVary: true });
  await cache.put(key, response);
  // the offline page is never evicted
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname !== OFFLINE_URL);
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

const isHtml = (res) => (res.headers.get("content-type") || "").includes("text/html");

/** Pages: network first (with a timeout for slow rural links), else the copy from the last visit. */
async function page(event) {
  const req = event.request;
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS);
    // never keep a redirect (e.g. to the sign-in page) or an error page in place of the real page
    if (res.ok && !res.redirected && isHtml(res)) event.waitUntil(remember(PAGES, req.url, res.clone(), MAX_PAGES));
    return res;
  } catch {
    const cached = await caches.match(req.url, { cacheName: PAGES, ignoreVary: true });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { cacheName: PAGES, ignoreVary: true });
    return offline || Response.error();
  }
}

/** Sheets and photos: network first, falling back to the last copy. */
async function file(event) {
  const req = event.request;
  try {
    const res = await withTimeout(fetch(req), NETWORK_TIMEOUT_MS * 4);
    if (res.ok) event.waitUntil(remember(FILES, req.url, res.clone(), MAX_FILES));
    return res;
  } catch {
    const cached = await caches.match(req.url, { cacheName: FILES, ignoreVary: true });
    return cached || Response.error();
  }
}

/** Build assets have content hashes, so a cached copy is always right. */
async function asset(event) {
  const cached = await caches.match(event.request, { cacheName: STATIC });
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res.ok) event.waitUntil(remember(STATIC, event.request, res.clone(), MAX_STATIC));
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // range requests and the RSC payloads of client-side navigation go straight to the network;
  // when an RSC fetch fails offline, Next.js falls back to a full page load, which is served below
  if (req.headers.has("range") || req.headers.get("rsc") === "1" || url.searchParams.has("_rsc")) return;
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(asset(event));
  if (/^\/api\/projects\/[^/]+\/(versions\/[^/]+\/view|photos\/[^/]+)$/.test(url.pathname)) return event.respondWith(file(event));
  if (req.mode === "navigate" && url.pathname.startsWith("/projects")) return event.respondWith(page(event));
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "clear") {
    // sign-out: nothing from this account may stay on the device
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("bushbim-")).map((k) => caches.delete(k)))));
  } else if (data.type === "warm" && Array.isArray(data.urls)) {
    // pages a user may need offline without having opened them (e.g. "New issue")
    event.waitUntil(
      Promise.all(
        data.urls
          .filter((u) => typeof u === "string" && u.startsWith("/projects/"))
          .slice(0, 10)
          .map(async (u) => {
            const cached = await caches.match(u, { cacheName: PAGES, ignoreVary: true });
            // a copy younger than maxAge seconds is fresh enough (default: keep any copy)
            if (cached && !data.force) {
              const age = (Date.now() - Date.parse(cached.headers.get("date") || "")) / 1000;
              if (!data.maxAge || !(age > data.maxAge)) return;
            }
            try {
              const res = await fetch(u, { credentials: "same-origin", headers: { Accept: "text/html" } });
              if (res.ok && !res.redirected && isHtml(res)) await remember(PAGES, u, res, MAX_PAGES);
            } catch {
              // offline: nothing to warm
            }
          }),
      ),
    );
  }
});
