/*
 * Shared plumbing for the browser suites.
 *
 * Every suite used to open with the same twenty lines: launch Chromium from a
 * hard-coded path, point at a server someone was supposed to have started on
 * port 8901, and hope. The server died often enough during a long session that
 * a dead one was a more common cause of a red run than a real regression.
 *
 * So each suite now serves the repo itself, on an ephemeral port, for exactly
 * as long as it runs. Nothing to start first, and two suites can run at once
 * without agreeing on a port.
 */

import { createRequire } from "node:module";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function startServer() {
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(ROOT, url === "/" ? "index.html" : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", () => ok(server));
  });
}

const server = await startServer();
/** Root URL of the site under test, e.g. http://127.0.0.1:53124 */
export const BASE = `http://127.0.0.1:${server.address().port}`;
/** URL for a path relative to the repo root. */
export const url = (rel) => `${BASE}/${rel.replace(/^\//, "")}`;

// Chromium is resolved from CHROMIUM_PATH, which the SessionStart hook exports
// and CI sets explicitly. Playwright's own lookup is not trusted here: the
// sandbox image's build and the package's expected build differ.
const chromiumPath = process.env.CHROMIUM_PATH;
if (!chromiumPath || !fs.existsSync(chromiumPath)) {
  console.error("CHROMIUM_PATH is unset or does not exist — cannot run browser suites.");
  console.error("Run .claude/hooks/session-start.sh, or set it by hand.");
  server.close();
  process.exit(2);
}

const { chromium } = createRequire(import.meta.url)("playwright");

export const browser = await chromium.launch({
  executablePath: chromiumPath,
  args: ["--no-sandbox", "--disable-dev-shm-usage",
         "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});

export const rows = [];
export const chk = (n, ok, d = "") => rows.push({ n, ok, d });

/*
 * A suite that dies still knows something.
 *
 * Results are buffered and printed by finish(), so anything that throws first
 * — a selector that never appears, a click on a control the page failed to
 * build — took every check gathered up to that point down with it. The stack
 * trace named the line that threw and nothing about the twenty checks that had
 * already passed or failed, which is the half that says *why*.
 *
 * Found by planting one: loading the solar system's simulation before three.js
 * makes its source checks fail and then, forty lines later, kills the suite on
 * a chip that was never rendered. The failures were correct and invisible.
 */
let reported = false;
for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (err) => {
    if (!reported && rows.length) {
      reported = true;
      console.log("\n=== results gathered before the crash ===");
      for (const r of rows) {
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.n}${r.ok || !r.d ? "" : "  ::  " + r.d}`);
      }
    }
    console.error(`\n${event}: ${(err && err.stack) || err}`);
    process.exit(1);
  });
}

/** Print the results, tear everything down, exit non-zero on any failure. */
export async function finish(title) {
  let failed = 0;
  if (title) console.log(`\n=== ${title} ===`);
  for (const r of rows) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.n}${r.ok || !r.d ? "" : "  ::  " + r.d}`);
    if (!r.ok) failed++;
  }
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  await browser.close();
  await new Promise((ok) => server.close(ok));
  process.exit(failed ? 1 : 0);
}

/*
 * The two 3D pages fetch three.js from a CDN, and where that fetch works
 * differs by machine: CI reaches it, this project's development container
 * does not — its headless browser has no route out, though curl does. For a
 * long time that difference was recorded backwards, as "CI cannot reach the
 * CDN", and it cost both pages their suites.
 *
 * So the suites do not depend on which side of that they are running on.
 * Every CDN request is fulfilled from a cache on disk, filled by curl the
 * first time and reused after, which also means neither suite goes to the
 * network at all on a second run and neither can be turned red by someone
 * else's outage.
 *
 * Call it on a context before opening the page:
 *     const ctx = await browser.newContext(...);
 *     await serveCdn(ctx);
 */
const CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com"];
const CDN_CACHE = path.join(os.tmpdir(), "sciencelab-cdn-cache");

export async function serveCdn(ctx) {
  fs.mkdirSync(CDN_CACHE, { recursive: true });
  for (const host of CDN_HOSTS) {
    await ctx.route(`**://${host}/**`, async (route) => {
      const href = route.request().url();
      const file = path.join(CDN_CACHE,
        createHash("sha1").update(href).digest("hex") + ".js");
      try {
        if (!fs.existsSync(file)) {
          execFileSync("curl", ["-fsS", "--max-time", "60", href, "-o", file],
                       { stdio: ["ignore", "ignore", "pipe"] });
        }
        await route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: fs.readFileSync(file),
        });
      } catch {
        fs.rmSync(file, { force: true });
        await route.abort();
      }
    });
  }
}
