/*
 * The site self-hosts a subset of Pretendard so that the Korean face — and
 * therefore every advance width — is the same on every machine. The wall
 * relies on that: it wraps card titles by measuring them into a canvas, so a
 * different face means a different number of lines.
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
 *
 * The subset ships as two files, Latin and Hangul, declared by unicode-range,
 * so a reader who renders no Hangul never fetches the 400 KB half. That saving
 * only holds while three things agree: how the glyphs were cut, what the four
 * stylesheets declare, and what a page actually renders. Each is checked
 * separately below, because a disagreement between any two of them is silent —
 * the character simply falls back to a system face and looks almost right.
 *
 * One path is not covered and cannot be: the wall's own repaint-on-language-
 * change. Running the wall needs Three.js from a CDN, CI has no route off the
 * machine, and index.html falls back to the table view here. What the wall
 * calls is checked directly; the call site in main.js says so too.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browser, chk, url, finish } from "./lib/harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const FONTS = path.join(ROOT, "assets", "fonts");
const file = (name) => path.join(FONTS, `PretendardVariable.${name}.woff2`);

// How tools/build-font.py cut the glyphs, recorded beside the files it wrote.
// Checks further down hold the four hand-written @font-face pairs to this.
const COVERAGE = JSON.parse(fs.readFileSync(path.join(FONTS, "coverage.json"), "utf8"));
const RANGES = Object.fromEntries(
  Object.entries(COVERAGE.faces || {}).map(([name, f]) => [
    name,
    f.unicodeRange.split(",").map((p) => {
      const [lo, hi] = p.trim().slice(2).split("-");
      return [parseInt(lo, 16), parseInt(hi || lo, 16)];
    }),
  ]));

/** The probe family for `ch`: the half whose declared range contains it. */
const faceOf = (ch) =>
  (RANGES.hangul || []).some(([lo, hi]) => {
    const cp = ch.codePointAt(0);
    return lo <= cp && cp <= hi;
  }) ? "PretendardHangul" : "PretendardLatin";

// ── The files are there, and they are the sizes we think ─────────────
{
  for (const [name, lo, hi] of [["latin", 20, 150], ["hangul", 250, 700]]) {
    const exists = fs.existsSync(file(name));
    chk(`the ${name} subset is committed`, exists, file(name));
    const kb = exists ? fs.statSync(file(name)).size / 1024 : 0;
    // Bracketed rather than pinned: big enough that it cannot be an empty or
    // truncated build, small enough that the two cannot have been silently
    // merged back into one.
    chk(`and it is a plausible size for the ${name} half`,
        kb > lo && kb < hi, `${kb.toFixed(1)} KB, expected ${lo}-${hi}`);
  }
  chk("the old single-file subset is gone",
      !fs.existsSync(path.join(FONTS, "PretendardVariable.subset.woff2")));
  chk("the OFL licence ships beside them",
      fs.existsSync(path.join(FONTS, "OFL.txt")));
  chk("and the script that regenerates them is in the repo",
      fs.existsSync(path.join(ROOT, "tools", "build-font.py")));
}

// ── What the font actually covers, read from the file itself ─────────
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("PE: " + e.message));
await page.goto(url("index.html"), { waitUntil: "domcontentloaded" });

/*
 * Read each woff2's coverage in the browser, where woff2 decompression is
 * free. FontFace can load the bytes; there is no API to enumerate a face's
 * cmap, but measuring a glyph against a deliberately-empty fallback tells us
 * whether the face has it: a covered character renders at its own width, an
 * uncovered one falls back and matches the reference.
 *
 * The two halves are registered under families of their own rather than under
 * one shared name. Sharing a name would put two faces on the same range, only
 * one could win per character, and "the family has it" would say nothing about
 * *which file* does — which is the whole thing the split has to get right.
 * Kept apart, each probe reads exactly one file.
 *
 * "Pretendard Variable" is left alone: that name belongs to the page's own
 * @font-face pair, and the last block here measures against it to check what a
 * reader really gets.
 */
const loaded = await page.evaluate(async (files) => {
  for (const [family, fontUrl] of files) {
    const face = new FontFace(family, `url(${fontUrl}) format("woff2-variations")`,
                              { weight: "45 920" });
    await face.load();
    document.fonts.add(face);
  }
  return true;
}, [["PretendardLatin", url("assets/fonts/PretendardVariable.latin.woff2")],
    ["PretendardHangul", url("assets/fonts/PretendardVariable.hangul.woff2")]]);
chk("the browser can load both shipped font files", loaded === true);

/*
 * Combining marks are zero-advance by definition, so the width probe below
 * measures nothing against nothing and reports every one of them uncovered.
 * They are dropped rather than mis-reported; the build script checks the
 * upstream cmap directly, which is the authority for them.
 */
const MARK = /\p{M}/u;

/**
 * Which of these characters `family` draws, decided by measuring each one in
 * that family against the same character with no webfont at all. Different
 * width ⟹ the family drew it.
 *
 * The load() first matters for the page's own family: its two faces carry a
 * unicode-range, so the browser has not requested either until something asks
 * for a character in it, and canvas measurement alone does not ask.
 */
async function covered(chars, family = "PretendardLatin") {
  chars = chars.filter((c) => !MARK.test(c));
  return page.evaluate(async ([list, fam]) => {
    await document.fonts.load(`400 64px "${fam}"`, list.join("")).catch(() => {});
    const c = document.createElement("canvas").getContext("2d");
    const out = [];
    for (const ch of list) {
      c.font = `400 64px "${fam}"`;
      const a = c.measureText(ch).width;
      c.font = '400 64px "__nope__"';
      const b = c.measureText(ch).width;
      // A fallback-rendered glyph measures the same in both, because both
      // resolve to the same last-resort face.
      out.push([ch, a !== b]);
    }
    return out;
  }, [chars, family]);
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

const ko = new Set(textOf(dicts.ko));
const hangul = [...ko].filter((c) => c >= "가" && c <= "힣");

{
  const res = await covered(hangul, "PretendardHangul");
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  chk(`every Korean syllable the site can display is in the Hangul half — ${hangul.length} of them`,
      missing.length === 0,
      missing.length ? `missing ${missing.length}: ${missing.slice(0, 20).join("")} — rerun tools/build-font.py`
                     : `${hangul.length} syllables, all covered`);

  // And the Latin half must not carry them too. Two files that both hold the
  // Hangul would download exactly as much as the one file did, so this is what
  // makes the split a split rather than a rename.
  const spill = (await covered(hangul.slice(0, 60), "PretendardLatin"))
    .filter(([, has]) => has).map(([c]) => c);
  chk("and the Latin half carries none of them, so the split is a real one",
      spill.length === 0,
      spill.length ? `${spill.length} Hangul syllables also in the Latin file: ${spill.slice(0, 10).join("")}`
                   : "60 sampled, none in the Latin file");
}

{
  // Latin, digits and the punctuation the copy leans on.
  const en = new Set(textOf(dicts.en));
  const latin = [...en].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) < 0x250);
  const res = await covered(latin, "PretendardLatin");
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  chk(`every Latin character the site can display is in the Latin half — ${latin.length} of them`,
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
  const known = new Set([...COVERAGE.unsupportedChars]);

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
  // Their codepoints sit inside the Latin half's declared range, so that is
  // the file a browser would reach for and the one worth probing.
  const cjk = [...zh].filter((c) => c >= "一" && c <= "鿿").slice(0, 40);
  const res = await covered(cjk, "PretendardLatin");
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

  /*
   * The chrome mixes scripts — the language buttons say 한국어 next to the
   * badge markers — so each glyph is probed against the half whose declared
   * range covers it, not against one file. That makes this a check on the
   * routing as well as on the coverage: a glyph cut into one file but
   * declared by the other reads as missing here.
   */
  const res = [];
  for (const g of glyphs) res.push(...await covered([g], faceOf(g)));
  const missing = res.filter(([, has]) => !has).map(([c]) => c);
  chk("every glyph the chrome draws for itself is in the font, with no fallback",
      missing.length === 0,
      missing.length
        ? `${missing.map((c) => `${c} U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(", ")}`
          + " — pick a glyph Pretendard has, or rerun tools/build-font.py"
        : `${glyphs.length} checked: ${glyphs.join(" ")}`);
}

// ── The pages actually ask for them ──────────────────────────────────
//
// Four files declare the pair by hand, and none of them can see the other
// three or the build script. These read all four and hold them to one shape.
const DECLARERS = [
  ["styles.css", "assets/fonts"],
  ["assets/index/index.css", "assets/fonts"],
  ["experiments/solarsystem.html", "assets/fonts"],
  ["experiments/blackhole.html", "assets/fonts"],
];

/** The @font-face blocks in `text`, as { url, range } in source order. */
function faceBlocks(text) {
  return [...text.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const url = (m[1].match(/url\(["']?([^"')]+)["']?\)/) || [])[1] || "";
    const range = (m[1].match(/unicode-range:\s*([^;]+);/) || [])[1] || "";
    return { url, range: range.trim() };
  }).filter((f) => /Pretendard/.test(f.url));
}

{
  const bad = DECLARERS.filter(([f]) => {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    return !/Pretendard/.test(s) || !/@font-face/.test(s);
  }).map(([f]) => f);
  chk("every stylesheet that sets a body font declares and uses Pretendard",
      bad.length === 0, bad.join(", "));

  // Two faces each, and each url() must resolve from that file's own
  // directory to a file that is really on disk.
  const wrong = [];
  for (const [f] of DECLARERS) {
    const blocks = faceBlocks(fs.readFileSync(path.join(ROOT, f), "utf8"));
    if (blocks.length !== 2) { wrong.push(`${f}: ${blocks.length} faces, want 2`); continue; }
    for (const b of blocks) {
      const resolved = path.normalize(path.join(path.dirname(f), b.url));
      if (!fs.existsSync(path.join(ROOT, resolved))) wrong.push(`${f}: ${b.url} → ${resolved}`);
    }
  }
  chk("each declares both halves, and every url() resolves to a file on disk",
      wrong.length === 0, wrong.join(" | "));
}

{
  /*
   * The declaration has to match how the glyphs were actually cut. Nothing at
   * runtime can notice a mismatch: the browser asks the face whose declared
   * range contains the character, and if that file has no glyph the character
   * falls back to a system face and looks almost right. So the ranges are
   * compared against the ones tools/build-font.py partitioned by, which it
   * records in coverage.json next to the files it wrote.
   */
  const want = ["latin", "hangul"].map((n) => (COVERAGE.faces || {})[n]);
  chk("coverage.json records what each half was built to hold",
      want.every((f) => f && f.file && f.unicodeRange && f.codepoints > 0),
      JSON.stringify(COVERAGE.faces));

  const norm = (r) => r.replace(/\s+/g, "").toLowerCase();
  const drifted = [];
  for (const [f] of DECLARERS) {
    const blocks = faceBlocks(fs.readFileSync(path.join(ROOT, f), "utf8"));
    for (let i = 0; i < want.length; i++) {
      const b = blocks[i], w = want[i];
      if (!b || !w) continue;
      if (!b.url.endsWith(w.file)) drifted.push(`${f} face ${i}: ${b.url} is not ${w.file}`);
      else if (norm(b.range) !== norm(w.unicodeRange))
        drifted.push(`${f} ${w.file}: declares ${b.range || "(none)"}, built as ${w.unicodeRange}`);
    }
  }
  chk("and all four declarations carry that exact range, in that order",
      drifted.length === 0, drifted.join(" | "));

  // The two ranges have to leave no gap between them, or a character in the
  // gap gets no Pretendard face at all. Walked rather than reasoned about,
  // across every codepoint the three dictionaries can put on screen.
  const ranges = [RANGES.latin, RANGES.hangul];
  const all = new Set(textOf(dicts.en) + textOf(dicts.ko) + textOf(dicts.zh));
  const homeless = [], shared = [];
  for (const ch of all) {
    const cp = ch.codePointAt(0);
    const n = ranges.filter((rs) => rs.some(([lo, hi]) => lo <= cp && cp <= hi)).length;
    if (n === 0) homeless.push(ch);
    if (n > 1) shared.push(ch);
  }
  chk(`the two ranges cover every character the site can display, exactly once — ${all.size} checked`,
      homeless.length === 0 && shared.length === 0,
      homeless.length ? `no face declares ${homeless.slice(0, 10).join(" ")}`
        : shared.length ? `both faces declare ${shared.slice(0, 10).join(" ")}`
        : `${all.size} characters, each in exactly one range`);
}

// ── It is served, and it is used ─────────────────────────────────────

/**
 * Load `page` in `lang` and report which font files the browser fetched, and
 * how many bytes of them. The language is set the way a reader sets it, in
 * localStorage, before the first navigation — switching afterwards would load
 * the Latin half first and tell us nothing about a first visit.
 */
async function firstVisit(pagePath, lang) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url("index.html"), { waitUntil: "domcontentloaded" });
  await p.evaluate((l) => { try { localStorage.setItem("lang", l); } catch (e) { /* */ } }, lang);

  const hits = new Map();
  p.on("response", async (r) => {
    if (!/PretendardVariable/.test(r.url())) return;
    const name = r.url().split("/").pop();
    let bytes = 0;
    try { bytes = (await r.body()).length; } catch (e) { /* navigated away */ }
    hits.set(name, { status: r.status(), bytes });
  });
  await p.goto(url(pagePath), { waitUntil: "networkidle" });
  await p.evaluate(async () => { await document.fonts.ready; });
  await p.waitForTimeout(600);
  const html = await p.evaluate(() => document.documentElement.lang);
  await ctx.close();
  return { hits, html, kb: [...hits.values()].reduce((a, h) => a + h.bytes, 0) / 1024 };
}

{
  const en = await firstVisit("physics.html", "en");
  chk("a hub page fetches the font and the server serves it",
      en.hits.size > 0 && [...en.hits.values()].every((h) => h.status === 200),
      [...en.hits.keys()].join(", "));

  /*
   * The whole point of the split, stated as the thing a reader pays. An
   * English page renders no Hangul, so the 400 KB half must never be asked
   * for; putting the two files back together, or dropping either
   * unicode-range, shows up here as the byte count jumping back over 400.
   */
  chk("and an English first visit costs only the Latin half",
      en.hits.has("PretendardVariable.latin.woff2")
        && !en.hits.has("PretendardVariable.hangul.woff2"),
      `${en.kb.toFixed(1)} KB: ${[...en.hits.keys()].join(", ")}`);
  chk("which is under 100 KB of font, where one file was over 450",
      en.kb > 20 && en.kb < 100, `${en.kb.toFixed(1)} KB`);

  // Chinese is ideographs Pretendard has none of, so it pays the same as
  // English — it was paying for 2 350 Korean syllables it cannot use.
  const zh = await firstVisit("physics.html", "zh");
  chk("a Chinese first visit costs the same, having no Hangul either",
      zh.html === "zh" && !zh.hits.has("PretendardVariable.hangul.woff2"),
      `lang=${zh.html}, ${zh.kb.toFixed(1)} KB: ${[...zh.hits.keys()].join(", ")}`);

  // Korean pays for both, and must: this is the reader the font was subset
  // for in the first place.
  const ko = await firstVisit("physics.html", "ko");
  chk("a Korean first visit fetches both halves, as it has to",
      ko.html === "ko" && ko.hits.has("PretendardVariable.latin.woff2")
        && ko.hits.has("PretendardVariable.hangul.woff2"),
      `lang=${ko.html}, ${ko.kb.toFixed(1)} KB: ${[...ko.hits.keys()].join(", ")}`);

  // The landing page is the front door and the one that pays twice if this
  // goes wrong — the wall asks for faces itself, outside layout. Same bill.
  const wallEn = await firstVisit("index.html", "en");
  chk("and the landing page costs the same in English as any other page",
      !wallEn.hits.has("PretendardVariable.hangul.woff2"),
      `${wallEn.kb.toFixed(1)} KB: ${[...wallEn.hits.keys()].join(", ")}`);
}

{
  /*
   * The wall is the exception to "fetched when a character is laid out": it
   * draws every card title into a canvas, and canvas text is not layout, so
   * nothing on that page asks for the face the titles need. card-texture.js
   * has to ask on its behalf, and the request has to follow the titles — a
   * fixed sample either misses Hangul, and the Korean wall bakes a system
   * fallback into every card, or contains it, and every English reader pays
   * 400 KB for a face their titles never touch.
   *
   * Checked on an English page, where the DOM contains no Hangul at all, so
   * the only thing that can pull the Hangul half is this function. The wall
   * itself cannot be driven here: it needs Three.js from a CDN that CI has no
   * route to, and index.html falls back to the table view — which is exactly
   * why the check imports the module rather than watching the page.
   */
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url("index.html"), { waitUntil: "networkidle" });

  const probe = await p.evaluate(async () => {
    const m = await import("./assets/index/card-texture.js");
    const font = '700 50px "Pretendard Variable"';
    const before = { latin: document.fonts.check(font, "A"),
                     hangul: document.fonts.check(font, "가") };
    await m.titleFontReady("Projectile Motion");        // an English wall
    const en = { latin: document.fonts.check(font, "A"),
                 hangul: document.fonts.check(font, "가") };
    await m.titleFontReady("포물선 운동");                // and a Korean one
    const ko = { latin: document.fonts.check(font, "A"),
                 hangul: document.fonts.check(font, "가") };
    return { before, en, ko };
  });
  await ctx.close();

  chk("the wall's font priming pulls the face its English titles need",
      probe.en.latin === true && probe.en.hangul === false,
      `latin ${probe.before.latin}→${probe.en.latin}, hangul ${probe.before.hangul}→${probe.en.hangul}`);
  chk("and pulls the Hangul half only once the titles it is given contain Hangul",
      probe.ko.hangul === true,
      `hangul ${probe.en.hangul}→${probe.ko.hangul}`);
}

{
  const p2 = await browser.newPage();
  await p2.goto(url("physics.html"), { waitUntil: "networkidle" });
  await p2.waitForTimeout(600);
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
