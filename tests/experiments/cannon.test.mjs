/*
 * Newton's cannon — the two speeds, extrapolated rather than evaluated.
 *
 * The page writes down one law, a = −GM·r̂/r², and steps it. The claim these
 * checks hold is that the numbers it prints are read back out of the paths
 * that come out, and that they are right: the circular and escape speeds come
 * from a straight line fitted through five measured apogees, none of which
 * belongs to a shot that escaped, and both land within a part per million of
 * √(GM/r₀) and √(2GM/r₀).
 *
 * A word on the tolerances, because they look implausibly tight beside the
 * other suites. There is no randomness anywhere on this page — no thermostat,
 * no Monte Carlo, no sampling — so a given launch speed produces the same
 * trajectory to the last bit on every run, and the bounds below are not
 * absorbing run-to-run scatter because there is none to absorb. What they are
 * absorbing is the difference between one platform's Math.hypot and
 * another's. Each is set roughly an order of magnitude above the residual
 * actually measured, and every one of them was watched fail under a planted
 * defect before it was written down.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/cannon.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

/*
 * Formatters for the failure messages. A page broken badly enough that a
 * shot has no orbit at all hands these `undefined`, and a suite that throws
 * while composing its own error message reports nothing about what broke —
 * which is exactly the run where the message matters most.
 */
const n = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ex = (x, d = 2) => (Number.isFinite(x) ? x.toExponential(d) : String(x));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

const K = await page.evaluate(() => {
  const C = window.__cannon;
  return { GM: C.GM, EARTH_R: C.EARTH_R, LAUNCH_R: C.LAUNCH_R, H: C.H,
           ESCAPE_R: C.ESCAPE_R, shots: C.REFERENCE_SHOTS };
});
const V_CIRC = Math.sqrt(K.GM / K.LAUNCH_R);
const V_ESC = Math.sqrt((2 * K.GM) / K.LAUNCH_R);

// ── Five apogees, one straight line ──────────────────────────────────
const fit = await page.evaluate(() => {
  const C = window.__cannon;
  const r = C.reference();
  return { slope: r.slope, intercept: r.intercept, residual: r.residual,
           vCirc: r.vCirc, vEsc: r.vEsc,
           points: r.points.map((p) => ({ v0: p.v0, ra: p.ra })),
           // Each reference shot re-measured on its own, to show what the
           // fit was actually given.
           els: C.REFERENCE_SHOTS.map((v0) => C.probe(v0)) };
});
{
  /*
   * First, because everything below is fitted to it: the extrapolation must
   * never watch anything escape. An unbound shot has no apogee, so its
   * "apogee" would be wherever the integration gave up — a screen edge — and
   * the line would be fitted to that.
   */
  chk('every shot the fit is given stayed in orbit',
      fit.els.every((e) => e.ok && !e.far && !e.hit && e.e < 1
                           && e.ra < K.ESCAPE_R && e.v0 < V_ESC),
      fit.els.map((e) => (e.ok ? `${e.v0}: e=${e.e.toFixed(3)}`
                               : `${e.v0}: NO APOGEE (hit=${e.hit} far=${e.far})`)).join(', '));

  const straight = Number.isFinite(fit.residual) && fit.residual < 5e-7;
  chk(`the five reference apogees fall on a straight line in 1/v₀² — residual ${Number(fit.residual).toExponential(2)}`,
      straight,
      fit.points.map((p) => `${p.v0}→${Number(p.ra).toFixed(2)}`).join(' '));

  /*
   * The line is 1/r_apogee = (2GM/r₀²)·(1/v₀²) − 1/r₀. Neither number is
   * used to produce the fit; they are what the fit comes out as.
   */
  const wantM = (2 * K.GM) / (K.LAUNCH_R * K.LAUNCH_R);
  const wantC = -1 / K.LAUNCH_R;
  chk('its slope is 2GM/r₀² and its intercept is −1/r₀',
      Math.abs(fit.slope / wantM - 1) < 1e-6 && Math.abs(fit.intercept / wantC - 1) < 1e-6,
      `slope ${fit.slope.toFixed(6)} vs ${wantM.toFixed(6)}, `
      + `intercept ${fit.intercept.toExponential(6)} vs ${wantC.toExponential(6)}`);

  chk('where the line reaches an unreachable apogee is the escape speed',
      Math.abs(fit.vEsc / V_ESC - 1) < 1e-6,
      `${fit.vEsc.toFixed(6)} vs √(2GM/r₀) = ${V_ESC.toFixed(6)} `
      + `(${((fit.vEsc / V_ESC - 1) * 1e6).toFixed(3)} ppm)`);

  chk('and where it brings the apogee home to the muzzle is the circular speed',
      Math.abs(fit.vCirc / V_CIRC - 1) < 1e-6,
      `${fit.vCirc.toFixed(6)} vs √(GM/r₀) = ${V_CIRC.toFixed(6)} `
      + `(${((fit.vCirc / V_CIRC - 1) * 1e6).toFixed(3)} ppm)`);
}

// ── Fire at the measured circular speed and nothing happens ──────────
{
  const circ = await page.evaluate((v0) => {
    const C = window.__cannon;
    const sh = C.newShot(v0);
    // One full turn at that radius, plus a little.
    const turn = (2 * Math.PI * C.LAUNCH_R) / v0;
    while (sh.alive && sh.t < turn * 1.02) C.advanceShot(sh);
    return { rMin: sh.rMin, rMax: sh.rMax, t: sh.t,
             el: C.elements(sh), r0: C.LAUNCH_R };
  }, fit.vCirc);
  const spread = (circ.rMax - circ.rMin) / circ.r0;
  chk('a ball fired at the measured circular speed keeps its radius for a whole orbit',
      spread < 1e-6 && circ.el.ok && circ.el.e < 1e-6,
      `radius ${n(circ.rMin, 6)}–${n(circ.rMax, 6)} of ${circ.r0} `
      + `(spread ${ex(spread)}), measured e = ${ex(circ.el.e)}`);
  chk('and its period is measured off the angle swept, there being no apsis to find',
      circ.el.how === 'revolution'
      && Math.abs(circ.el.period / circ.el.kepler - 1) < 1e-6,
      `${circ.el.how}: T = ${n(circ.el.period, 4)} vs 2π√(a³/GM) = ${n(circ.el.kepler, 4)}`);
}

// ── Kepler III, from half an orbit at a time ─────────────────────────
const sweep = await page.evaluate(() => {
  const C = window.__cannon;
  return [5.45, 5.6, 5.8, 6.0, 6.4, 7.0, 7.4, 7.8, 8.0].map((v0) => C.probe(v0));
});
{
  const bad = sweep.filter((e) => !e.ok);
  const worst = Math.max(...sweep.map((e) => Math.abs(e.period / e.kepler - 1)));
  chk(`the measured period is 2π√(a³/GM) at all ${sweep.length} launch speeds`,
      bad.length === 0 && worst < 1e-6,
      `worst ${n(worst * 1e9, 1)} ppb; `
      + sweep.map((e) => `${e.v0}: ${n(e.period, 2)}/${n(e.kepler, 2)}`).join(' '));

  /*
   * And the same statement without GM in it, which is the form Kepler had:
   * T²/a³ is one constant for every orbit, whatever its size or shape. These
   * nine span a factor of 5 in semi-major axis and 0.12 to 0.89 in
   * eccentricity.
   */
  const ks = sweep.map((e) => (e.period * e.period) / (e.a * e.a * e.a));
  const lo = Math.min(...ks);
  const hi = Math.max(...ks);
  chk('so T²/a³ is one number for all of them, whatever the eccentricity',
      (hi - lo) / lo < 2e-6
      && Math.abs(ks[0] / ((4 * Math.PI * Math.PI) / K.GM) - 1) < 2e-6,
      `T²/a³ = ${ex(lo, 9)}–${ex(hi, 9)}, `
      + `4π²/GM = ${((4 * Math.PI * Math.PI) / K.GM).toExponential(9)}; `
      + `a ${n(sweep[0].a, 0)}–${n(sweep.at(-1).a, 0)}, `
      + `e ${n(sweep[0].e, 2)}–${n(sweep.at(-1).e, 2)}`);
}

// ── The shape of the path, not just its size ─────────────────────────
const shapes = await page.evaluate(() => {
  const C = window.__cannon;
  return [5.6, 6.4, 7.2, 7.9].map((v0) => {
    const t = C.track(v0, { steps: 300000, every: 7 });
    const el = t.el;
    const s = t.summary;
    const p = el.a * (1 - el.e * el.e);
    // The launch is an apsis on the −y axis: periapsis there if the ball
    // climbs away from it, apoapsis there if it falls.
    const th0 = el.rp === C.LAUNCH_R ? -Math.PI / 2 : Math.PI / 2;
    let visViva = 0;
    let conic = 0;
    for (const q of t.path) {
      visViva = Math.max(visViva, Math.abs(q.v2 / (C.GM * (2 / q.r - 1 / el.a)) - 1));
      conic = Math.max(conic, Math.abs(q.r / (p / (1 + el.e * Math.cos(q.th - th0))) - 1));
    }
    const apsis = s.apsides.find((q) => Math.abs(q.r - C.LAUNCH_R) > 1e-6 * C.LAUNCH_R);
    return { v0, ok: el.ok, e: el.e, a: el.a, orbits: s.t / el.period, n: t.path.length,
             visViva, conic, p, pFromL: (s.L * s.L) / C.GM,
             dE: s.dE, dL: s.dL, areaRate: s.area / s.t / (s.L / 2) - 1,
             apsisT: apsis ? 2 * apsis.t : NaN, revT: s.revT };
  });
});
{
  const worst = Math.max(...shapes.map((s) => s.visViva));
  chk('every point on every path obeys v² = GM(2/r − 1/a), with a taken from the two measured apsides',
      shapes.every((s) => s.ok) && worst < 1e-6,
      shapes.map((s) => `v0=${s.v0} (${s.n} samples over ${n(s.orbits, 1)} orbits): ${ex(s.visViva)}`).join(', '));

  const worstC = Math.max(...shapes.map((s) => s.conic));
  chk('and the path is the conic r = p/(1 + e·cosθ) for the measured e',
      worstC < 5e-6,
      shapes.map((s) => `v0=${s.v0} e=${n(s.e)}: ${ex(s.conic)}`).join(', '));

  const worstP = Math.max(...shapes.map((s) => Math.abs(s.p / s.pFromL - 1)));
  chk('with the semi-latus rectum from the geometry equal to L²/GM from the motion',
      worstP < 1e-6,
      shapes.map((s) => `v0=${s.v0}: a(1−e²) = ${n(s.p, 4)} vs L²/GM = ${n(s.pFromL, 4)}`).join(', '));

  /*
   * Two clocks on the same shot: half an orbit measured to the turning point
   * of the radius, and a whole one measured by unwrapping the polar angle.
   * Nothing forces them to agree — the first is a parabola through three
   * radii, the second a linear crossing of 2π — so when they do, both are
   * doing their job.
   */
  const worstT = Math.max(...shapes.map((s) => Math.abs(s.apsisT / s.revT - 1)));
  chk('and the period timed by the apsis agrees with the period timed by the angle',
      Number.isFinite(worstT) && worstT < 1e-6,
      shapes.map((s) => `v0=${s.v0}: ${n(s.apsisT, 4)} vs ${n(s.revT, 4)}`).join(', '));
}

// ── What the integrator is not allowed to lose ───────────────────────
{
  const worstE = Math.max(...shapes.map((s) => s.dE));
  chk('the energy is bounded, not drifting — velocity Verlet holding the ellipse together',
      worstE < 3e-6,
      shapes.map((s) => `v0=${s.v0}, ${n(s.orbits, 1)} orbits: ΔE/E = ${ex(s.dE)}`).join(', '));

  /*
   * Kepler's second law. For a central force the position update only ever
   * adds multiples of r and v to r, so x × v comes out of each step
   * unchanged — the equal-area law is exact here rather than approximate,
   * and that is worth asserting precisely because it is the first thing a
   * mis-signed or off-centre force would break.
   */
  const worstL = Math.max(...shapes.map((s) => s.dL));
  const worstA = Math.max(...shapes.map((s) => Math.abs(s.areaRate)));
  chk('and the angular momentum is exact, so equal areas take equal times',
      worstL < 1e-11 && worstA < 1e-9,
      `ΔL/L ≤ ${ex(worstL)}; swept area per unit time vs L/2 ≤ ${ex(worstA)}`);
}

// ── Where the planet gets in the way ─────────────────────────────────
{
  const graze = await page.evaluate(() => {
    const C = window.__cannon;
    // Bisect on a fact, not a formula: did the ball reach the ground?
    let lo = 4.0;
    let hi = 7.0;
    for (let i = 0; i < 44; i++) {
      const m = (lo + hi) / 2;
      if (C.probe(m).hit) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  });
  // r_p ≥ R_E for a horizontal launch at r₀ ⇔ v₀ ≥ √(2GM·R_E/(r₀(r₀+R_E))).
  const want = Math.sqrt((2 * K.GM * K.EARTH_R) / (K.LAUNCH_R * (K.LAUNCH_R + K.EARTH_R)));
  chk('the launch speed at which the ball stops hitting the ground is √(2GM·R_E/(r₀(r₀+R_E)))',
      Math.abs(graze / want - 1) < 1e-6,
      `${graze.toFixed(6)} vs ${want.toFixed(6)} (${((graze / want - 1) * 1e6).toFixed(3)} ppm)`);

  chk('and it sits below the circular speed, which is why the thought experiment works',
      graze < V_CIRC && graze > K.LAUNCH_R * 0,
      `${graze.toFixed(4)} < ${V_CIRC.toFixed(4)}`);
}

// ── The ball on the screen is the one the panel describes ────────────
{
  const same = await page.evaluate(async () => {
    const C = window.__cannon;
    C.setRunning(false);
    C.reset();
    document.getElementById('velocity').value = '7';
    document.getElementById('velocity').dispatchEvent(new Event('input', { bubbles: true }));
    C.fire();
    C.tickSteps(4000);
    const live = C.active();
    // The same launch, stepped independently through the same hook.
    const sh = C.newShot(7);
    for (let i = 0; i < 4000; i++) C.advanceShot(sh);
    return { live, aside: { x: sh.s.x, y: sh.s.y, vx: sh.s.vx, vy: sh.s.vy, t: sh.t } };
  });
  const d = Math.hypot(same.live.x - same.aside.x, same.live.y - same.aside.y);
  chk('the drawn ball takes exactly the steps the headless shot takes — same fixed h, same path',
      same.live.steps === 4000 && d === 0
      && same.live.vx === same.aside.vx && same.live.vy === same.aside.vy,
      `after 4000 steps, ${d} px apart at t = ${same.live.t.toFixed(2)}`);

  /*
   * Both sides of the circular speed. Above it the muzzle is the perigee and
   * only the apogee is a new number; below it the muzzle is the apogee and
   * only the perigee is. Checking one side alone lets a readout that quietly
   * prints the muzzle radius for the other apsis pass unnoticed.
   */
  const panel = [];
  for (const v0 of [7, 5.6]) {
    panel.push(await page.evaluate((v) => {
      const C = window.__cannon;
      C.reset();
      document.getElementById('velocity').value = String(v);
      document.getElementById('velocity').dispatchEvent(new Event('input', { bubbles: true }));
      C.fire();
      C.tickSteps(500);
      const a = C.active();
      const txt = (id) => document.getElementById(id).textContent.trim();
      return { v0: v, el: a.el, ER: C.EARTH_R, r: C.reference(),
               apsides: txt('prop-apsides'), ecc: txt('prop-ecc'),
               period: txt('prop-period'), speed: txt('prop-speed'),
               vcirc: txt('prop-vcirc'), vesc: txt('prop-vesc'),
               v: Math.hypot(a.vx, a.vy) };
    }, v0));
  }
  const shown = panel[0];
  chk('the panel prints the measured orbit and not a second opinion, on both sides of the circular speed',
      panel.every((s) =>
        s.apsides === `${(s.el.rp - s.ER).toFixed(1)} / ${(s.el.ra - s.ER).toFixed(1)}`
        && s.ecc === s.el.e.toFixed(4)
        && s.period === `${s.el.period.toFixed(1)} / ${s.el.kepler.toFixed(1)}`
        && Math.abs(parseFloat(s.speed) - s.v) < 0.01),
      panel.map((s) => `v0=${s.v0}: ${s.apsides} (measured ${n(s.el.rp - s.ER, 1)} / `
                       + `${n(s.el.ra - s.ER, 1)}) | e ${s.ecc} | T ${s.period}`).join(' ;; '));

  /*
   * The printed pair has to be the fit on the left and the closed form on the
   * right — but the two agree to seven digits, so no number of decimals could
   * ever tell them apart on screen, and that is the whole point of the page
   * rather than a hole in the check. What is worth holding is that the left
   * number really is the extrapolation: this refits the page's own five
   * measured apogees here, independently of the code that produced them, and
   * requires the readout to be that. A hard-coded 5.822, or a fit taken from
   * some other set of points, does not survive it.
   */
  const refit = (() => {
    const n = fit.points.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of fit.points) {
      const x = 1 / (p.v0 * p.v0);
      const y = 1 / p.ra;
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const c = (sy - m * sx) / n;
    return { vEsc: 1 / Math.sqrt(-c / m),
             vCirc: 1 / Math.sqrt((1 / K.LAUNCH_R - c) / m) };
  })();
  chk('and the two reference speeds are shown measured-first, closed-form-second',
      shown.vcirc === `${shown.r.vCirc.toFixed(3)} / ${V_CIRC.toFixed(3)}`
      && shown.vesc === `${shown.r.vEsc.toFixed(3)} / ${V_ESC.toFixed(3)}`
      && Math.abs(shown.r.vCirc / refit.vCirc - 1) < 1e-12
      && Math.abs(shown.r.vEsc / refit.vEsc - 1) < 1e-12,
      `${shown.vcirc} | ${shown.vesc}; refitted here: `
      + `${refit.vCirc.toFixed(6)}, ${refit.vEsc.toFixed(6)}`);
}

// ── The outcome is what happened, judged against the measurement ─────
{
  const seen = [];
  for (const v0 of [0, 3, 5, 5.4, 5.45, 5.8, 6.5, 7.9, 8.2, 8.25, 9, 14]) {
    await setV('velocity', v0);
    seen.push(await page.evaluate(() => {
      const C = window.__cannon;
      C.reset();
      C.fire();
      return C.active().outcome;
    }));
  }
  const vs = [0, 3, 5, 5.4, 5.45, 5.8, 6.5, 7.9, 8.2, 8.25, 9, 14];
  const graze = 5.416186;
  const want = vs.map((v) => (v < graze ? 'outcomeFalls'
                              : v >= fit.vEsc ? 'outcomeEscapes' : 'outcomeOrbits'));
  chk('the outcome label tracks the two measured boundaries across the whole slider',
      seen.every((s, i) => s === want[i]),
      vs.map((v, i) => `${v}:${seen[i].replace('outcome', '')}`).join(' '));

  // 8.20 is the one that matters: it leaves the window and never comes back
  // on screen, and it is still a bound ellipse — 8.2339 is where the line
  // says the apogee runs away, and 8.20 is below it.
  chk('including the shot that leaves the screen without leaving the planet',
      seen[vs.indexOf(8.2)] === 'outcomeOrbits' && seen[vs.indexOf(8.25)] === 'outcomeEscapes',
      `8.20 → ${seen[vs.indexOf(8.2)]}, 8.25 → ${seen[vs.indexOf(8.25)]}, measured v_esc ${fit.vEsc.toFixed(4)}`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  // A fresh navigation rather than a reload: the controls are mirrored into
  // the query string, so reloading would restore the fiddling above.
  await page.goto(B, { waitUntil: 'networkidle' });
  /*
   * Deliberately not including params().v0 here. It reads the slider's own
   * value attribute, so it moves whether or not the page is listening —
   * a signature containing it would call a dead velocity handler alive. What
   * goes in is only state the page itself maintains: the two printed labels
   * and the time scale the loop actually runs at.
   */
  const sig = async () => page.evaluate(() => JSON.stringify([
    window.__cannon.params().timeScale,
    document.getElementById('velocity-value')?.textContent,
    document.getElementById('time-scale-value')?.textContent,
  ]));
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['velocity', 9.5], ['time-scale', 40]]) {
    await setV(id, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.evaluate(() => { window.__cannon.fire(); });
  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    shots: window.__cannon.shots().length, p: window.__cannon.params(),
  }));
  chk('Reset restores the defaults and clears the shots',
      after.shots === 0 && after.p.v0 === 5 && after.p.timeScale === 10,
      JSON.stringify(after));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(300);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(300);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(300);
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

await finish('cannon');
