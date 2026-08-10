/*
 * Registers the service worker that makes visited pages work without a
 * network. The worker itself, and why it is network-first, is in sw.js.
 *
 * A separate file rather than a line inside theme.js, which is the other
 * script every page loads: theme.js runs blocking, before first paint,
 * because a theme applied late is a visible flash. This has no such
 * constraint and no business delaying paint, so it is deferred and kept
 * apart.
 */
(() => {
  if (!("serviceWorker" in navigator)) return;   // also the file:// case

  /*
   * The worker has to be registered from the site root, or its scope would be
   * whatever directory the registering page sits in — an experiments/ page
   * would get a worker that never sees a request for the hub above it. The
   * path is resolved against this script rather than the page for the same
   * reason i18n.js resolves its dictionaries that way: experiment pages load
   * us as "../assets/offline.js" and hub pages as "assets/offline.js".
   */
  const here = document.currentScript && document.currentScript.src;
  if (!here) return;
  const root = here.replace(/assets\/offline\.js.*$/, "");

  // After load, not during it. Registering competes with the page's own
  // requests for bandwidth, and there is nothing to be gained on this visit
  // by winning that race — the worker is for the next one.
  addEventListener("load", () => {
    navigator.serviceWorker.register(`${root}sw.js`, { scope: root })
      .catch(() => { /* an unregistrable worker changes nothing for a reader */ });
  });
})();
