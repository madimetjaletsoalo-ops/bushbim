"use client";

import { useEffect } from "react";

/** Registers the service worker (production builds only, so development never serves stale pages). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("service worker:", e));
  }, []);
  return null;
}

/** Asks the service worker to fetch and keep pages for offline use. */
export async function warmPages(urls: string[], opts: { force?: boolean; maxAge?: number } = {}) {
  if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
  const reg = await navigator.serviceWorker.ready;
  reg.active?.postMessage({ type: "warm", urls, ...opts });
}

/** Removes every cached page and file: used on sign-out. */
export async function clearOfflineCache() {
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    reg?.active?.postMessage({ type: "clear" });
    if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("bushbim-")) await caches.delete(k);
  } catch {
    // nothing cached
  }
}
