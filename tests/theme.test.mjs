/*
 * Light / dark theme.
 *
 * Three things can go wrong with a theme and none of them announce themselves:
 * the preference can fail to survive a navigation, the page can paint the
 * wrong theme for a frame before correcting itself, and — the one that
 * actually matters — some piece of text can end up the same colour as what it
 * is sitting on. The last is why this file computes real WCAG contrast ratios
 * rather than checking that a class got added.
 *
 * The simulation canvases stay dark in both themes on purpose (their colours
 * are data, chosen against a dark field), so what is checked there is that
 * they get a frame in light mode instead of floating.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browser, chk, url, finish } from "./lib/harness.mjs";
import { installCdnCache } from "./lib/cdn-cache.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── It has to be stamped before the first paint ──────────────────────
{
  // A deferred script, or one after the stylesheet, means the page paints the
  // default theme and then corrects itself — a flash on every navigation.
  const pages = ["index.html", "physics.html", "experiments/lens.html",
                 "experiments/solarsystem.html", "404.html"];
  const bad = [];
  for (const f of pages) {
    const s = fs.readFileSync(path.join(ROOT, f), "utf8");
    const m = s.match(/<script[^>]*assets\/theme\.js[^>]*>/);
    if (!m) { bad.push(`${f}: not loaded`); continue; }
    if (/\b(defer|async)\b/.test(m[0])) { bad.push(`${f}: ${m[0]}`); continue; }
    const css = s.search(/<link[^>]+rel="stylesheet"/);
    if (css !== -1 && s.indexOf(m[0]) > css) bad.push(`${f}: after the stylesheet`);
  }
  chk("every page loads the theme script blocking, before its stylesheet",
      bad.length === 0, bad.join(" | "));

  const all = [...fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")),
               ...fs.readdirSync(path.join(ROOT, "experiments"))
                 .filter((f) => f.endsWith(".html")).map((f) => `experiments/${f}`)];
  const missing = all.filter((f) =>
    !/assets\/theme\.js/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  chk(`all ${all.length} pages carry the theme script`, missing.length === 0,
      missing.slice(0, 4).join(", "));
}

// ── Auto follows the operating system ────────────────────────────────
for (const [scheme, want] of [["light", "light"], ["dark", "dark"]]) {
  const ctx = await browser.newContext({ colorScheme: scheme });
  const p = await ctx.newPage();
  await p.goto(url("physics.html"), { waitUntil: "domcontentloaded" });
  const got = await p.evaluate(() => ({
    mode: document.documentElement.dataset.themeMode,
    pref: document.documentElement.dataset.themePref,
  }));
  chk(`with no stored choice and the OS set to ${scheme}, the page is ${want}`,
      got.mode === want && got.pref === "auto", JSON.stringify(got));
  await ctx.close();
}

// ── The toggle, and that the choice sticks ───────────────────────────
{
  const ctx = await browser.newContext({ colorScheme: "dark" });
  const p = await ctx.newPage();
  await p.goto(url("physics.html"), { waitUntil: "networkidle" });

  chk("the toggle is on the page and reachable",
      await p.$(".theme-btn") !== null
      && await p.$eval(".theme-btn", (b) => b.tabIndex >= 0));

  const cycle = [];
  for (let i = 0; i < 4; i++) {
    cycle.push(await p.evaluate(() => document.documentElement.dataset.themePref));
    await p.click(".theme-btn");
    await p.waitForTimeout(60);
  }
  chk("clicking it cycles auto → light → dark → auto",
      JSON.stringify(cycle) === JSON.stringify(["auto", "light", "dark", "auto"]),
      cycle.join(" → "));

  // The label must follow the state, however the state got there.
  await p.evaluate(() => window.Theme.set("light"));
  await p.waitForTimeout(80);
  const shown = await p.$eval(".theme-btn", (b) => b.textContent.trim());
  chk("and the label follows a change it did not cause",
      /light/i.test(shown) || /밝게|浅色/.test(shown), shown);

  await p.evaluate(() => window.Theme.set("light"));
  await p.reload({ waitUntil: "domcontentloaded" });
  chk("the choice survives a reload",
      (await p.evaluate(() => document.documentElement.dataset.themeMode)) === "light");

  // And a navigation to a page in another directory, which is where a
  // path-relative storage bug would show up.
  await p.goto(url("experiments/lens.html"), { waitUntil: "domcontentloaded" });
  chk("and a navigation into experiments/",
      (await p.evaluate(() => document.documentElement.dataset.themeMode)) === "light");

  // An explicit choice must NOT follow the OS any more.
  await p.emulateMedia({ colorScheme: "dark" });
  await p.waitForTimeout(80);
  chk("an explicit choice ignores the operating system flipping underneath it",
      (await p.evaluate(() => document.documentElement.dataset.themeMode)) === "light");

  await p.evaluate(() => window.Theme.set("auto"));
  await p.waitForTimeout(80);
  chk("but auto starts following it again",
      (await p.evaluate(() => document.documentElement.dataset.themeMode)) === "dark");
  await ctx.close();
}

// ── Contrast, computed rather than eyeballed ─────────────────────────
/** WCAG 2.1 relative luminance and contrast ratio. */
const CONTRAST = `
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  /*
   * Every colour in a computed style, in source order, as {rgb, a}. Chromium
   * reports gradient stops as color(srgb x y z) with 0..1 channels and plain
   * colours as rgb()/rgba() with 0..255, so both have to be understood.
   */
  const tokens = (s) => {
    const out = [];
    const re = /rgba?\\(([^)]+)\\)|color\\(srgb ([^)]+)\\)/g;
    let m;
    while ((m = re.exec(s || ''))) {
      if (m[1] !== undefined) {
        const n = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
        out.push({ rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 });
      } else {
        const n = m[2].split(/[\\s\\/]+/).filter(Boolean).map(Number);
        out.push({ rgb: n.slice(0, 3).map((v) => v * 255), a: n.length > 3 ? n[3] : 1 });
      }
    }
    return out;
  };
  /*
   * Flatten a gradient's stops into one layer. Weighting by alpha matters more
   * than it looks: a stop of \`transparent\` computes to rgba(0,0,0,0), so a
   * plain average counts it as *black* and turns the page's faint coloured
   * spotlights into a dark wash — which is what first made light-on-glass text
   * look like it was failing at 3.4:1 when it really sits at 6.8:1.
   */
  const flatten = (list) => {
    if (!list.length) return null;
    const sa = list.reduce((s, c) => s + c.a, 0);
    if (sa <= 0.001) return null;
    return {
      rgb: [0, 1, 2].map((i) => list.reduce((s, c) => s + c.rgb[i] * c.a, 0) / sa),
      a: sa / list.length,
    };
  };
  const mean = (list) => { const f = flatten(list); return f && f.rgb; };

  /*
   * The page plate is a stack of gradients, and a gradient has no
   * backgroundColor — getComputedStyle reports transparent for it. Starting
   * the composite from white therefore measured every dark page against white
   * and reported light-on-dark text at 2.6:1 when it is really 7.7:1. Start
   * from the theme's own base colour instead, which is what those gradients
   * are drawn over.
   */
  const base = () => {
    const cs = getComputedStyle(document.documentElement);
    const tok = (cs.getPropertyValue('--bg') || cs.getPropertyValue('--page')).trim();
    if (/^#/.test(tok)) {
      const h = tok.slice(1);
      const w = h.length === 3 ? h.split('').map((c) => c + c) : h.match(/../g);
      return w.map((x) => parseInt(x, 16));
    }
    const t = tokens(tok);
    return t.length ? t[0].rgb : [255, 255, 255];
  };

  /*
   * Text sits on a stack of panes over the page, so the effective background
   * is whatever is really behind it — walk down from the root compositing as
   * we go. A pane painted with a gradient counts too: the pills that mark the
   * current language and hub are gradient-filled with no backgroundColor at
   * all, and skipping them measured dark text against the dark page and called
   * a perfectly legible control 1:1.
   */
  const bgOf = (el, skipSelf) => {
    let out = base();
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.push(n);
    chain.reverse();
    for (const n of chain) {
      if (skipSelf && n === el) continue;
      const st = getComputedStyle(n);
      let layer = null;
      const solid = tokens(st.backgroundColor)[0];
      if (solid && solid.a > 0.01) layer = solid;
      // The root plate's gradients are the base colour with faint spotlights
      // over it, and base() already stands for that whole stack — compositing
      // it a second time here would double-count it.
      else if (st.backgroundImage !== 'none'
               && n !== document.documentElement && n !== document.body) {
        layer = flatten(tokens(st.backgroundImage));
      }
      if (!layer) continue;
      out = [0, 1, 2].map((i) => layer.rgb[i] * layer.a + out[i] * (1 - layer.a));
    }
    return out;
  };

  /*
   * The hub headings are gradient text — background-clip: text with a
   * transparent fill — so their computed \`color\` is rgba(0,0,0,0) and says
   * nothing about what the reader sees. The glyphs are painted with the
   * gradient, so that is the foreground.
   */
  const fgOf = (el) => {
    const st = getComputedStyle(el);
    const clip = st.webkitBackgroundClip || st.backgroundClip;
    const fill = tokens(st.webkitTextFillColor || st.color)[0];
    if (clip === 'text' && (!fill || fill.a < 0.01)) {
      const m = mean(tokens(st.backgroundImage));
      if (m) return { rgb: m, a: 1, gradientText: true };
    }
    return fill || { rgb: [0, 0, 0], a: 1 };
  };

  const ratio = (el) => {
    const fg = fgOf(el);
    const bg = bgOf(el, !!fg.gradientText);
    // Semi-transparent text composites onto its own background first.
    const solved = fg.a >= 0.99 ? fg.rgb
      : [0, 1, 2].map((i) => fg.rgb[i] * fg.a + bg[i] * (1 - fg.a));
    const a = lum(solved) + 0.05, b = lum(bg) + 0.05;
    return a > b ? a / b : b / a;
  };
`;

/*
 * index.html is here as the *table* view, which is the one the theme has to
 * carry: the wall is a WebGL scene with no HTML text in it, while the table is
 * the whole catalogue as words on the page. Reaching it means what a reader
 * does — the choice lives in localStorage, there is no ?view= parameter.
 */
for (const [mode, page] of [["light", "physics.html"], ["dark", "physics.html"],
                            ["light", "experiments/lens.html"], ["dark", "experiments/lens.html"],
                            ["light", "index.html"], ["dark", "index.html"]]) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript((m) => {
    try { localStorage.setItem("theme", m); localStorage.setItem("ui-mode", "table"); }
    catch (e) { /* */ }
  }, mode);
  await p.goto(url(page), { waitUntil: "networkidle" });
  await p.waitForTimeout(300);
  if (page === "index.html") await p.waitForSelector(".tv-table tbody tr", { timeout: 20000 });

  const worst = await p.evaluate(new Function(`${CONTRAST}
    const out = [];
    // The chips and the description are spans and divs, so they need naming:
    // a bare tag list walks straight past a pill whose whole job is colour.
    const sel = 'h1,h2,h3,p,label,a,button,.num,.label,td,th,small,'
      + '.tv-desc,.tv-cat,.method-tag,.method-verified';
    for (const el of document.querySelectorAll(sel)) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || !el.offsetParent) continue;
      // Only leaf-ish text, so a wrapper's colour is not judged against text
      // it does not actually render.
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
      if (!text) continue;
      const size = parseFloat(st.fontSize);
      const bold = parseInt(st.fontWeight, 10) >= 700;
      // WCAG AA: 3.0 for large text (>=24px, or >=18.66px bold), else 4.5.
      const need = (size >= 24 || (bold && size >= 18.66)) ? 3.0 : 4.5;
      const r = ratio(el);
      if (r < need) out.push({ tag: el.tagName, text: text.slice(0, 34), r: +r.toFixed(2), need });
    }
    return out;`));

  chk(`${page} in ${mode}: every piece of text clears WCAG AA against what it sits on`,
      worst.length === 0,
      worst.length
        ? worst.slice(0, 4).map((w) => `${w.tag} "${w.text}" ${w.r}:1 (needs ${w.need})`).join(" | ")
        : "all pass");
  await ctx.close();
}

// ── The canvases stay dark, and are framed for it ────────────────────
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch (e) { /* */ } });
  await p.goto(url("experiments/lens.html"), { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  const frame = await p.$eval(".stage canvas", (c) => {
    const s = getComputedStyle(c);
    return { border: s.borderTopWidth, shadow: s.boxShadow };
  });
  chk("in light mode the dark canvas gets a border so it reads as an instrument",
      parseFloat(frame.border) > 0 && frame.shadow !== "none",
      `${frame.border} border`);
  await ctx.close();
}

// ── The landing page hands the theme to WebGL ────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const p = await ctx.newPage();
  await installCdnCache(p);
  await p.addInitScript(() => { try { localStorage.setItem("theme", "light"); } catch (e) { /* */ } });
  await p.goto(url("index.html"), { waitUntil: "networkidle" });
  await p.waitForTimeout(3000);

  /*
   * Sample a corner of the wall, which the clear colour and fog own. Reading
   * the WebGL canvas with drawImage returns black regardless of what is on
   * screen — the context has no preserveDrawingBuffer, so its buffer is gone
   * by the time script can look at it. A screenshot goes through the
   * compositor instead and sees what the reader sees; it is then handed back
   * into the page to be averaged.
   */
  const shot = await p.screenshot({ clip: { x: 6, y: 6, width: 40, height: 40 } });
  const corner = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const g = document.createElement("canvas");
    g.width = img.width; g.height = img.height;
    const x = g.getContext("2d");
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, g.width, g.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return sum / (d.length / 4);
  }, shot.toString("base64"));
  chk("the wall clears to a light colour, not black, in light mode",
      corner !== null && corner > 170, `mean corner brightness ${corner?.toFixed(0)}`);

  const themed = await p.evaluate(() => document.documentElement.dataset.themeMode);
  chk("and the landing page is in light mode at all", themed === "light", String(themed));

  chk("the toggle is styled on the landing page too, not left bare",
      await p.$eval(".theme-btn", (b) => {
        const s = getComputedStyle(b);
        return parseFloat(s.borderRadius) > 8 && s.backgroundColor !== "rgba(0, 0, 0, 0)";
      }));

  const over = await p.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk("no horizontal overflow on the light landing page", over <= 1, `${over}px`);
  await ctx.close();
}

// ── The toggle speaks the page's language ────────────────────────────
{
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(url("physics.html"), { waitUntil: "networkidle" });
  const labels = {};
  for (const lang of ["en", "ko", "zh"]) {
    await p.click(`.lang-btn[data-lang="${lang}"]`);
    await p.waitForTimeout(350);
    labels[lang] = await p.$eval(".theme-btn", (b) => b.textContent.trim());
  }
  const vals = Object.values(labels);
  chk("the theme button is translated, and differently in each language",
      new Set(vals).size === 3 && vals.every(Boolean), JSON.stringify(labels));
  await ctx.close();
}

await finish("theme");
