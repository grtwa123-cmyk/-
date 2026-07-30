/*
 * Let the CDN-dependent pages boot under test.
 *
 * The landing wall and the two 3D tour pages load Three.js and gsap from a
 * CDN. On a CI runner that just works. In the web sandbox the browser has no
 * direct outbound route, so those requests fail and the page falls back — and
 * a fallback under test looks exactly like a regression in the real thing.
 *
 * curl does have a route, through the agent proxy, so CDN requests are served
 * from a curl-backed on-disk cache. If curl cannot fetch it either the request
 * is left to continue normally, which is what makes this safe on CI: there the
 * first attempt succeeds and the cache is never consulted.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.tmpdir(), "science-lab-cdn-cache");

/** Route CDN requests on this page through the cache. */
export function installCdnCache(page) {
  fs.mkdirSync(DIR, { recursive: true });
  return page.route("**://{cdn.jsdelivr.net,cdnjs.cloudflare.com}/**", async (route) => {
    const url = route.request().url();
    const file = path.join(DIR, url.replace(/[^a-zA-Z0-9._-]/g, "_"));
    if (!fs.existsSync(file)) {
      try {
        execFileSync("curl", ["-sSfL", "-o", file, url], { timeout: 60000 });
      } catch {
        // No route from here either — let the browser try for itself.
        try { fs.rmSync(file, { force: true }); } catch { /* nothing to remove */ }
        await route.continue();
        return;
      }
    }
    const type = /\.css($|\?)/.test(url) ? "text/css" : "text/javascript";
    await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
  });
}
