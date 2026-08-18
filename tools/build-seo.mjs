/*
 * Regenerate sitemap.xml and the social card.
 *
 *     node tools/build-seo.mjs
 *
 * Both are derived from assets/index/experiments.js rather than written by
 * hand, because a catalogue that grows and a sitemap that does not is the
 * normal way these end up lying. tests/smoke.mjs fails if they drift, so this
 * is the thing to run when it does.
 *
 * The card is a raster image because the social crawlers do not render SVG.
 * It is
 * drawn by the site's own motif glyphs, so it cannot show experiments the
 * catalogue no longer has.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://grtwa123-cmyk.github.io/-";

const { EXPERIMENTS } = await import(
  pathToFileURL(path.join(ROOT, "assets/index/experiments.js")).href
);

// ── sitemap.xml ───────────────────────────────────────────────────────────
const pages = ["", "physics.html", "chemistry.html", "biology.html",
  ...EXPERIMENTS.map((e) => e.url)];

const today = new Date().toISOString().slice(0, 10);
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">
${pages.map((p) => `  <url>
    <loc>${SITE}/${p}</loc>
    <lastmod>${today}</lastmod>
    <priority>${p === "" ? "1.0" : p.includes("/") ? "0.7" : "0.8"}</priority>
  </url>`).join("\n")}
</urlset>
`.replace("www.sitemap.org", "www.sitemaps.org");

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), sitemap);
console.log(`sitemap.xml — ${pages.length} URLs`);

// ── robots.txt ────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(ROOT, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log("robots.txt");

// ── the count in index.html's social text ─────────────────────────────────
// Three meta tags open by saying how many experiments there are. That number
// was written by hand and went stale the first time the catalogue grew: the
// epidemic page made it 37 while all three still said 36. Nothing noticed,
// because nothing was looking. So it is generated here, from the same array
// the sitemap comes from, and tests/smoke.mjs fails if the file drifts.
{
  const idx = path.join(ROOT, "index.html");
  const before = fs.readFileSync(idx, "utf8");
  const after = before.replace(
    /(<meta (?:name|property)="(?:[a-z:]*)description" content=")\d+( hands-on)/g,
    `$1${EXPERIMENTS.length}$2`);
  const tags = (before.match(
    /<meta (?:name|property)="(?:[a-z:]*)description" content="\d+ hands-on/g) || []).length;
  if (tags !== 3) {
    console.error(`index.html: expected 3 counted description tags, found ${tags} — `
      + "the pattern in tools/build-seo.mjs no longer matches the page");
    process.exit(1);
  }
  if (after !== before) fs.writeFileSync(idx, after);
  console.log(`index.html — ${tags} description tags say ${EXPERIMENTS.length}`
    + `${after === before ? "" : " (updated)"}`);
}

// ── The social card ───────────────────────────────────────────────────────
const chromiumPath = process.env.CHROMIUM_PATH;
if (!chromiumPath || !fs.existsSync(chromiumPath)) {
  console.error("CHROMIUM_PATH unset — skipping the social card.");
  process.exit(0);
}

const motifSrc = fs.readFileSync(path.join(ROOT, "assets/index/motifs.js"), "utf8");

// A dozen glyphs across the card, from the real catalogue.
const picks = ["projectile", "orbit", "dna", "wave", "molecule", "crystal",
  "blackhole", "spectra", "enzyme", "resonance", "lens", "diffraction"];

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{background:#0b0f1e;font-family:ui-sans-serif,system-ui,sans-serif;color:#e6ecff}
  #bg{position:absolute;inset:0}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;
        justify-content:center;padding:0 78px;box-sizing:border-box}
  h1{font-size:92px;margin:0;letter-spacing:-2px;font-weight:700}
  p{font-size:34px;margin:18px 0 0;color:#97a0bf;max-width:660px;line-height:1.35}
  .tags{margin-top:38px;display:flex;gap:14px}
  .tag{font-size:23px;padding:9px 20px;border-radius:999px;
       border:1px solid rgba(110,168,255,.35);background:rgba(110,168,255,.13);color:#bcd4ff}
</style>
<canvas id="bg" width="1200" height="630"></canvas>
<div class="wrap">
  <h1>Science Lab</h1>
  <p>32 hands-on physics, chemistry and biology simulations. Real 3D models,
     procedural sound, no build step.</p>
  <div class="tags"><span class="tag">Physics</span><span class="tag">Chemistry</span>
    <span class="tag">Biology</span><span class="tag">EN · KO · ZH</span></div>
</div>
<script type="module">
${motifSrc.replace(/^export\s+/gm, "")}
const ctx = document.getElementById('bg').getContext('2d');
const g = ctx.createLinearGradient(0, 0, 1200, 630);
g.addColorStop(0, '#0b0f1e'); g.addColorStop(0.55, '#111a33'); g.addColorStop(1, '#1b1030');
ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 630);
// A soft glow behind the glyph column so it reads against the gradient.
const glow = ctx.createRadialGradient(1010, 315, 20, 1010, 315, 340);
glow.addColorStop(0, 'rgba(110,168,255,0.16)');
glow.addColorStop(1, 'rgba(110,168,255,0)');
ctx.fillStyle = glow; ctx.fillRect(700, 0, 500, 630);

const picks = ${JSON.stringify(picks)};
ctx.globalAlpha = 0.85;
picks.forEach((key, i) => {
  const col = i % 3, row = (i / 3) | 0;
  drawMotif(ctx, key, 872 + col * 112, 132 + row * 122, 36);
});
ctx.globalAlpha = 1;
window.__drawn = true;
</script>`;

const tmp = path.join(ROOT, "og-card.tmp.html");
fs.writeFileSync(tmp, html);
try {
  const { chromium } = createRequire(import.meta.url)("playwright");
  const browser = await chromium.launch({
    executablePath: chromiumPath,
    args: ["--no-sandbox", "--disable-dev-shm-usage",
           "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__drawn === true, { timeout: 15000 });
  // JPEG, not PNG: the card is a smooth gradient, which PNG stores badly —
  // 469 KB against 40-odd for a quality the crawlers downscale anyway.
  await page.screenshot({ path: path.join(ROOT, "assets/og-cover.jpg"),
                          type: "jpeg", quality: 88 });
  await browser.close();
  const size = fs.statSync(path.join(ROOT, "assets/og-cover.jpg")).size;
  console.log(`assets/og-cover.jpg — 1200×630, ${(size / 1024).toFixed(0)} KB`);
} finally {
  fs.rmSync(tmp, { force: true });
}
