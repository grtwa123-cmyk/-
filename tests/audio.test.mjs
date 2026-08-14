/*
 * Sound, and the context that must not exist yet.
 *
 * assets/sfx.js always said it "lazily creates one AudioContext and unlocks it
 * on the first user gesture". It really created one on the first *sound*,
 * whichever came first — and a simulation starts making sounds the moment it
 * starts running. Loading the gas page and touching nothing produced 55
 * "The AudioContext was not allowed to start" warnings, electrolysis 31, and
 * five other pages a handful each: a context opened against the browser's
 * autoplay policy, silent, warning on every attempt.
 *
 * Nothing here checks that sound is audible — a headless browser is the wrong
 * instrument for that. What it checks is the part that was wrong: when a
 * context comes into existence, and that the drones four pages build at load
 * time still work once it does.
 */
import fs from "node:fs";
import path from "node:path";
import { browser, chk, url, finish } from "./lib/harness.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Count AudioContexts a page opens, by wrapping the constructor first. */
async function watch(pagePath) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  let warnings = 0;
  page.on("console", (m) => {
    if (/AudioContext was not allowed/.test(m.text())) warnings++;
  });
  await page.addInitScript(() => {
    window.__ctxMade = 0;
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(...a) { super(...a); window.__ctxMade++; }
    };
  });
  await page.goto(url(pagePath), { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  return { ctx, page, warnings: () => warnings,
           made: () => page.evaluate(() => window.__ctxMade) };
}

// ── Nothing before the reader touches anything ───────────────────────
{
  /*
   * The seven that used to warn. gas and electrolysis are the ones that made
   * it obvious — both play a sound per event in a loop that starts on load.
   */
  const pages = ["gas", "electrolysis", "spectra", "generator",
                 "doppler", "diode", "semiconductor"];
  const noisy = [];
  for (const name of pages) {
    const w = await watch(`experiments/${name}.html`);
    const made = await w.made();
    if (made > 0 || w.warnings() > 0) {
      noisy.push(`${name}: ${made} context(s), ${w.warnings()} warning(s)`);
    }
    await w.ctx.close();
  }
  chk(`no page opens an audio context before a gesture — ${pages.length} that used to`,
      noisy.length === 0, noisy.join(" | "));
}

// ── And one appears as soon as they do ───────────────────────────────
{
  const w = await watch("experiments/gas.html");
  const before = await w.made();
  await w.page.mouse.click(640, 460);
  await w.page.waitForTimeout(800);
  const after = await w.made();
  const state = await w.page.evaluate(async () => {
    const d = new window.SFX.Drone({ freq: 200, gain: 0 });
    const s = d.ok ? d.o.context.state : "(not built)";
    d.stop();
    return s;
  });
  chk("a real gesture opens exactly one, and it is running",
      before === 0 && after === 1 && state === "running",
      `${before} → ${after}, state ${state}`);
  await w.ctx.close();
}

// ── The drones four pages build at load still work ───────────────────
{
  /*
   * diode, doppler, generator and semiconductor each construct a Drone at
   * module scope and keep the handle for the life of the page. Refusing them
   * outright would leave four pages permanently silent, so a drone asked for
   * too early is built on the first gesture instead — carrying whatever the
   * page set in the meantime, or it would come up at its construction pitch
   * rather than wherever the reader has left the slider.
   */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(url("experiments/doppler.html"), { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const early = await page.evaluate(() => {
    window.__d = new window.SFX.Drone({ type: "sine", freq: 300, gain: 0.05 });
    window.__d.setFreq(440);
    window.__d.setGain(0.08);
    return { ok: window.__d.ok };
  });
  chk("a drone asked for before a gesture is not wired up yet",
      early.ok === false, `ok=${early.ok}`);

  await page.mouse.click(640, 460);
  await page.waitForTimeout(700);
  const late = await page.evaluate(() => ({
    ok: window.__d.ok,
    freq: window.__d.o ? Math.round(window.__d.o.frequency.value) : null,
    gain: window.__d.g ? Number(window.__d.g.gain.value.toFixed(3)) : null,
  }));
  chk("and is built on the first gesture", late.ok === true, `ok=${late.ok}`);
  chk("at the pitch and level set while it was waiting, not the ones it was made with",
      late.freq === 440 && late.gain === 0.08,
      `${late.freq} Hz / ${late.gain} (made with 300 Hz / 0.05)`);

  // Stopping something that has not started must not arm it.
  const stopped = await page.evaluate(async () => {
    const d = new window.SFX.Drone({ freq: 200, gain: 0.1 });
    d.stop();
    return d.ok;
  });
  chk("a drone stopped while still waiting stays stopped", stopped === false, String(stopped));
  await ctx.close();
}

// ── The promise in the source is the behaviour ───────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, "assets", "sfx.js"), "utf8");
  chk("sfx.js gates the context on a gesture rather than on the first sound",
      /if \(!gestured\) return null;/.test(src), "");
  chk("and the gesture listeners are what set that",
      /gestured = true;/.test(src) && /addEventListener\(ev, unlock/.test(src), "");
}

await finish("audio");
