/*
 * Smoke test — the invariants that break quietly.
 *
 * Three of these need no browser and run anywhere:
 *
 *   catalogue  every entry in assets/index/experiments.js points at a file
 *              that exists, and its i18n title key is defined. A typo here
 *              leaves a card on the landing wall that 404s.
 *   i18n       en / ko / zh carry identical key sets. A key added to one
 *              language only falls back silently, so nothing looks wrong
 *              until someone reads the page in that language.
 *   hubs       every experiment is reachable from its category hub.
 *
 * The fourth loads the pages in Chromium and fails on a console error. It
 * needs CHROMIUM_PATH and NODE_PATH, which the SessionStart hook exports; if
 * they are missing the browser section skips rather than failing, so the test
 * is still useful on a machine without the sandbox image.
 *
 * The server is started and stopped here rather than by the hook: the pages
 * fetch siblings by relative URL so file:// will not do, and a test that owns
 * its own server can't be broken by one that died earlier in the session.
 */

import { createServer } from "node:http";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

// ── Catalogue ─────────────────────────────────────────────────────────────
const { EXPERIMENTS } = await import(
  pathToFileURL(path.join(root, "assets/index/experiments.js")).href
);

const missingFiles = EXPERIMENTS.filter((e) => !fs.existsSync(path.join(root, e.url)));
check("every catalogue entry points at a file that exists",
  missingFiles.length === 0, missingFiles.map((e) => e.url).join(", "));

const dupes = EXPERIMENTS.map((e) => e.url).filter((u, i, a) => a.indexOf(u) !== i);
check("no duplicate entries in the catalogue", dupes.length === 0, dupes.join(", "));

// ── i18n parity ───────────────────────────────────────────────────────────
// Each dictionary is a call to window.i18nRegister, so they are read as
// source rather than imported. Parity is what lets the runtime drop
// cross-language fallback: if this check goes, missing keys go silent.
const LANGS = ["en", "ko", "zh"];
const dict = {};
const presentLangs = [];
for (const lang of LANGS) {
  const file = path.join(root, "i18n", `${lang}.js`);
  if (!fs.existsSync(file)) continue;
  presentLangs.push(lang);
  dict[lang] = new Set(
    [...fs.readFileSync(file, "utf8")
      .matchAll(/^\s{2}([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]));
}

check("all three language dictionaries are present", presentLangs.length === 3,
  `found ${presentLangs.join(",")}`);

const drift = [];
for (const lang of ["ko", "zh"]) {
  for (const k of dict.en) if (!dict[lang]?.has(k)) drift.push(`${lang} missing ${k}`);
  for (const k of dict[lang] ?? []) if (!dict.en.has(k)) drift.push(`${lang} extra ${k}`);
}
check(`en/ko/zh key sets are identical (${dict.en?.size ?? 0} keys)`,
  drift.length === 0, drift.slice(0, 5).join("; "));

const missingTitles = EXPERIMENTS.filter((e) => !dict.en.has(e.titleKey));
check("every catalogue title key is defined",
  missingTitles.length === 0, missingTitles.map((e) => e.titleKey).join(", "));

// ── Hub reachability ──────────────────────────────────────────────────────
const hubs = { Physics: "physics.html", Chemistry: "chemistry.html", Biology: "biology.html" };
const unlinked = [];
for (const [cat, hub] of Object.entries(hubs)) {
  const html = fs.readFileSync(path.join(root, hub), "utf8");
  for (const e of EXPERIMENTS.filter((x) => x.cat === cat)) {
    if (!html.includes(e.url)) unlinked.push(`${e.url} not on ${hub}`);
  }
}
check("every experiment is linked from its category hub",
  unlinked.length === 0, unlinked.join(", "));

// ── Browser ───────────────────────────────────────────────────────────────
const chromiumPath = process.env.CHROMIUM_PATH;
let browserRan = false;

if (!chromiumPath || !fs.existsSync(chromiumPath)) {
  console.log("note: CHROMIUM_PATH unset or missing — skipping the browser section.");
  console.log("      Run the SessionStart hook, or set it by hand, to enable it.\n");
} else {
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                 ".json": "application/json", ".svg": "image/svg+xml" };
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.join(root, url === "/" ? "index.html" : url);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });

  const port = Number(process.env.SCIENCE_LAB_PORT) || 8901;
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(port, "127.0.0.1", ok);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // NODE_PATH is honoured by CommonJS resolution only — ESM `import()`
    // ignores it — and playwright is installed globally in the sandbox image.
    const { chromium } = createRequire(import.meta.url)("playwright");
    const browser = await chromium.launch({
      executablePath: chromiumPath,
      args: ["--no-sandbox", "--disable-dev-shm-usage",
             "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
    });

    // The landing page plus one experiment per category — enough to catch a
    // broken shared script without running all 32 every time.
    const pages = ["index.html", ...Object.values(hubs),
      ...["Physics", "Chemistry", "Biology"]
        .map((c) => EXPERIMENTS.find((e) => e.cat === c)?.url).filter(Boolean)];

    for (const rel of pages) {
      const errors = [];
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${base}/${rel}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      const title = (await page.title()).trim();
      await page.close();
      check(`${rel} loads with no console errors`, errors.length === 0 && title.length > 0,
        errors.slice(0, 2).join(" | ") || `title="${title}"`);
    }

    await browser.close();
    browserRan = true;
  } catch (err) {
    check("browser section runs", false, String(err.message).split("\n")[0]);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
}

// ── Report ────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok || !r.detail ? "" : "  ::  " + r.detail}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed}/${results.length} passed` +
  (browserRan ? "" : "  (browser section skipped)"));
process.exit(failed ? 1 : 0);
