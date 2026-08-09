/*
 * Predator and prey — Volterra's averages, and a period that is not the one
 * in the textbook.
 *
 * The page integrates dx/dt = αx − βxy, dy/dt = δxy − γy with RK4 and then
 * measures the cycle it produces. Two things it used to print are now
 * measured: the "equilibrium", which no population ever sits at, and the
 * "period", which was the linearised one and is only right for a cycle of no
 * size at all.
 *
 * What replaces the first is Volterra's theorem, and it is the best thing on
 * the page: the *time average* of the prey over one whole cycle is exactly
 * γ/δ and of the predators α/β, however violent the swing. Measured by
 * accumulating ∫x dt between two prey peaks, that holds to about a part in
 * 10⁴ on cycles from a whisper around the fixed point to five times its size.
 *
 * What replaces the second is the measured period, shown beside 2π/√(αγ) so
 * the gap is visible: 0.01% for a tiny cycle, 28% for a big one. The phase
 * lag goes the same way, a quarter of a cycle only in the small limit.
 *
 * No randomness here, so the bounds are not absorbing run-to-run scatter.
 * Each sits about an order of magnitude above the residual measured on this
 * build, and each was watched fail under a planted defect.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/lotka.html');
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

// ── Volterra's law of averages ───────────────────────────────────────
const sizes = await page.evaluate(() => {
  const L = window.__lotka;
  const p = L.params();
  const xs = p.gamma / p.delta;
  const ys = p.alpha / p.beta;
  return [1.05, 1.25, 1.75, 2.5, 3.5, 5].map((f) => {
    const o = L.fly(p, xs * f, ys, { h: 1e-3, cycles: 2 });
    return { f, ...o, xs, ys, T0: L.linearPeriod(p) };
  });
});
{
  const wx = Math.max(...sizes.map((s) => Math.abs(s.meanX / s.xs - 1)));
  const wy = Math.max(...sizes.map((s) => Math.abs(s.meanY / s.ys - 1)));
  chk('every cycle closed and was measured', sizes.every((s) => s.cycles >= 2),
      sizes.map((s) => `${n(s.f, 2)}×: ${s.cycles}`).join(', '));

  chk('the prey averaged over a whole cycle is γ/δ — Volterra, on cycles up to five times the fixed point',
      wx < 1e-3,
      `worst ${ex(wx)}; ` + sizes.map((s) => `${n(s.f, 2)}×: ${n(s.meanX, 5)}`).join(', ')
      + ` against γ/δ = ${sizes[0].xs}`);

  chk('and the predators average to α/β on the same cycles',
      wy < 1e-3,
      `worst ${ex(wy)}; ` + sizes.map((s) => `${n(s.f, 2)}×: ${n(s.meanY, 5)}`).join(', ')
      + ` against α/β = ${n(sizes[0].ys, 3)}`);

  /*
   * The claim only means something if the populations are genuinely swinging.
   * An orbit that never left the fixed point would average to it trivially,
   * so the spread is asserted before the average that rests on it.
   */
  const biggest = sizes[sizes.length - 1];
  chk('on swings that are nothing like the average — the largest reaches five times it',
      biggest.xMax / biggest.xs > 4.5 && sizes[0].xMax / sizes[0].xs < 1.1,
      `prey peaks from ${n(sizes[0].xMax, 2)} to ${n(biggest.xMax, 1)}, `
      + `around a mean of ${sizes[0].xs}`);
}

// ── The period is not the linearised one ─────────────────────────────
{
  const ratios = sizes.map((s) => s.T / s.T0);
  chk('the measured period is longer than 2π/√(αγ), and by more the bigger the cycle',
      ratios.every((r, i) => i === 0 || r > ratios[i - 1])
      && Math.min(...ratios) < 1.001 && Math.max(...ratios) > 1.2,
      sizes.map((s, i) => `${n(s.f, 2)}×: ${n(s.T, 3)} = ${n(ratios[i], 4)}·T₀`).join(', ')
      + `; T₀ = ${n(sizes[0].T0, 4)}`);

  /*
   * And it approaches it the right way. The linearised period is the limit of
   * zero amplitude, and the correction to it is quadratic — halve the swing
   * and the gap should quarter, which is a statement about the shape of the
   * approach rather than about any one number.
   */
  const small = await page.evaluate(() => {
    const L = window.__lotka;
    const p = L.params();
    const xs = p.gamma / p.delta;
    const ys = p.alpha / p.beta;
    const T0 = L.linearPeriod(p);
    return [0.2, 0.1, 0.05, 0.025].map((e) => {
      const o = L.fly(p, xs * (1 + e), ys, { h: 1e-3, cycles: 2 });
      return { e, gap: o.T / T0 - 1, lag: o.lag };
    });
  });
  const quarters = small.slice(1).map((s, i) => small[i].gap / s.gap);
  chk('and approaches it quadratically as the swing shrinks — halve the amplitude, quarter the gap',
      quarters.every((q) => q > 3.5 && q < 4.5) && small[small.length - 1].gap < 1e-4,
      small.map((s) => `amp ${s.e}: ${ex(s.gap)}`).join(', ')
      + `; ratios ${quarters.map((q) => n(q, 2)).join(', ')}`);

  chk('the predator lag is a quarter of a cycle only in that same limit, and a tenth for a big one',
      Math.abs(small[small.length - 1].lag - 0.25) < 3e-3
      && sizes[sizes.length - 1].lag < 0.12,
      `lag/T is ${n(small[small.length - 1].lag, 5)} at the smallest swing and `
      + `${n(sizes[sizes.length - 1].lag, 5)} at the largest`);
}

// ── The same, away from the default parameters ───────────────────────
{
  const others = await page.evaluate(() => {
    const L = window.__lotka;
    const sets = [{ alpha: 0.6, beta: 0.2, delta: 0.05, gamma: 0.8 },
                  { alpha: 2.0, beta: 0.8, delta: 0.2, gamma: 0.2 },
                  { alpha: 1.5, beta: 0.15, delta: 0.03, gamma: 1.2 },
                  { alpha: 0.2, beta: 1.0, delta: 0.3, gamma: 1.0 }];
    return sets.map((p) => {
      const xs = p.gamma / p.delta;
      const ys = p.alpha / p.beta;
      const o = L.fly(p, xs * 1.8, ys, { h: 1e-3, cycles: 2 });
      return { p, xs, ys, T0: L.linearPeriod(p), ...o };
    });
  });
  const worst = Math.max(...others.map((s) =>
    Math.max(Math.abs(s.meanX / s.xs - 1), Math.abs(s.meanY / s.ys - 1))));
  chk('the averages are γ/δ and α/β at four other parameter sets, spanning 1 to 40 in the fixed point',
      worst < 1e-3
      && Math.max(...others.map((s) => s.xs)) / Math.min(...others.map((s) => s.xs)) > 30,
      `worst ${ex(worst)}; x* from ${n(Math.min(...others.map((s) => s.xs)), 2)} `
      + `to ${n(Math.max(...others.map((s) => s.xs)), 0)}`);
  chk('and every one of them cycles slower than its own linearised period',
      others.every((s) => s.T / s.T0 > 1.01),
      others.map((s) => `γ=${s.p.gamma}: ${n(s.T / s.T0, 4)}·T₀`).join(', '));
}

// ── What the integrator is not allowed to lose ───────────────────────
{
  const drift = await page.evaluate(() => {
    const L = window.__lotka;
    const p = L.params();
    const out = {};
    for (const h of [0.02, 1e-3]) {
      out[h] = L.fly(p, 10, 5, { h, cycles: 8 }).drift;
    }
    return out;
  });
  chk('V is conserved along the orbit, so the loop closes rather than spiralling',
      drift[0.02] < 1e-6 && drift[0.001] < 1e-10,
      `over eight cycles: ${ex(drift[0.02])} at the page's coarsest step, `
      + `${ex(drift[0.001])} at h = 1e-3`);
}

// ── The live page ────────────────────────────────────────────────────
{
  const live = await page.evaluate(() => {
    const L = window.__lotka;
    L.setPaused(false);
    for (let i = 0; i < 4000; i++) L.advance(0.016);
    const c = L.cycle();
    const p = L.params();
    const txt = (id) => document.getElementById('out-' + id).textContent.trim();
    return { c, p, T0: L.linearPeriod(p), s: L.state(),
             prey: txt('prey'), pred: txt('predator'),
             preyEq: txt('prey-eq'), predEq: txt('pred-eq'),
             period: txt('period'), lag: txt('lag'),
             invariant: txt('invariant'), drift: txt('drift') };
  });
  chk('the live run measures its own cycles as they close',
      live.c.cycles >= 3 && Number.isFinite(live.c.T) && Number.isFinite(live.c.meanX),
      `${live.c.cycles} cycles, T = ${n(live.c.T, 4)}`);

  const xs = live.p.gamma / live.p.delta;
  const ys = live.p.alpha / live.p.beta;
  chk('and its averages are γ/δ and α/β at the coarser step the page actually runs',
      Math.abs(live.c.meanX / xs - 1) < 5e-3 && Math.abs(live.c.meanY / ys - 1) < 5e-3,
      `⟨x⟩ ${n(live.c.meanX, 4)} vs ${xs}, ⟨y⟩ ${n(live.c.meanY, 4)} vs ${n(ys, 3)}`);

  chk('the panel prints the measurement beside the closed form, on all three pairs',
      live.preyEq === `${live.c.meanX.toFixed(2)} / ${xs.toFixed(2)}`
      && live.predEq === `${live.c.meanY.toFixed(2)} / ${ys.toFixed(2)}`
      && live.period === `${live.c.T.toFixed(2)} / ${live.T0.toFixed(2)}`
      && live.lag === `${live.c.lag.toFixed(3)} / 0.250`,
      `${live.preyEq} | ${live.predEq} | ${live.period} | ${live.lag}`);

  chk('and the two the reader can see disagree — the measured period is not the textbook one',
      Math.abs(live.c.T / live.T0 - 1) > 0.05
      && live.period.split(' / ')[0] !== live.period.split(' / ')[1],
      `${live.period} — ${n((live.c.T / live.T0 - 1) * 100, 1)}% longer`);

  chk('the drift readout is the spread of V over the run, not a constant',
      live.drift === live.c.drift.toExponential(1) && live.c.drift > 0 && live.c.drift < 1e-6,
      live.drift);
}

// ── A changed parameter is a different system ────────────────────────
{
  const swap = await page.evaluate(() => {
    const L = window.__lotka;
    L.setPaused(false);
    for (let i = 0; i < 2000; i++) L.advance(0.016);
    const before = L.cycle().cycles;
    const el = document.getElementById('gamma');
    el.value = '0.6';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const after = L.cycle();
    // The speed slider only rescales how fast simulated time arrives, so it
    // must not throw a measurement away.
    for (let i = 0; i < 2000; i++) L.advance(0.016);
    const grown = L.cycle().cycles;
    const rate = document.getElementById('rate');
    rate.value = '2';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    return { before, afterCycles: after.cycles, afterT: after.T, grown,
             keptOverRate: L.cycle().cycles };
  });
  chk('changing a rate constant throws the half-measured cycle away',
      swap.before >= 1 && swap.afterCycles === 0 && !Number.isFinite(swap.afterT),
      JSON.stringify(swap));
  chk('but changing the playback speed does not, because every number is in simulated time',
      swap.grown >= 1 && swap.keptOverRate === swap.grown,
      `${swap.grown} cycles before the speed change, ${swap.keptOverRate} after`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  const sig = async () => page.evaluate(() => JSON.stringify([
    ['alpha', 'beta', 'delta', 'gamma', 'rate']
      .map((k) => document.getElementById(k + '-value')?.textContent),
    window.__lotka.params(),
  ]));
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['alpha', 1.5], ['beta', 0.6], ['delta', 0.15],
                         ['gamma', 0.7], ['rate', 2.5]]) {
    await setV(id, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#pause-btn');
  const paused = await page.evaluate(() => {
    const L = window.__lotka;
    const a = L.state();
    for (let i = 0; i < 60; i++) L.advance(0.016);
    return { was: a, now: L.state(), paused: L.isPaused() };
  });
  chk('Pause stops the integrator', paused.paused && paused.now.t === paused.was.t,
      `t ${n(paused.was.t, 4)} → ${n(paused.now.t, 4)}`);

  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  /*
   * Reset unpauses, so by the time this looks the loop has moved the
   * populations on — asking for x === 10 would be asking the loop to have
   * stopped. What cannot have changed is which orbit they are on: V is
   * conserved, so if the populations were put back to (10, 5) the invariant
   * still reads V(10, 5) however far round they have since travelled.
   */
  const after = await page.evaluate(() => {
    const L = window.__lotka;
    const p = L.params();
    return { p, s: L.state(), c: L.cycle(),
             V: L.invariantAt(p, L.state().x, L.state().y),
             V0: L.invariantAt(p, 10, 5) };
  });
  chk('Reset restores the defaults, and puts the populations back on their starting orbit',
      after.p.alpha === 1.1 && after.p.beta === 0.4 && after.p.delta === 0.1
      && after.p.gamma === 0.4 && after.p.rate === 1
      && after.c.cycles === 0 && after.s.t < 0.5
      && Math.abs(after.V / after.V0 - 1) < 1e-9,
      JSON.stringify({ ...after.p, t: n(after.s.t, 3), cycles: after.c.cycles,
                       V: n(after.V, 6), V0: n(after.V0, 6) }));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  // Wait for the title to change rather than for a fixed delay: the zh
  // dictionary is fetched on demand and a fixed wait races it.
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

await finish('lotka');
