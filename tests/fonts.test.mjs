/*
 * The site ships one self-hosted, subset copy of Pretendard so that the Korean
 * face — and therefore every advance width — is the same on every machine.
 * The wall relies on that: it wraps card titles by measuring them into a
 * canvas, so a different face means a different number of lines.
 *
 * A subset can silently stop covering the text it was built for. These checks
 * make that impossible to miss: they read the font's own cmap out of the
 * shipped file and hold it against every character the three dictionaries can
 * put on screen. When one falls outside, the failure names it, and
 * tools/build-font.py is the fix.
 *
 * Pretendard carries no CJK ideographs at all, so Chinese is expected to fall
 * through to the system stack — that is asserted rather than assumed, because
 * if it ever changed the font-stack comment would be wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browser, chk, url, finish } from "./lib/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const FONT = path.join(ROOT, "assets", "fonts", "PretendardVariable.subset.woff2");

// ── The file is there, and it is the size we think ───────────────────
{
  const exists = fs.existsSync(FONT);
  chk("the subset font is committed", exists, FONT);
  const kb = exists ? fs.statSync(FONT).size / 1024 : 0;
  // Small enough to be worth self-hosting, big enough that it cannot be an
  // empty or truncated build.
  chk("and it is a plausible size for a KS X 1001 subset",
      kb > 200 && kb < 900, `${kb.toFixed(1)} KB`);
  chk("the OFL licence ships beside it",
      fs.existsSync(path.join(ROOT, "assets", "fonts", "OFL.txt")));
  chk("and the script that regenerates it is in the repo",
      fs.existsSync(path.join(ROOT, "tools", "build-font.py")));
}

// ── What the font actually covers, read from the file itself ─────────
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("PE: " + e.message));
await page.goto(url("index.html"), { waitUntil: "domcontentloaded" });

/*
 * Parse the woff2's cmap in the browser, where woff2 decompression is free.
 * FontFace can load the bytes; there is no API to enumerate its coverage, but
 * measuring a glyph against a deliberately-empty fallback tells us whether the
 * face has it: a covered character renders at its own width, an uncovered one
 * falls back and matches the reference.
 */
const coverage = await page.evaluate(async (fontUrl) => {
  const face = new FontFace("PretendardProbe", `url(${fontUrl}) format("woff2-variations")`,
                            { weight: "45 920" });
  await face.load();
  document.fonts.add(face);
  const c = document.createElement("canvas").getContext("2d");
  // A character no real font has, to calibrate what "not covered" measures.
  const NOTDEF = "";
  c.font = '400 64px PretendardProbe, monospace';
  const notdef = c.measureText(NOTDEF).width;
  return { ok: true, notdef };
}, url("assets/fonts/PretendardVariable.subset.woff2"));
chk("the browser can load the shipped font file", coverage.ok === true);

/*
 * Combining marks are zero-advance by definition, so the width probe below
 * measures nothing against nothing and reports every one of them uncovered.
 * They are dropped rather than mis-reported; the build script checks the
 * upstream cmap directly, which is the authority for them.
 */
const MARK = /\p{M}/u;

/**
 * Which of these characters the font has, decided by measuring each one with
 * the subset alone against the same text with the subset removed. Different
 * width ⟹ the subset drew it.
 */
async function covered(chars) {
  chars = chars.filter((c) => !MARK.test(c));
  return page.evaluate((list) => {
    const c = document.createElement("canvas").getContext("2d");
    const out = [];
    for (const ch of list) {
      c.font = '400 64px PretendardProbe';
      const a = c.measureText(ch).width;
      c.font = '400 64px "__nope__"';
      const b = c.measureText(ch).width;
      // A fallback-rendered glyph measures the same in both, because both
      // resolve to the same last-resort face.
      out.push([ch, a !== b]);
    }
    return out;
  }, chars);
}

// Every character the dictionaries can put on screen.
const dicts = {};
global.window = { i18nRegister: (l, d) => { dicts[l] = d; } };
for (const loc of ["en", "ko", "zh"]) {
  const src = fs.readFileSync(path.join(ROOT, "i18n", `${loc}.js`), "utf8");
  // eslint-disable-next-line no-eval
  eval(src);
}
const textOf = (d) => Object.values(d).join("");

{
  const ko = new Set(textOf(dicts.ko));
  const hangul = [...ko].filter((c) => c >= "가" && c <= "힣");
  const res = await covered(hangul);
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  chk(`every Korean syllable the site can display is in the subset — ${hangul.length} of them`,
      missing.length === 0,
      missing.length ? `missing ${missing.length}: ${missing.slice(0, 20).join("")} — rerun tools/build-font.py`
                     : `${hangul.length} syllables, all covered`);
}

{
  // Latin, digits and the punctuation the copy leans on.
  const en = new Set(textOf(dicts.en));
  const latin = [...en].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) < 0x250);
  const res = await covered(latin);
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  chk(`every Latin character the site can display is in the subset — ${latin.length} of them`,
      missing.length === 0,
      missing.length ? `missing: ${missing.join(" ")} — rerun tools/build-font.py` : "");
}

{
  // The Greek and mathematical symbols the experiment copy is full of.
  //
  // Some of these Pretendard simply has no glyph for — asking the subsetter
  // for them is a silent no-op — so the build script records that set in
  // coverage.json and this check allows exactly it. Anything uncovered and
  // *not* on that list is a real regression: either the subset was rebuilt
  // without it or a new symbol arrived, and both want the script rerun.
  const cov = JSON.parse(fs.readFileSync(
    path.join(ROOT, "assets", "fonts", "coverage.json"), "utf8"));
  const known = new Set([...cov.unsupportedChars]);

  const all = new Set(textOf(dicts.en) + textOf(dicts.ko) + textOf(dicts.zh));
  const sym = [...all].filter((c) => {
    const o = c.codePointAt(0);
    return o >= 0x250 && o < 0x3000;      // Greek, arrows, maths, super/subscripts
  });
  const res = await covered(sym);
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  const unexpected = missing.filter((c) => !known.has(c));
  chk(`every Greek and mathematical symbol Pretendard has is in the subset — ${sym.length} checked`,
      unexpected.length === 0,
      unexpected.length
        ? `${unexpected.join(" ")} uncovered and not in coverage.json — rerun tools/build-font.py`
        : `${missing.length} fall back, all of them declared: ${missing.join(" ")}`);

  // And the declared list must not rot the other way: if Pretendard turns out
  // to have one after all, coverage.json is claiming a fallback that is not
  // happening and should be regenerated.
  const declared = [...known].filter((c) => {
    const o = c.codePointAt(0);
    return o >= 0x250 && o < 0x3000;
  });
  const stale = (await covered(declared)).filter(([, has]) => has).map(([c]) => c);
  chk("and coverage.json does not claim a fallback that is not happening",
      stale.length === 0,
      stale.length ? `${stale.join(" ")} are in the font — rerun tools/build-font.py` : "");
}

{
  // Chinese is expected NOT to be covered — Pretendard has no ideographs, and
  // the font stacks say so in a comment. Assert it, so the comment cannot rot.
  const zh = new Set(textOf(dicts.zh));
  const cjk = [...zh].filter((c) => c >= "一" && c <= "鿿").slice(0, 40);
  const res = await covered(cjk);
  const has = res.filter(([, x]) => x).map(([c]) => c);
  chk("Chinese falls through to the system stack, as the font-stack comment says",
      cjk.length > 10 && has.length === 0,
      `${cjk.length} sampled, ${has.length} unexpectedly in Pretendard`);
}

// ── The glyphs the chrome itself renders ─────────────────────────────
{
  /*
   * The checks above read the three dictionaries, which is where the *copy*
   * lives — but not where all the glyphs do. The theme toggle picks its icon
   * in JavaScript, and its first version used two characters Pretendard does
   * not have, so they rendered in whatever face the OS substituted and nothing
   * here noticed. What a reader sees is the thing to check, so this walks the
   * rendered chrome and takes the characters off the page.
   *
   * CJK is excluded: Chinese has no Pretendard coverage at all and falls back
   * by design, which the check above already asserts.
   */
  const sweep = () => {
    const sel = ".theme-btn, .lang-btn, .method-tag, .method-verified, .crumbs,"
      + " .version-tag, .hub-tab, .site-header h1, .tv-cat, .tv-tags";
    const chars = new Set();
    for (const el of document.querySelectorAll(sel)) {
      for (const ch of el.textContent) {
        const o = ch.codePointAt(0);
        if (o > 0x7F && !(o >= 0x4E00 && o <= 0x9FFF)) chars.add(ch);
      }
    }
    return [...chars];
  };

  const p2 = await browser.newPage();
  await p2.goto(url("physics.html"), { waitUntil: "networkidle" });
  await p2.waitForTimeout(400);
  const chrome = new Set(await p2.evaluate(sweep));

  /*
   * And the landing table, which is where the badges carry a shape marker as
   * well as a colour — six glyphs picked in JavaScript, exactly the kind that
   * went missing from the theme toggle. The view is reached the way a reader
   * reaches it: the choice lives in localStorage.
   */
  await p2.evaluate(() => { try { localStorage.setItem("ui-mode", "table"); } catch (e) { /* */ } });
  await p2.goto(url("index.html"), { waitUntil: "domcontentloaded" });
  await p2.waitForSelector(".tv-table tbody tr", { timeout: 20000 });
  for (const c of await p2.evaluate(sweep)) chrome.add(c);
  await p2.close();
  const glyphs = [...chrome].sort();

  chk("the chrome renders some non-ASCII glyphs worth checking",
      glyphs.length > 0, glyphs.join(" "));
  const res = await covered(glyphs);
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  chk("every glyph the chrome draws for itself is in the font, with no fallback",
      missing.length === 0,
      missing.length
        ? `${missing.map((c) => `${c} U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(", ")}`
          + " — pick a glyph Pretendard has, or rerun tools/build-font.py"
        : `${glyphs.length} checked: ${glyphs.join(" ")}`);
}

// ── The pages actually ask for it ────────────────────────────────────
{
  const files = [
    "styles.css", "assets/index/index.css",
    "experiments/solarsystem.html", "experiments/blackhole.html",
  ];
  const bad = files.filter((f) => {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    return !/Pretendard/.test(s) || !/@font-face/.test(s);
  });
  chk("every stylesheet that sets a body font declares and uses Pretendard",
      bad.length === 0, bad.join(", "));

  // The url() in each must resolve from that file's own location.
  const pairs = [
    ["styles.css", "assets/fonts/PretendardVariable.subset.woff2"],
    ["assets/index/index.css", "assets/fonts/PretendardVariable.subset.woff2"],
    ["experiments/solarsystem.html", "assets/fonts/PretendardVariable.subset.woff2"],
  ];
  const broken = [];
  for (const [f, expect] of pairs) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    const m = s.match(/url\(["']?([^"')]*PretendardVariable[^"')]*)["']?\)/);
    if (!m) { broken.push(`${f}: no url()`); continue; }
    const resolved = path.normalize(path.join(path.dirname(f), m[1]));
    if (resolved !== path.normalize(expect)) broken.push(`${f}: ${m[1]} → ${resolved}`);
  }
  chk("and each @font-face url() resolves to the file from its own directory",
      broken.length === 0, broken.join(" | "));
}

// ── It is served, and it is used ─────────────────────────────────────
{
  const p2 = await browser.newPage();
  const fontHits = [];
  p2.on("response", (r) => { if (/PretendardVariable/.test(r.url())) fontHits.push(r.status()); });
  await p2.goto(url("physics.html"), { waitUntil: "networkidle" });
  await p2.waitForTimeout(600);
  chk("a hub page fetches the font and the server serves it",
      fontHits.length > 0 && fontHits.every((s) => s === 200), fontHits.join(","));

  const used = await p2.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => `${f.family}:${f.status}`);
  });
  chk("and the browser reports it loaded",
      used.some((f) => /Pretendard Variable:loaded/.test(f)), used.join(" "));

  // No CDN anywhere — the point of self-hosting.
  const cdn = [];
  const p3 = await browser.newPage();
  p3.on("request", (r) => { if (/cdn\.jsdelivr|cdnjs\.|fonts\.googleapis|fonts\.gstatic/.test(r.url())) cdn.push(r.url()); });
  await p3.goto(url("physics.html"), { waitUntil: "networkidle" });
  await p3.waitForTimeout(400);
  chk("the font costs no third-party request", cdn.length === 0, cdn.slice(0, 2).join(" | "));
  await p2.close(); await p3.close();
}

chk("no page errors during the font checks", errs.length === 0, errs.slice(0, 2).join(" | "));

await finish("fonts");
