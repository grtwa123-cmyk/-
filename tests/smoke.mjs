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

/*
 * The catalogue is the list, and three hub pages plus the landing page's
 * screen-reader navigation each repeat it in markup — a card and a link per
 * experiment, written by hand so that a reader with no JavaScript, and a
 * crawler, still get the whole site. Nothing held those copies to the
 * catalogue: an experiment could be added to the list and never appear on
 * its hub, or linger on a hub after being renamed, and every existing check
 * would pass. Counts alone would not do it either — the hubs had the right
 * number of cards while nothing checked they were the right ones.
 */
const HUB = { Physics: "physics.html", Chemistry: "chemistry.html", Biology: "biology.html" };
const hubText = Object.fromEntries(Object.entries(HUB)
  .map(([c, f]) => [c, fs.readFileSync(path.join(root, f), "utf8")]));
const indexText = fs.readFileSync(path.join(root, "index.html"), "utf8");

const offHub = [], offIndex = [];
for (const e of EXPERIMENTS) {
  const card = `class="card" href="${e.url}"`;
  if (!hubText[e.cat] || !hubText[e.cat].includes(card)) offHub.push(`${e.url} not on ${HUB[e.cat]}`);
  if (!indexText.includes(`href="${e.url}"`)) offIndex.push(e.url);
}
check(`every catalogue entry has a card on its own hub — ${EXPERIMENTS.length} experiments`,
  offHub.length === 0, offHub.slice(0, 4).join("; "));
check("and a link in the landing page's screen-reader navigation",
  offIndex.length === 0, offIndex.slice(0, 4).join(", "));

const known = new Set(EXPERIMENTS.map((e) => e.url));
const strays = [];
for (const [cat, file] of Object.entries(HUB)) {
  for (const m of hubText[cat].matchAll(/class="card" href="(experiments\/[a-z0-9]+\.html)"/g)) {
    if (!known.has(m[1])) strays.push(`${file} still shows ${m[1]}`);
    else if (EXPERIMENTS.find((e) => e.url === m[1]).cat !== cat) {
      strays.push(`${m[1]} is filed under ${EXPERIMENTS.find((e) => e.url === m[1]).cat} but carded on ${file}`);
    }
  }
}
check("and no hub carries a card the catalogue does not",
  strays.length === 0, strays.slice(0, 4).join("; "));

/*
 * And the fourth copy, which nothing was watching: the <noscript> list on the
 * landing page. The index is drawn with WebGL, so without JavaScript that
 * list IS the site — and it had gone stale. Five experiments were missing
 * from it, all five added in the last fortnight, and the impact page was
 * still under a title it had outgrown. The screen-reader check above did not
 * see it because that one reads the <nav>.
 *
 * Held to the catalogue in both directions, and to the English dictionary for
 * the words, since a link a reader cannot recognise is only half a link.
 */
{
  const ns = (indexText.match(/<noscript>[\s\S]*?<\/noscript>/) || [""])[0];
  const listed = new Map([...ns.matchAll(/href="(experiments\/[a-z0-9]+\.html)">([^<]*)<\/a>/g)]
    .map((m) => [m[1], m[2]]));
  const missing = EXPERIMENTS.filter((e) => !listed.has(e.url)).map((e) => e.url);
  const stray = [...listed.keys()].filter((u) => !known.has(u));
  check(`the no-JavaScript list is the catalogue — ${EXPERIMENTS.length} experiments, both ways`,
    missing.length === 0 && stray.length === 0,
    [...missing.map((u) => `missing ${u}`), ...stray.map((u) => `stray ${u}`)].slice(0, 5).join(", "));

  // The English titles, read out of the dictionary as source. \uXXXX is the
  // only escape the file uses; JSON.parse handles it and rejects anything odd.
  const enTitles = Object.fromEntries(
    [...fs.readFileSync(path.join(root, "i18n", "en.js"), "utf8")
      .matchAll(/^\s{2}([A-Za-z_]\w*):\s*("(?:[^"\\]|\\.)*"),$/gm)]
      .map((m) => [m[1], JSON.parse(m[2])]));
  const decode = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const wrong = EXPERIMENTS
    .filter((e) => listed.has(e.url) && decode(listed.get(e.url)) !== enTitles[e.titleKey])
    .map((e) => `${e.url}: "${decode(listed.get(e.url))}" vs "${enTitles[e.titleKey]}"`);
  check("and each entry is under the title the dictionary gives it",
    wrong.length === 0, wrong.slice(0, 3).join("; "));
}

/*
 * And the experiment pages themselves. Every stage on the site is computed in
 * the browser, so with JavaScript off the reader got a blank rectangle, dials
 * that do nothing, and no word about why — on 41 of 42 pages. The prose is all
 * in the markup and stays readable, so each page now says so.
 *
 * Checked as source rather than in a browser: it is markup being present, and
 * a page added without it should fail before anything is launched. The two
 * full-bleed 3D pages do not link styles.css, so theirs carry their own
 * declarations; both spellings are accepted, an empty <noscript> is not.
 */
{
  const naked = [];
  for (const f of fs.readdirSync(path.join(root, "experiments")).filter((n) => n.endsWith(".html"))) {
    const src = fs.readFileSync(path.join(root, "experiments", f), "utf8");
    const ns = (src.match(/<noscript>[\s\S]*?<\/noscript>/) || [""])[0];
    if (!/class="noscript-note"/.test(ns)) naked.push(f);
    else if (ns.replace(/<[^>]*>/g, "").trim().length < 80) naked.push(`${f} (note is empty)`);
  }
  check("every experiment page says something when JavaScript is off",
    naked.length === 0, naked.slice(0, 5).join(", "));
}

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

// The landing page's canvas wall is drawn from the catalogue, so it grows on
// its own — but the screen-reader nav beside it is hand-written markup, and
// the README promises it links every experiment. It sat at 36 links while the
// catalogue held 38: the two newest pages existed for sighted readers only.
{
  const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const nav = (idx.match(/<nav class="sr-only"[\s\S]*?<\/nav>/) || [""])[0];
  const missing = EXPERIMENTS.filter((e) => !nav.includes(`href="${e.url}"`));
  check("the screen-reader nav links every experiment in the catalogue",
    nav.length > 0 && missing.length === 0,
    missing.map((e) => e.url).join(", ") || "no sr-only nav found");
}

// ── SEO assets ────────────────────────────────────────────────────────────
// sitemap.xml is generated from the catalogue by tools/build-seo.mjs. A
// catalogue that grows and a sitemap that does not is the usual way these
// start lying, so the drift is a test failure rather than a silent omission.
{
  const sitemapPath = path.join(root, "sitemap.xml");
  if (!fs.existsSync(sitemapPath)) {
    check("sitemap.xml exists", false, "run node tools/build-seo.mjs");
  } else {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const missing = EXPERIMENTS.filter((e) => !xml.includes(`/${e.url}<`));
    const hubsMissing = Object.values(hubs).filter((h) => !xml.includes(`/${h}<`));
    check("sitemap.xml lists every experiment and hub",
      missing.length === 0 && hubsMissing.length === 0,
      [...missing.map((e) => e.url), ...hubsMissing].join(", ") +
      " — run node tools/build-seo.mjs");
  }
  check("robots.txt exists and points at the sitemap",
    fs.existsSync(path.join(root, "robots.txt")) &&
    fs.readFileSync(path.join(root, "robots.txt"), "utf8").includes("sitemap.xml"));

  // The same failure the sitemap check exists for, spread over three files:
  // six sentences open by counting the catalogue. They said 36, 36, 36, 36,
  // 36 and — on the social card — 32, while the catalogue held 37. Every
  // search result and every share card was repeating a number nobody had
  // updated, and the whole suite passed, because nothing was looking.
  //
  // Two checks, because there are two ways to get this wrong. First: does
  // every number on disk match the catalogue.
  {
    const wrong = [];
    for (const f of ["index.html", "package.json", "README.md"]) {
      const text = fs.readFileSync(path.join(root, f), "utf8");
      for (const m of text.matchAll(/(\d+) (?:hands-on|experiments)\b/g)) {
        if (Number(m[1]) !== EXPERIMENTS.length) wrong.push(`${f}: "${m[0]}"`);
      }
    }
    check("every sentence that counts the experiments counts the ones there are",
      wrong.length === 0,
      `${wrong.join(", ")} — catalogue has ${EXPERIMENTS.length}`
      + " — run node tools/build-seo.mjs");
  }

  // Second: the card image. That one is worse than the rest, because a number
  // baked into a JPEG cannot be read by any check here — the only place to
  // catch it is before it is drawn. It said 32, and was missed on the pass
  // that fixed the meta tags: that search covered the pages and the
  // dictionaries but not the generator. So no count may be hand-written
  // anywhere in the script that draws it.
  {
    const src = fs.readFileSync(path.join(root, "tools/build-seo.mjs"), "utf8");
    const literal = src.match(/[0-9]+ (?:hands-on|experiments)\b/g) || [];
    check("no count is hand-written in the script that draws the social card",
      literal.length === 0,
      `${literal.join(", ")} — use EXPERIMENTS.length`);
  }

  const card = path.join(root, "assets/og-cover.jpg");
  check("the social card exists and is a sane size",
    fs.existsSync(card) && fs.statSync(card).size > 10_000 &&
    fs.statSync(card).size < 1_000_000,
    fs.existsSync(card) ? `${(fs.statSync(card).size / 1024) | 0} KB` : "missing");

  const noCard = [];
  for (const p of ["index.html", ...Object.values(hubs),
                   ...EXPERIMENTS.map((e) => e.url)]) {
    if (!fs.readFileSync(path.join(root, p), "utf8").includes("og:image")) noCard.push(p);
  }
  check("every page declares og:image", noCard.length === 0, noCard.slice(0, 4).join(", "));
}

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

  // Port 0: the OS picks a free one. A fixed port collides with whatever the
  // reader happens to have left running, and a test that fails because of
  // that is a test that cries wolf.
  await new Promise((ok, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", ok);
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

    // On a phone the whole point of the page — the experiment — sat below
    // every slider and an open Notes panel: two full screens of controls
    // before the reader saw anything move. The stage must come first there.
    {
      const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
      await page.goto(`${base}/experiments/pendulum.html`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const tops = await page.evaluate(() => ({
        panel: document.querySelector(".panel").getBoundingClientRect().top,
        stage: document.querySelector(".stage").getBoundingClientRect().top,
      }));
      await page.close();
      check("on a phone the stage comes before the controls",
        tops.stage < tops.panel,
        `stage at ${Math.round(tops.stage)}px, panel at ${Math.round(tops.panel)}px`);
    }

    /*
     * Nothing must scroll sideways on a phone, in any of the three languages.
     *
     * The experiment pages each check this for themselves, in English. The
     * landing page, the three hubs, 404 and offline have no suite at all, and
     * 404 and offline were scrolling 70px sideways at 320px in every
     * language: the decorative glow behind their heading is 460px across,
     * 90px wider than the header on a phone, and the rule that draws it is
     * scoped to bodies with no data-theme — which is exactly those two pages
     * and nothing else. It had sat there unseen because no check ever opened
     * them at that width. The hubs were 2px over as well, from a tab strip
     * that would not shrink.
     */
    {
      const wide = [];
      for (const rel of ["index.html", "physics.html", "chemistry.html", "biology.html",
                         "404.html", "offline.html"]) {
        for (const lang of ["en", "ko", "zh"]) {
          const page = await browser.newPage({ viewport: { width: 320, height: 800 } });
          await page.addInitScript((l) => {
            try { localStorage.setItem("lang", l); } catch (e) { /* private mode */ }
          }, lang);
          await page.goto(`${base}/${rel}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(700);
          const over = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
          await page.close();
          if (over > 1) wide.push(`${rel} [${lang}] +${over}px`);
        }
      }
      check("no page outside experiments/ scrolls sideways at 320px, in any language",
        wide.length === 0, wide.slice(0, 5).join(", "));
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
