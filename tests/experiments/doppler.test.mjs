/*
 * Doppler — the shift read off the rings, not evaluated.
 *
 * The page emits one circular wavefront every period, each spreading at the
 * wave speed from wherever the source was when it left. The measurement is
 * then geometry on the picture the reader is looking at: where consecutive
 * rings cross the line of travel is where the wavefronts are, and the gap
 * between those crossings is the wavelength.
 *
 * This page was built three times and reverted three times before it worked,
 * and the two things that finally made it work are worth stating because both
 * are asserted here.
 *
 * The first is which rings belong to the experiment. Rings live until they
 * run off the canvas, so a buffer read after a slider move holds a mixture of
 * two settings; and the source bounces off both edges, so a window longer
 * than one traverse contains a reversal. A pair of rings straddling either is
 * a pair whose spacing means nothing. Two clocks handle it — the time the
 * controls last moved, and the time the source last turned round — and the
 * checks below exercise each on its own.
 *
 * The page also requires the source to have covered exactly v·Δt between the
 * two emissions. That test was what took the worst rows from 5% to 0.000%
 * back when there were no clocks; a build with it deleted now passes
 * everything here, so it is a guard rather than the mechanism, and this file
 * does not pretend otherwise.
 *
 * The second was a bug in the page rather than in the measurement: rings were
 * recorded at the source's position at the *end* of the step rather than at
 * the emission instant, misplacing each centre by up to v·dt. Subsonically
 * invisible; at Mach 2 it was the difference between rings tangent to one
 * cone and rings nearly tangent to it, showing as a half-angle 1.7% out.
 *
 * There is no randomness here, so the tolerances are not absorbing scatter —
 * every one of these agrees to about a part in 10¹³.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/doppler.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const n = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ex = (x, d = 2) => (Number.isFinite(x) ? x.toExponential(d) : String(x));

const SETTINGS = [[0, 2, 220], [0.3, 2, 220], [0.6, 2, 220], [0.85, 2, 220],
                  [0.95, 2, 220], [0.6, 4, 220], [0.5, 2, 320],
                  [1.4, 2, 220], [1.8, 3, 300], [2.0, 2, 220]];

/*
 * Run each setting from a clean start and stop inside the first traverse.
 * The source bounces at both edges and a reversal restarts the run, so a
 * window that contains one has fewer rings to work with, not wrong ones.
 */
const runs = await page.evaluate((settings) => {
  const D = window.__doppler;
  const set = (id, v) => {
    const el = document.getElementById(id);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const travel = document.getElementById('stage').getBoundingClientRect().width
                 - 2 * D.MARGIN_X;
  return settings.map(([mach, f, c]) => {
    D.setPaused(false);
    D.reset();
    set('velocity', mach); set('frequency', f); set('wavespeed', c);
    const traverse = mach > 0 ? travel / (mach * c) : Infinity;
    const secs = Math.min(2.4, Math.max(0.9, traverse * 0.92));
    const r = D.settle(secs);
    return { mach, f, c, secs, traverse,
             ahead: r.ahead, behind: r.behind, cone: r.cone,
             rings: D.state().rings, runStart: D.state().runStart,
             txt: {
               forward: document.getElementById('out-forward').textContent.trim(),
               backward: document.getElementById('out-backward').textContent.trim(),
               cone: document.getElementById('out-cone').textContent.trim(),
               wavelength: document.getElementById('out-wavelength').textContent.trim(),
               regime: document.getElementById('out-regime').textContent.trim(),
             } };
  });
}, SETTINGS);
const sub = runs.filter((r) => r.mach < 1);
const sup = runs.filter((r) => r.mach > 1);

// ── The wavelength, measured off the rings ───────────────────────────
{
  chk('no run contained a bounce, so every ring measured belongs to one steady pass',
      runs.every((r) => r.runStart === 0 && r.secs < r.traverse),
      runs.map((r) => `M${r.mach}: ${n(r.secs, 2)}s of ${n(r.traverse, 2)}s`).join(', '));

  const wa = Math.max(...sub.map((r) => Math.abs(r.ahead.v / ((r.c - r.mach * r.c) / r.f) - 1)));
  chk(`the gap between wavefronts ahead of the source is (c − v)/f — ${sub.length} settings`,
      wa < 1e-6,
      `worst ${ex(wa)}; ` + sub.map((r) => `M${r.mach}: ${n(r.ahead.v, 3)}`).join(', '));

  const wb = Math.max(...runs.map((r) => Math.abs(r.behind.v / ((r.c + r.mach * r.c) / r.f) - 1)));
  chk('and behind it is (c + v)/f, at every speed including past Mach 1',
      wb < 1e-6,
      `worst ${ex(wb)}; ` + runs.map((r) => `M${r.mach}: ${n(r.behind.v, 2)}`).join(', '));

  /*
   * Every surviving pair of rings gives the same answer. That is the check
   * that the pair filter is doing its job: a pair straddling a bounce or a
   * settings change disagrees with the rest by percent, so a spread of 10⁻¹³
   * says none got through.
   */
  const spread = Math.max(...runs.map((r) => Math.max(r.ahead.spread || 0, r.behind.spread || 0)));
  chk('and every pair of rings agrees with every other, so no bad pair survived the filter',
      spread < 1e-9 && runs.every((r) => r.ahead.n >= 2 || r.mach > 1),
      `worst spread across pairs ${ex(spread)}; `
      + runs.map((r) => `M${r.mach}: ${r.ahead.n}+${r.behind.n} pairs`).join(', '));

  chk('the shift is worth seeing — twentyfold between the extremes of the slider',
      Math.max(...sub.map((r) => r.behind.v / r.ahead.v)) > 20,
      sub.map((r) => `M${r.mach}: ${n(r.behind.v / r.ahead.v, 2)}×`).join(', '));
}

// ── The Mach cone ────────────────────────────────────────────────────
{
  const wc = Math.max(...sup.map((r) =>
    Math.abs(r.cone.deg / ((Math.asin(1 / r.mach) * 180) / Math.PI) - 1)));
  chk('past Mach 1 the rings are tangent to a cone of half-angle arcsin(1/M)',
      sup.length >= 3 && wc < 1e-6,
      `worst ${ex(wc)}; ` + sup.map((r) =>
        `M${r.mach}: ${n(r.cone.deg, 3)}° vs ${n((Math.asin(1 / r.mach) * 180) / Math.PI, 3)}°`).join(', '));

  /*
   * And that is the whole content of the word "cone": not that one ring makes
   * that angle, but that *every* ring makes the same one. The spread across
   * rings is what says so, and it is the number that a misplaced emission
   * point moves first — it was 4% before the rings were recorded at the
   * instant they left rather than at the end of the step.
   */
  const cs = Math.max(...sup.map((r) => r.cone.spread));
  chk('and every ring gives the same angle, which is what makes it a cone',
      cs < 1e-9 && sup.every((r) => r.cone.n >= 3),
      `worst spread ${ex(cs)} over ${sup.map((r) => r.cone.n).join(', ')} rings`);

  chk('below Mach 1 there is no cone to find, and none is reported',
      sub.every((r) => !Number.isFinite(r.cone.deg)),
      sub.map((r) => `M${r.mach}: ${r.cone.n} rings tangent`).join(', '));
}

// ── The regime boundary is real, not cosmetic ────────────────────────
{
  /*
   * Past Mach 1 the source has outrun its own waves and there is nothing
   * ahead of it to have a wavelength — the closed form says so by going
   * negative, which means the question has stopped applying rather than that
   * the answer is large. The page has to withdraw the forward readouts, not
   * print the absolute value.
   */
  chk('above Mach 1 the forward readouts are withdrawn, because there is nothing ahead any more',
      sup.every((r) => r.txt.forward === '—' && r.txt.wavelength === '—'
                       && (r.c - r.mach * r.c) < 0),
      sup.map((r) => `M${r.mach}: ${r.txt.forward}`).join(', '));

  chk('and below it they are shown, measured beside f·c/(c − v)',
      sub.every((r) => r.txt.forward.includes(' / ') && r.txt.wavelength.includes(' / ')),
      sub[2].txt.forward + ' | ' + sub[2].txt.wavelength);

  chk('the regime label follows the same boundary',
      sub.every((r) => r.txt.regime === 'Subsonic')
      && sup.every((r) => r.txt.regime === 'Supersonic'),
      runs.map((r) => `M${r.mach}: ${r.txt.regime}`).join(', '));
}

// ── The panel prints the measurement ─────────────────────────────────
{
  const one = sub.find((r) => r.mach === 0.6 && r.f === 2);
  const want = `${(one.c / one.ahead.v).toFixed(2)} / `
             + `${((one.f * one.c) / (one.c - one.mach * one.c)).toFixed(2)}`;
  chk('the forward frequency readout is c divided by the measured wavelength',
      one.txt.forward === want, `${one.txt.forward} (wanted ${want})`);

  const s = sup.find((r) => r.mach === 2);
  const wantCone = `${s.cone.deg.toFixed(1)}° / `
                 + `${((Math.asin(1 / s.mach) * 180) / Math.PI).toFixed(1)}°`;
  chk('and the cone readout is the angle measured off the rings',
      s.txt.cone === wantCone, `${s.txt.cone} (wanted ${wantCone})`);
}

// ── Which rings belong to the experiment ─────────────────────────────
{
  /*
   * The two filters, each exercised on its own. Move a slider mid-run and the
   * rings already in flight belong to the old setting; let the source bounce
   * and the rings from the outward leg belong to the other direction. Either
   * mixed in would drag the answer percent-wise off.
   */
  const stale = await page.evaluate(() => {
    const D = window.__doppler;
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    D.setPaused(false);
    D.reset();
    set('velocity', 0.3); set('frequency', 2); set('wavespeed', 220);
    D.settle(1.2);
    const before = D.state().rings;
    set('velocity', 0.8);                       // rings in flight are now stale
    const kept = D.currentRings().length;
    // Long enough for three pairs at f = 2, still inside the traverse (3.1 s
    // at this speed) so no bounce muddles it.
    const r = D.settle(1.8);
    return { before, kept, afterAll: D.state().rings,
             ahead: r.ahead.v, want: (220 - 0.8 * 220) / 2 };
  });
  chk('a slider move retires every ring already in flight, and the answer is right immediately after',
      stale.kept === 0 && stale.before >= 2
      && Math.abs(stale.ahead / stale.want - 1) < 1e-6,
      `${stale.before} rings in flight, ${stale.kept} kept; `
      + `then ${n(stale.ahead, 3)} against ${n(stale.want, 3)}`);

  const bounce = await page.evaluate(() => {
    const D = window.__doppler;
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    D.setPaused(false);
    D.reset();
    set('velocity', 0.9); set('frequency', 3); set('wavespeed', 220);
    const travel = document.getElementById('stage').getBoundingClientRect().width
                   - 2 * D.MARGIN_X;
    D.settle((travel / (0.9 * 220)) * 1.4);     // straight through one bounce
    const st = D.state();
    const r = D.measureWavelengths(D.params());
    return { runStart: st.runStart, t: st.t, total: st.rings,
             kept: D.currentRings().length, dir: st.sourceDir,
             ahead: r.ahead.v, want: (220 - 0.9 * 220) / 3 };
  });
  chk('and a bounce restarts the run, so the return leg is measured on its own',
      bounce.runStart > 0 && bounce.kept < bounce.total && bounce.kept >= 2
      && bounce.dir === -1
      && Math.abs(bounce.ahead / bounce.want - 1) < 1e-6,
      `turned at ${n(bounce.runStart, 2)}s, ${bounce.kept} of ${bounce.total} rings kept, `
      + `ahead ${n(bounce.ahead, 4)} against ${n(bounce.want, 4)}`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  const sig = async () => page.evaluate(() => JSON.stringify([
    ['velocity', 'frequency', 'wavespeed']
      .map((k) => document.getElementById(k + '-value')?.textContent),
    window.__doppler.params(),
  ]));
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['velocity', 1.2], ['frequency', 5], ['wavespeed', 300]]) {
    await page.$eval('#' + id, (el, val) => {
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#pause-btn');
  const paused = await page.evaluate(() => {
    const D = window.__doppler;
    const a = D.state();
    for (let i = 0; i < 60; i++) D.advance(1 / 60);
    return { was: a, now: D.state(), paused: D.isPaused() };
  });
  chk('Pause stops the emitter', paused.paused && paused.now.t === paused.was.t
      && paused.now.rings === paused.was.rings,
      `t ${n(paused.was.t, 3)} → ${n(paused.now.t, 3)}`);

  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => window.__doppler.params());
  chk('Reset restores the defaults',
      after.mach === 0.6 && after.f === 2 && after.c === 220, JSON.stringify(after));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  // Wait for the title to change rather than a fixed delay: the zh dictionary
  // is fetched on demand and a fixed wait races it.
  const lang = async (code, prev) => {
    await page.click(`.lang-btn[data-lang="${code}"]`);
    await page.waitForFunction(
      (q) => document.querySelector('h1').textContent.trim() !== q, prev,
      { timeout: 8000 },
    ).catch(() => {});
    return h1();
  };
  const en = await h1();
  const ko = await lang('ko', en);
  const zh = await lang('zh', ko);
  await lang('en', zh);
  chk('title translates en/ko/zh and returns', en !== ko && ko !== zh && (await h1()) === en,
      `${en} / ${ko} / ${zh}`);

  const unresolved = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', unresolved.length === 0, unresolved.slice(0, 4).join(', '));

  chk('the page badges itself as measured and verified',
      await page.$('.method-tag[data-method="measured"]') !== null
      && await page.$('.method-verified') !== null);

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('doppler');
