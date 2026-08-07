/*
 * The address bar as the experiment's state.
 *
 * The point of the feature is that a link carries a setup, so the checks are
 * mostly round trips: change something, read the URL, load the URL somewhere
 * else, and see whether the *model* — not just the slider — came back.
 *
 * The other half is that a query string is untrusted input. It names an
 * element by id and hands it a value, which is exactly the shape of a thing
 * that should be checked before it is believed: out of range, off the step
 * grid, not a number at all, an id that is not a control, a value long enough
 * to be an attack. None of those may reach the page.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browser, chk, url, finish } from "./lib/harness.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WAVE = url("experiments/wave.html");

// ── Every page that has controls loads it, after reset-defaults ──────
{
  const pages = fs.readdirSync(path.join(ROOT, "experiments"))
    .filter((f) => f.endsWith(".html"));
  const missing = [];
  const misordered = [];
  for (const f of pages) {
    const s = fs.readFileSync(path.join(ROOT, "experiments", f), "utf8");
    const hasControls = /<input|<select/.test(s);
    if (!hasControls) continue;
    const i = s.indexOf("assets/url-state.js");
    if (i === -1) { missing.push(f); continue; }
    // reset-defaults must snapshot the page's own defaults, not a link's.
    const r = s.indexOf("assets/reset-defaults.js");
    if (r !== -1 && r > i) misordered.push(f);
  }
  chk(`all ${pages.length} experiment pages with controls carry the script`,
      missing.length === 0, missing.join(", "));
  chk("and every one of them loads it after reset-defaults, so Reset still means defaults",
      misordered.length === 0, misordered.join(", "));
}

const open = async (u) => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 950 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  p.on("pageerror", (e) => errs.push("PE: " + e.message));
  await p.goto(u, { waitUntil: "networkidle" });
  await p.waitForTimeout(400);
  return { ctx, p, errs };
};
const setV = (p, id, v) => p.$eval("#" + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);
const flush = (p) => p.evaluate(() => window.__urlState.write());
const query = (p) => new URL(p.url()).search;

// ── A clean page has a clean URL ─────────────────────────────────────
{
  const { ctx, p, errs } = await open(WAVE);
  chk("the page loads with no console errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  await flush(p);
  chk("an untouched page keeps a bare URL", query(p) === "", query(p));

  await setV(p, "spacing", 220);
  await p.waitForTimeout(300);
  chk("moving one control writes that one control", query(p) === "?spacing=220", query(p));

  await setV(p, "wavelength", 30);
  await setV(p, "show-screen", "on");
  await p.$eval("#show-screen", (el) => {
    el.checked = false; el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await p.waitForTimeout(300);
  const q = new URLSearchParams(query(p));
  chk("and a checkbox rides along as 0 or 1",
      q.get("spacing") === "220" && q.get("wavelength") === "30" && q.get("show-screen") === "0",
      query(p));

  await setV(p, "spacing", 140);
  await p.waitForTimeout(300);
  chk("a control put back to its default drops out again",
      !new URLSearchParams(query(p)).has("spacing"), query(p));

  await p.click("#reset-btn");
  await p.waitForTimeout(300);
  chk("and Reset empties the whole thing", query(p) === "", query(p));
  await ctx.close();
}

// ── The link carries the model, not just the slider ──────────────────
{
  const { ctx, p, errs } = await open(`${WAVE}?spacing=220&wavelength=30&amp2=0.4&phase=90`);
  chk("a shared link restores the controls",
      JSON.stringify(await p.evaluate(() => ({
        d: +document.getElementById("spacing").value,
        lam: +document.getElementById("wavelength").value,
        a2: +document.getElementById("amp2").value,
        ph: +document.getElementById("phase").value,
      }))) === JSON.stringify({ d: 220, lam: 30, a2: 0.4, ph: 90 }),
      await p.evaluate(() => document.getElementById("spacing").value));

  // The part that matters: the simulation is running the shared setup, not
  // merely displaying its numbers on the sliders.
  const model = await p.evaluate(() => {
    const w = window.__wave.params();
    return { d: w.d, lam: w.lam, A2: w.A2, phi: w.phi };
  });
  chk("and the model is running them",
      model.d === 220 && model.lam === 30 && Math.abs(model.A2 - 0.4) < 1e-9
      && Math.abs(model.phi - Math.PI / 2) < 1e-9, JSON.stringify(model));

  const shown = await p.evaluate(() =>
    document.getElementById("wavelength-value").textContent.trim());
  chk("the readouts came with it", shown === "30", shown);
  chk("no console errors from a page opened on a link", errs.length === 0,
      errs.slice(0, 2).join(" | "));

  // A round trip through the address bar has to be a fixed point.
  await flush(p);
  const again = new URLSearchParams(query(p));
  chk("and the URL it settles on is the URL it was given",
      again.get("spacing") === "220" && again.get("wavelength") === "30"
      && again.get("amp2") === "0.4" && again.get("phase") === "90"
      && [...again.keys()].length === 4, query(p));
  await ctx.close();
}

// ── A query string is untrusted input ────────────────────────────────
{
  const hostile = [
    ["spacing=99999", "spacing", "above max"],
    ["spacing=-40", "spacing", "below min"],
    ["spacing=141", "spacing", "off the step grid"],
    ["spacing=abc", "spacing", "not a number"],
    ["spacing=NaN", "spacing", "NaN"],
    ["spacing=1e400", "spacing", "overflows to Infinity"],
    ["show-screen=yes", "show-screen", "not 0 or 1"],
    [`spacing=${"9".repeat(200)}`, "spacing", "absurdly long"],
    ["spacing=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", "spacing", "markup"],
  ];
  const bad = [];
  for (const [qs, id, why] of hostile) {
    const { ctx, p, errs } = await open(`${WAVE}?${qs}`);
    const got = await p.$eval("#" + id, (el) =>
      (el.type === "checkbox" ? (el.checked ? "1" : "0") : el.value));
    const want = id === "show-screen" ? "1" : "140";
    if (got !== want || errs.length) bad.push(`${why}: ${id}=${got}${errs.length ? " +errors" : ""}`);
    await ctx.close();
  }
  chk(`${hostile.length} malformed values are all refused, leaving the default in place`,
      bad.length === 0, bad.join(" | "));

  // An id that is not a control, and one that is not on the page at all.
  const { ctx, p, errs } = await open(`${WAVE}?reset-btn=1&nonsense=7&stage=x&spacing=220`);
  const state = await p.evaluate(() => ({
    d: document.getElementById("spacing").value,
    canvasId: document.getElementById("stage").tagName,
  }));
  await flush(p);
  chk("ids that are not controls are ignored, and the real one still works",
      state.d === "220" && state.canvasId === "CANVAS"
      && query(p) === "?spacing=220" && errs.length === 0,
      `${query(p)} | ${errs.slice(0, 1).join("")}`);
  await ctx.close();
}

// ── Free text is held to what the markup says it accepts ─────────────
{
  // The DNA page takes a sequence: pattern="[ACGTacgt]*", maxlength="30". A
  // link is not allowed to put anything else in there.
  const DNA = url("experiments/dna.html");
  const good = "ACGTACGTACGT";
  const { ctx, p, errs } = await open(`${DNA}?seq=${good}`);
  const got = await p.$eval("#seq", (el) => el.value);
  chk("a sequence that matches the field's own pattern is accepted",
      got === good && errs.length === 0, got);
  await ctx.close();

  const bad = [];
  for (const [v, why] of [
    ["ACGTX", "letter outside the alphabet"],
    ["A".repeat(31), "over maxlength"],
    ["%3Cscript%3E", "markup"],
    ["ACGT%20ACGT", "whitespace"],
  ]) {
    const r = await open(`${DNA}?seq=${v}`);
    const s = await r.p.$eval("#seq", (el) => el.value);
    if (s !== "ATGGCATCTGAACGTTAACGT" || r.errs.length) bad.push(`${why} → ${s}`);
    await r.ctx.close();
  }
  chk("and one that does not is refused, leaving the default sequence",
      bad.length === 0, bad.join(" | "));
}

// ── What the page clamps, the URL admits ─────────────────────────────
{
  // Diffraction refuses to let neighbouring slits overlap: ask for a 400 µm
  // slit 20 µm from the next one and it moves the separation. The URL has to
  // end up describing the mask that exists, not the one that was asked for.
  const D = url("experiments/diffraction.html");
  const { ctx, p } = await open(`${D}?width=100&sep=20`);
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const q = window.__diff.params();
    return { a: q.a * 1e6, d: q.d * 1e6, slider: document.getElementById("sep").value };
  });
  await flush(p);
  const q = new URLSearchParams(query(p));
  chk("a value the page overrides is written back as what it became",
      r.d > r.a && q.get("sep") === r.slider && q.get("width") === "100",
      `a=${r.a}µm d=${r.d}µm, URL says sep=${q.get("sep")}`);
  await ctx.close();
}

// ── It does not fill the back button ─────────────────────────────────
{
  const { ctx, p } = await open(WAVE);
  const before = await p.evaluate(() => history.length);
  for (const v of [160, 180, 200, 220, 240, 260, 280, 300]) {
    await setV(p, "spacing", v);
    await p.waitForTimeout(30);
  }
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => history.length);
  chk("eight slider moves add no history entries",
      after === before && query(p) === "?spacing=300",
      `history ${before} → ${after}, ${query(p)}`);
  await ctx.close();
}

// ── And it stays out of the way ──────────────────────────────────────
{
  // A page with no form controls at all must not have the module reaching
  // for things that are not there.
  const { ctx, p, errs } = await open(url("physics.html"));
  const has = await p.evaluate(() => !!window.__urlState);
  chk("a page with no controls is left alone, without errors",
      !has && errs.length === 0, errs.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  // The language switcher and the theme toggle are not controls and must not
  // start appearing in shared links.
  const { ctx, p } = await open(WAVE);
  await p.click('.lang-btn[data-lang="ko"]');
  await p.waitForTimeout(500);
  await p.click(".theme-btn");
  await p.waitForTimeout(400);
  await flush(p);
  chk("switching language and theme leaves the URL alone", query(p) === "", query(p));
  await ctx.close();
}

await finish("URL state");
