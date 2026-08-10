/*
 * The service worker, and the one thing service workers get wrong.
 *
 * sw.js is deliberately network-first: nothing on this site carries a content
 * hash in its filename, so a cache-first worker can serve an old stylesheet
 * against new markup and a reader has no way to ask for the current one. The
 * checks below come in two halves — that offline works at all, and that being
 * online is never stale, which is the half that would fail silently.
 *
 * Offline is simulated by stopping a server, not by asking Playwright
 * -----------------------------------------------------------------
 * context.setOffline(true) does not reach a service worker's own fetch(). It
 * was tried, and every offline check passed while the worker was quietly
 * serving live responses from the network: a page never visited rendered its
 * real heading, and a fetch() from the page returned 200. Those checks would
 * have passed with no service worker in the repo at all.
 *
 * So this suite runs its own copy of the site on its own port and closes it,
 * sockets and all. That is the real condition — the origin stops answering,
 * for the page and the worker alike — and it cannot be faked by a worker that
 * is secretly online.
 */
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { browser, chk, finish } from "./lib/harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/*
 * A server this suite owns, so it can be taken away. `extra` lets a check
 * serve a body from memory and change it between loads, which is how the
 * staleness check changes a file without writing into the repo.
 */
function siteServer(extra) {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]);
    if (extra.has(rel)) {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(extra.get(rel));
      return;
    }
    const file = path.join(ROOT, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({
    base: `http://127.0.0.1:${server.address().port}`,
    // close() alone waits for keep-alive connections the browser is holding
    // open, which never end on their own — the sockets have to go too.
    stop: () => new Promise((done) => {
      for (const s of sockets) s.destroy();
      server.close(() => done());
    }),
  })));
}

// ── The worker is shipped, versioned, and asked for ──────────────────
{
  const sw = read("sw.js");
  const pkg = JSON.parse(read("package.json"));
  const m = sw.match(/const VERSION = "([^"]+)"/);
  chk("sw.js names a version", Boolean(m), m ? m[1] : "none");
  // The cache name is the whole invalidation story, so a release that forgets
  // to bump it ships a worker still serving the previous release's files to
  // anyone offline.
  chk("and it is the package version, so a release invalidates the cache",
      Boolean(m) && m[1] === pkg.version, `sw.js ${m && m[1]} vs package.json ${pkg.version}`);

  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"))
    .concat(fs.readdirSync(path.join(ROOT, "experiments"))
              .filter((f) => f.endsWith(".html")).map((f) => `experiments/${f}`));
  const missing = pages.filter((p) => {
    const want = p.includes("/") ? "../assets/offline.js" : "assets/offline.js";
    return !read(p).includes(`src="${want}"`);
  });
  chk(`every page registers the worker — ${pages.length} of them`,
      missing.length === 0, missing.slice(0, 5).join(", "));
}

/**
 * Wait for a controlling worker, but never for long.
 *
 * Every wait in this suite is bounded, and that is not tidiness. Planting
 * "registration never happens" made the first version hang instead of fail:
 * navigator.serviceWorker.ready is a promise that simply never settles when no
 * worker arrives, so the suite sat there until the runner was killed. A defect
 * has to produce a red line, not a stuck process.
 */
const swReady = (page, ms = 8000) => page.evaluate((limit) => Promise.race([
  navigator.serviceWorker.ready.then(() => true),
  new Promise((r) => setTimeout(() => r(false), limit)),
]), ms);

/**
 * A context whose worker is installed and controlling, with `pagePath` in the
 * cache.
 */
async function warmed(base, pagePath) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/${pagePath}`, { waitUntil: "networkidle" });
  const ready = await swReady(page);
  // The first load races registration, so the document itself may not be
  // stored yet. A second pass, with the worker in charge, puts it there.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
  return { ctx, page, ready, controlled };
}

// ── Offline, a page you have opened still works ──────────────────────
{
  const srv = await siteServer(new Map());
  const { ctx, page, ready, controlled } = await warmed(srv.base, "experiments/wave.html");
  chk("the worker installs and takes control of the page", ready && controlled,
      `ready ${ready}, controller ${controlled}`);

  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await srv.stop();                                  // the network is gone

  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    title: document.title,
    heading: (document.querySelector("h1") || {}).textContent || "",
    font: getComputedStyle(document.body).fontFamily,
    canvas: !!document.querySelector("canvas"),
    controls: document.querySelectorAll("input, button").length,
  })).catch((e) => ({ title: `(page did not load: ${e.message.slice(0, 40)})`,
                      heading: "", font: "", canvas: false, controls: 0 }));
  chk("with the server stopped, a visited experiment still loads",
      /Wave|Interference/i.test(state.title), state.title || "(blank)");
  chk("with its stylesheet", /Pretendard/.test(state.font), state.font.slice(0, 40));
  chk("and its simulation and controls on the page",
      state.canvas && state.controls > 3, `canvas ${state.canvas}, ${state.controls} controls`);
  chk("and nothing threw without a network", errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}

// ── Offline, a page you have not opened says so ──────────────────────
{
  const srv = await siteServer(new Map());
  const { ctx, page } = await warmed(srv.base, "physics.html");
  const target = `${srv.base}/experiments/neuron.html`;
  await srv.stop();

  await page.goto(target, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForTimeout(700);
  const shown = await page.evaluate(() => ({
    h1: (document.querySelector("h1") || {}).textContent || "",
    links: document.querySelectorAll("a").length,
  })).catch((e) => ({ h1: `(nothing loaded: ${e.message.slice(0, 40)})`, links: 0 }));
  chk("a page never visited gets the offline notice, not a browser error",
      /Offline/i.test(shown.h1), shown.h1 || "(nothing rendered)");
  chk("and it offers somewhere to go", shown.links >= 4, String(shown.links));
  await ctx.close();
}

// ── Online is never a version behind ─────────────────────────────────
{
  /*
   * The failure this whole design exists to avoid. A file changes between two
   * online loads and the second load has to show the change. A cache-first
   * worker passes every check above and fails exactly here.
   */
  const extra = new Map([["/probe.js", 'window.__probe = "first";\n']]);
  const srv = await siteServer(extra);
  const { ctx, page } = await warmed(srv.base, "physics.html");

  const pull = () => page.evaluate((src) => new Promise((res) => {
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => res(window.__probe);
    el.onerror = () => res("(failed)");
    document.head.appendChild(el);
  }), `${srv.base}/probe.js`);

  const first = await pull();
  extra.set("/probe.js", 'window.__probe = "second";\n');
  const second = await pull();
  chk("a file the worker has cached is still fetched fresh while online",
      first === "first" && second === "second",
      `first load ${first}, after it changed ${second}`);

  // And it really was cached — otherwise the check above would also pass on a
  // worker that stores nothing, which would fail offline instead.
  const where = await page.evaluate(async (u) => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      if (await c.match(u)) return k;
    }
    return null;
  }, `${srv.base}/probe.js`);
  chk("while still storing a copy for when there is no network",
      Boolean(where), String(where));

  await ctx.close();
  await srv.stop();
}

// ── A new version throws the old cache away ──────────────────────────
{
  const srv = await siteServer(new Map());
  const { ctx, page } = await warmed(srv.base, "physics.html");

  // Leave behind what a previous release would have: its own cache, which
  // nothing will read again and which holds a whole copy of the site.
  await page.evaluate(async () => {
    const c = await caches.open("science-lab-v0.0.1");
    await c.put("/stale", new Response("old"));
  });
  const before = await page.evaluate(() => caches.keys());

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.unregister();
  });
  await page.reload({ waitUntil: "networkidle" });
  await swReady(page);
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => caches.keys());

  chk("a stale cache from an older version is there to begin with",
      before.includes("science-lab-v0.0.1"), before.join(", "));
  chk("and activating the worker deletes it",
      !after.includes("science-lab-v0.0.1") && after.length > 0, after.join(", "));
  await ctx.close();
  await srv.stop();
}

// ── The CDN is left alone ────────────────────────────────────────────
{
  /*
   * Three.js and gsap are cross-origin, and the wall's fallback depends on a
   * failed request looking like a failed request. A worker that answered for
   * them — from a cache, or with an error of its own — would change behaviour
   * the view-switcher suite pins down.
   */
  const srv = await siteServer(new Map());
  const { ctx, page } = await warmed(srv.base, "index.html");
  const foreign = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      for (const r of await c.keys()) {
        if (!r.url.startsWith(location.origin)) out.push(r.url);
      }
    }
    return out;
  });
  chk("nothing cross-origin is in the cache", foreign.length === 0, foreign.slice(0, 3).join(" "));
  await ctx.close();
  await srv.stop();
}

await finish("offline");
