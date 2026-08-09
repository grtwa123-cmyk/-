/*
 * Gravity and orbits — Kepler's three laws, fitted to planets rather than
 * printed beside them.
 *
 * The page writes down a = −GM·r̂/r² and steps it. Each planet's semi-major
 * axis comes from its own two turning points and its period from the gap
 * between them, and the headline is a least-squares line through the log of
 * those pairs: its slope is the exponent and its intercept is 2π/√GM, so the
 * same fit that gives 3/2 also weighs the star.
 *
 * As on the cannon page there is no randomness here — the same launch gives
 * the same trajectory to the last bit — so these tolerances are not absorbing
 * run-to-run scatter. They sit about an order of magnitude above the residual
 * measured on this build, and every one of them was watched fail under a
 * planted defect before it was written down.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/orbit.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const n = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ex = (x, d = 2) => (Number.isFinite(x) ? x.toExponential(d) : String(x));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

const K = await page.evaluate(() => {
  const O = window.__orbit;
  return { BASE_GM: O.BASE_GM, STEPS_PER_ORBIT: O.STEPS_PER_ORBIT,
           ECC_FLOOR: O.ECC_FLOOR, SYSTEM: O.SYSTEM, ...O.params() };
});

/*
 * Run the preset system in frame-sized slices, the way the page does. Two
 * seconds of simulated time is what one frame delivers at the top of the
 * time-scale slider, so this is the real loop and not a shortcut through it.
 */
const runSystem = (mass, slices = 1200, slice = 2) => page.evaluate(
  ({ mass, slices, slice }) => {
    const O = window.__orbit;
    O.setRunning(false);
    const el = document.getElementById('star-mass');
    el.value = String(mass);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    O.launchSystem();
    for (let i = 0; i < slices; i++) O.advance(slice / Math.sqrt(mass));
    return { fit: O.fit(), planets: O.planets(), points: O.points(),
             gm: O.params().gm };
  }, { mass, slices, slice });

const base = await runSystem(1);

// ── The line through the planets ─────────────────────────────────────
{
  chk('every planet in the preset system completed an orbit and was measured',
      base.points.length === K.SYSTEM.length
      && base.planets.every((p) => p.turns >= 2 && Number.isFinite(p.a)),
      base.planets.map((p) => `a=${n(p.a, 1)} e=${n(p.e)} T=${n(p.period, 2)} turns=${p.turns}`).join(' | '));

  /*
   * A fit is only worth as much as its leverage. Six planets bunched at one
   * radius would give a slope with an enormous error bar and no way to see
   * it, and six circles would say nothing about whether the law depends on
   * shape — so the spread is asserted before the slope that rests on it.
   */
  const as = base.points.map((q) => q.a);
  const es = base.points.map((q) => q.e);
  chk('over a real spread of orbits — a factor of 5 in size, and eccentricity from 0 to 0.39',
      Math.max(...as) / Math.min(...as) > 4 && Math.max(...es) > 0.35
      && Math.min(...es) < 0.01,
      `a ${n(Math.min(...as), 1)}–${n(Math.max(...as), 1)}, e ${n(Math.min(...es))}–${n(Math.max(...es))}`);

  chk(`the points lie on a straight line in log T vs log a — residual ${ex(base.fit.residual)}`,
      Number.isFinite(base.fit.residual) && base.fit.residual < 2e-6,
      base.points.map((q) => `${n(q.a, 1)}→${n(q.period, 2)}`).join(' '));

  chk('and its slope is 3⁄2 — Kepler\'s third law, fitted rather than asserted',
      Math.abs(base.fit.slope / 1.5 - 1) < 5e-6,
      `${n(base.fit.slope, 8)} (${n((base.fit.slope / 1.5 - 1) * 1e6, 3)} ppm from 1.5)`);

  chk('the same line weighs the star: its intercept is 2π/√GM',
      Math.abs(base.fit.gm / base.gm - 1) < 2e-5,
      `GM ${n(base.fit.gm, 3)} vs ${base.gm} (${n((base.fit.gm / base.gm - 1) * 1e6, 2)} ppm)`);
}

// ── The same, at four star masses ────────────────────────────────────
const masses = [0.2, 5, 20];
const sweep = [{ mass: 1, ...base }];
for (const m of masses) sweep.push({ mass: m, ...(await runSystem(m)) });
{
  const bad = sweep.filter((s) => s.points.length !== K.SYSTEM.length);
  chk('a heavier star does not swallow the preset — all six survive at 0.2×, 1×, 5× and 20×',
      bad.length === 0,
      sweep.map((s) => `${s.mass}×: ${s.points.length}/${K.SYSTEM.length}`).join(', '));

  const worstSlope = Math.max(...sweep.map((s) => Math.abs(s.fit.slope / 1.5 - 1)));
  chk('the exponent is 3⁄2 at every one of them',
      worstSlope < 5e-6,
      sweep.map((s) => `${s.mass}×: ${n(s.fit.slope, 7)}`).join(', '));

  const worstGM = Math.max(...sweep.map((s) => Math.abs(s.fit.gm / s.gm - 1)));
  chk('and the GM the intercept gives back tracks the slider over a hundredfold in mass',
      worstGM < 2e-5,
      sweep.map((s) => `${s.mass}×: ${n(s.fit.gm, 1)} vs ${s.gm} (${n((s.fit.gm / s.gm - 1) * 1e6, 2)} ppm)`).join(', '));

  /*
   * The absolute value could be right for a bad reason — a constant that
   * happened to match. This asks the harder question: does the *ratio* of two
   * fitted GMs equal the ratio of the two masses that produced them?
   */
  const ref = sweep.find((s) => s.mass === 1);
  const worstRatio = Math.max(...sweep.map((s) =>
    Math.abs((s.fit.gm / ref.fit.gm) / s.mass - 1)));
  chk('so twenty times the mass really is twenty times the GM, measured',
      worstRatio < 2e-5,
      sweep.map((s) => `${s.mass}×: ${n(s.fit.gm / ref.fit.gm, 6)}`).join(', '));
}

// ── Each planet on its own ───────────────────────────────────────────
const solo = await page.evaluate(() => {
  const O = window.__orbit;
  const GM = O.BASE_GM;
  const out = [];
  for (const [r0, f] of [[70, 1.00], [110, 1.18], [170, 0.86], [250, 1.12], [340, 1.00]]) {
    const v = Math.sqrt(GM / r0) * f;
    const p = O.fly(r0, 0, 0, v, { turns: 3, GM, sample: 9 });
    let visViva = 0;
    for (const q of p.path) {
      visViva = Math.max(visViva, Math.abs(q.v2 / (GM * (2 / q.r - 1 / p.a)) - 1));
    }
    out.push({ r0, f, a: p.a, e: p.e, period: p.period, kepler: p.kepler,
               h: p.h, steps: p.steps, t: p.t, turns: p.turns,
               visViva, samples: p.path.length,
               dE: p.dE, dL: p.dL, drift: p.driftPerOrbit,
               areaRate: p.area / p.t / (p.L / 2) - 1 });
  }
  return out;
});
{
  const worst = Math.max(...solo.map((s) => Math.abs(s.period / s.kepler - 1)));
  chk('each planet\'s own measured period is 2π√(a³/GM), with a from its own two apsides',
      solo.every((s) => Number.isFinite(s.period)) && worst < 5e-6,
      solo.map((s) => `e=${n(s.e)}: ${n(s.period, 3)}/${n(s.kepler, 3)}`).join(', '));

  const worstV = Math.max(...solo.map((s) => s.visViva));
  chk('and every point on every path obeys v² = GM(2/r − 1/a)',
      worstV < 5e-6,
      solo.map((s) => `e=${n(s.e)} (${s.samples} samples): ${ex(s.visViva)}`).join(', '));
}

// ── Kepler's first law, stated sharply ───────────────────────────────
{
  /*
   * "The orbit is an ellipse" is true of any bound central force at the
   * right energy. What singles out the inverse square is that the ellipse
   * does not *turn*: the eccentricity vector points at the perihelion and
   * stays there. This is the readout a wrong exponent moves first.
   */
  const elliptical = solo.filter((s) => s.e > K.ECC_FLOOR);
  const worst = Math.max(...elliptical.map((s) => Math.abs(s.drift)));
  chk('the ellipse does not turn — the perihelion holds still, which is what marks out 1/r²',
      elliptical.length >= 3 && elliptical.every((s) => Number.isFinite(s.drift))
      && worst < 5e-5,
      elliptical.map((s) => `e=${n(s.e)}: ${ex(s.drift)} rad/orbit`).join(', '));

  // A circle has no perihelion, so its eccentricity vector has no direction
  // and any angle read off it is rounding noise. That has to be reported as
  // nothing rather than as a drift.
  const circles = solo.filter((s) => s.e <= K.ECC_FLOOR);
  chk('and a circular orbit reports no drift at all, rather than the angle of a zero vector',
      circles.length >= 1 && circles.every((s) => !Number.isFinite(s.drift)),
      circles.map((s) => `e=${ex(s.e)}: ${s.drift}`).join(', '));
}

// ── What the integrator is not allowed to lose ───────────────────────
{
  const worstE = Math.max(...solo.map((s) => s.dE));
  chk('the energy is bounded, not draining — an orbit that leaked would spiral in on screen',
      worstE < 1e-5,
      solo.map((s) => `e=${n(s.e)}, ${n(s.t / s.period, 1)} orbits: ${ex(s.dE)}`).join(', '));

  const worstL = Math.max(...solo.map((s) => s.dL));
  const worstA = Math.max(...solo.map((s) => Math.abs(s.areaRate)));
  chk('the angular momentum is exact, so equal areas take equal times',
      worstL < 1e-11 && worstA < 1e-9,
      `ΔL/L ≤ ${ex(worstL)}; swept area per unit time vs L/2 ≤ ${ex(worstA)}`);
}

// ── A circle stays a circle ──────────────────────────────────────────
{
  const circ = await page.evaluate(() => {
    const O = window.__orbit;
    const out = [];
    for (const m of [0.2, 1, 5, 20]) {
      const GM = O.BASE_GM * m;
      // Radii scaled off the star, which is 4.5× wider at 20× the mass —
      // a fixed inner radius would simply be inside it.
      const inner = Math.max(O.STAR_RADIUS * Math.sqrt(m) * 1.6, 45);
      for (const k of [1, 1.9, 3.6, 6.5]) {
        const r = inner * k;
        const p = O.fly(r, 0, 0, Math.sqrt(GM / r), { turns: 2, GM });
        out.push({ m, r, e: p.e, crashed: p.crashed,
                   spread: (p.rMax - p.rMin) / r, ok: Number.isFinite(p.e) });
      }
    }
    return out;
  });
  const good = circ.filter((c) => c.ok);
  const worst = Math.max(...good.map((c) => c.e));
  const worstS = Math.max(...good.map((c) => c.spread));
  chk(`launched at √(GM/r) the orbit comes back a circle — ${circ.length} radii and masses`,
      good.length === circ.length && worst < 1e-5 && worstS < 1e-5,
      `${good.length}/${circ.length} measured; worst measured e ${ex(worst)}, `
      + `worst radial spread ${ex(worstS)}`
      + (good.length === circ.length ? ''
         : '; missing ' + circ.filter((c) => !c.ok)
             .map((c) => `m=${c.m} r=${n(c.r, 0)} crashed=${c.crashed}`).join(', ')));
}

// ── The step each planet runs on ─────────────────────────────────────
{
  const steps = solo.map((s) => (s.period / s.h));
  chk(`every planet gets at least ${K.STEPS_PER_ORBIT} steps per orbit, whatever its size or shape`,
      steps.every((v) => v >= K.STEPS_PER_ORBIT * 0.99),
      solo.map((s, i) => `e=${n(s.e)} h=${ex(s.h)} → ${Math.round(steps[i])}/orbit`).join(', '));

  const hs = solo.map((s) => s.h);
  chk('and they are not all the same step — the tight orbits get a finer one',
      Math.max(...hs) / Math.min(...hs) > 5,
      `h from ${ex(Math.min(...hs))} to ${ex(Math.max(...hs))}`);

  /*
   * One frame's worth of integration is shared, and a share handed out in
   * array order is a share the innermost planet eats: its step is the
   * smallest, so it would take the whole budget and leave the outer planets
   * standing still. Ask for far more than a frame can deliver and check that
   * everyone still moved.
   */
  const fair = await page.evaluate(() => {
    const O = window.__orbit;
    O.setRunning(false);
    O.launchSystem();
    const before = O.planets().map((p) => p.steps);
    O.advance(400);                       // far past any one frame's budget
    const after = O.planets().map((p) => p.steps);
    return after.map((v, i) => v - before[i]);
  });
  chk('and one frame\'s budget is shared out fairly, so no planet is left standing still',
      fair.length === K.SYSTEM.length && fair.every((v) => v > 0),
      fair.join(', '));
}

// ── A planet with a measurement is a planet that cannot die ──────────
{
  /*
   * The page keeps no measurements from retired planets, and the reason is
   * an argument rather than an oversight: two apsides of the same kind is a
   * whole radial period, and a planet that completes one has proved its
   * perihelion clears the star and its aphelion is inside the cut-off — on a
   * fixed ellipse, that settles it for good. So the two populations do not
   * overlap, and this is the check that says so.
   *
   * An earlier version did keep such a list, and a build deliberately broken
   * to double-count from it passed every check in this file, which is how the
   * list was found to be unreachable in the first place.
   */
  const life = await page.evaluate(() => {
    const O = window.__orbit;
    O.setRunning(false);
    O.clear();
    const GM = O.params().gm;
    O.launch(150, 0, 0, Math.sqrt(GM / 150));            // stays
    O.launch(150, 0, 0, Math.sqrt(GM / 150) * 0.16);     // plunges into the star
    O.launch(150, 0, 0, Math.sqrt(GM / 150) * 2.2);      // leaves for good
    for (let i = 0; i < 500; i++) O.advance(1);
    const p = O.planets();
    return { total: p.length, alive: p.filter((q) => q.alive).length,
             crashed: p.filter((q) => q.crashed).length,
             escaped: p.filter((q) => q.escaped).length,
             points: O.points().length,
             deadWithTurns: p.filter((q) => !q.alive && q.turns > 0).length,
             liveWithTurns: p.filter((q) => q.alive && q.turns > 0).length };
  });
  chk('one planet orbits, one falls in, one leaves — and only the orbit is measured',
      life.total === 3 && life.alive === 1 && life.crashed === 1 && life.escaped === 1
      && life.points === 1 && life.liveWithTurns === 1,
      JSON.stringify(life));

  chk('no planet ever dies holding a measurement, so none can be counted twice',
      life.deadWithTurns === 0 && life.points === life.liveWithTurns,
      `${life.deadWithTurns} dead planets with a completed orbit; `
      + `${life.points} points for ${life.liveWithTurns} measured planets`);
}

// ── Changing the star invalidates the chart ──────────────────────────
{
  const swap = await page.evaluate(() => {
    const O = window.__orbit;
    O.setRunning(false);
    O.launchSystem();
    for (let i = 0; i < 600; i++) O.advance(2);
    const before = O.points().length;
    const el = document.getElementById('star-mass');
    el.value = '3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { before, after: O.points().length, planets: O.planets().length };
  });
  chk('changing the star mass clears the chart, because those points were measured around a different star',
      swap.before >= 4 && swap.after === 0 && swap.planets === 0,
      JSON.stringify(swap));
}

// ── The live page ────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  const shown = await page.evaluate(() => {
    const O = window.__orbit;
    O.setRunning(false);
    O.launchSystem();
    for (let i = 0; i < 900; i++) O.advance(2);
    O.select(1);
    O.advance(0);
    const txt = (id) => document.getElementById('prop-' + id).textContent.trim();
    const p = O.planets()[1];
    const fit = O.fit();
    return { fit, p, gm: O.params().gm, pts: O.points().length,
             alive: O.planets().filter((q) => q.alive).length,
             count: txt('count'), slope: txt('slope'), gmTxt: txt('gm'),
             resid: txt('resid'),
             axis: txt('axis'), ecc: txt('ecc'), period: txt('period'),
             drift: txt('drift') };
  });
  chk('the panel prints the fit the chart is drawn from',
      shown.count === `${shown.alive} / ${shown.pts}`
      && shown.slope === `${shown.fit.slope.toFixed(4)} / 1.5000`
      && shown.gmTxt === `${shown.fit.gm.toFixed(2)} / ${shown.gm.toFixed(2)}`
      && shown.resid === shown.fit.residual.toExponential(1),
      `${shown.count} | ${shown.slope} | ${shown.gmTxt} | ${shown.resid}`);

  /*
   * The slope readout cannot be held to being a measurement, and that is a
   * property of the page rather than a hole here: the fit lands within a part
   * per million of 3⁄2, so "1.5000" is what a measurement and a hard-coded
   * constant both print, at any number of decimals anyone would show. The two
   * figures beside it are not round, and they are what this holds — GM has to
   * follow the star, and the residual has to be the spread of the points that
   * were actually fitted.
   */
  const moved = await page.evaluate(() => {
    const O = window.__orbit;
    O.setRunning(false);
    const el = document.getElementById('star-mass');
    el.value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    O.launchSystem();
    for (let i = 0; i < 900; i++) O.advance(2 / Math.sqrt(5));
    const txt = (id) => document.getElementById('prop-' + id).textContent.trim();
    return { fit: O.fit(), gm: O.params().gm, gmTxt: txt('gm'), resid: txt('resid') };
  });
  chk('and both follow the star when it changes — neither is a constant on the page',
      moved.gmTxt === `${moved.fit.gm.toFixed(2)} / ${moved.gm.toFixed(2)}`
      && moved.gmTxt !== shown.gmTxt
      && moved.resid === moved.fit.residual.toExponential(1),
      `${shown.gmTxt} → ${moved.gmTxt}; residual ${shown.resid} → ${moved.resid}`);

  chk('and the selected planet\'s own measured orbit beside it',
      shown.axis === shown.p.a.toFixed(1)
      && shown.ecc === shown.p.e.toFixed(4)
      && shown.period === `${shown.p.period.toFixed(2)} / ${shown.p.kepler.toFixed(2)}`
      && shown.drift === shown.p.driftPerOrbit.toExponential(1),
      `a ${shown.axis} | e ${shown.ecc} | T ${shown.period} | drift ${shown.drift}`);

  /*
   * Counting lit pixels is not enough: the frame, the axis labels and the
   * fitted line clear any reasonable threshold on their own, so a chart that
   * plotted no points at all would still look painted. The points are the
   * only saturated colour on it — everything else is drawn in the theme's
   * grey — so those are what get counted, and against the same canvas with
   * nothing to plot.
   */
  const paintCount = () => page.evaluate(() => {
    const c = document.getElementById('kepler-plot');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const pal = window.__orbit.PALETTE.map((h) => [
      parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
    ]);
    let lit = 0;
    let dots = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      lit++;
      for (const [r, g, b] of pal) {
        if (Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - g) < 24
            && Math.abs(d[i + 2] - b) < 24) { dots++; break; }
      }
    }
    return { lit, dots };
  });
  const painted = await paintCount();
  const empty = await page.evaluate(() => {
    window.__orbit.clear();
    window.__orbit.advance(0);
    return true;
  }).then(paintCount);
  chk('and the chart really is drawn — six points in the planets\' own colours, not just a frame and a line',
      painted.dots > 150 && empty.dots === 0 && empty.lit > 100,
      `with six planets: ${painted.dots} planet-coloured pixels of ${painted.lit} lit; `
      + `with none: ${empty.dots} of ${empty.lit}`);

  const dragged = await page.evaluate(() => {
    const O = window.__orbit;
    O.clear();
    const c = document.getElementById('stage');
    const r = c.getBoundingClientRect();
    const opts = (x, y) => ({ clientX: r.left + x, clientY: r.top + y, bubbles: true });
    const cx = r.width / 2;
    const cy = 640 / 2;
    c.dispatchEvent(new MouseEvent('mousedown', opts(cx + 160, cy)));
    window.dispatchEvent(new MouseEvent('mousemove', opts(cx + 160, cy + 22)));
    window.dispatchEvent(new MouseEvent('mouseup', opts(cx + 160, cy + 22)));
    const p = O.planets();
    return { count: p.length, x: p[0]?.x, y: p[0]?.y, vx: p[0]?.vx, vy: p[0]?.vy,
             scale: O.VELOCITY_SCALE };
  });
  chk('dragging on the canvas launches a planet where you pointed, at the velocity you drew',
      dragged.count === 1 && Math.abs(dragged.x - 160) < 1.5 && Math.abs(dragged.y) < 1.5
      && Math.abs(dragged.vy - 22 * dragged.scale) < 0.2 && Math.abs(dragged.vx) < 0.2,
      JSON.stringify(dragged));
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  // Not params().starMass — that is read straight off the slider, so it
  // would move whether or not the page is listening.
  const sig = async () => page.evaluate(() => JSON.stringify([
    document.getElementById('star-mass-value')?.textContent,
    document.getElementById('time-scale-value')?.textContent,
    window.__orbit.params().timeScale,
  ]));
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['star-mass', 4.5], ['time-scale', 40]]) {
    await setV(id, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    planets: window.__orbit.planets().length,
    points: window.__orbit.points().length,
    p: window.__orbit.params(),
  }));
  chk('Reset restores the defaults',
      after.planets === 0 && after.p.starMass === 1 && after.p.timeScale === 10,
      JSON.stringify(after));

  /*
   * And again from a clean page, with every slider already where it started.
   * reset-defaults.js only dispatches an input event for a control that has
   * actually moved, and this page clears the sky when the star mass changes —
   * so a Reset pressed after fiddling gets swept up by that and says nothing
   * about the page's own handler. Pressed with nothing to restore, the page
   * has to do the clearing itself.
   */
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__orbit.setRunning(false); window.__orbit.launchSystem(); });
  const launchedFirst = await page.evaluate(() => window.__orbit.planets().length);
  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  const swept = await page.evaluate(() => ({
    planets: window.__orbit.planets().length, points: window.__orbit.points().length,
  }));
  chk('and clears the sky and the chart even with no slider to put back',
      launchedFirst === K.SYSTEM.length && swept.planets === 0 && swept.points === 0,
      `${launchedFirst} planets before, ${swept.planets} after`);

  await page.evaluate(() => window.__orbit.launchSystem());
  const launched = await page.evaluate(() => window.__orbit.planets().length);
  chk('Launch a system drops a whole system at once', launched === K.SYSTEM.length,
      String(launched));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  /*
   * Wait for the title to actually change rather than for a fixed number of
   * milliseconds. The zh dictionary is fetched on demand, and on a slow
   * machine 300 ms is not always enough — which shows up as ko and zh
   * reporting the same string and the check failing for no reason at all.
   */
  const lang = async (code, prev) => {
    await page.click(`.lang-btn[data-lang="${code}"]`);
    await page.waitForFunction(
      (p) => document.querySelector('h1').textContent.trim() !== p, prev,
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

await finish('orbit');
