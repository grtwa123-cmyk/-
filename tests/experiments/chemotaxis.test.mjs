import { browser, chk, BASE, finish } from '../lib/harness.mjs';

/*
 * Chemotaxis — run and tumble.
 *
 * The page's rule is three lines and none of them mentions a direction: each
 * cell subtracts the concentration it felt one sub-step ago from the one it
 * feels now, and lets that number scale its chance of tumbling. Everything
 * below is measured off what that rule produces.
 *
 * Two things are worth flagging before the numbers.
 *
 * The first is the measurement, not the model. The dish is 716 × 244 and a
 * cell crosses it in seconds, so a displacement measured between two walls
 * saturates: at t = 100τ the folded ⟨r²⟩ reads 81% low. The page therefore
 * carries an unfolded position beside the real one — a reflection is a
 * mirror, so flipping a sign at each wall keeps the unfolded path running as
 * if the wall were not there. That is exact only while the tumble rate is
 * blind to direction, so the spreading law is only measured with the memory
 * off. Both halves of that are checked below: the unfolded walk against the
 * closed form, and the folded one failing.
 *
 * The second is a limit that is not reached and must not be assumed. ⟨r²⟩ =
 * 4Dt is the *late* behaviour; at a tenth of a run it is twenty times too
 * big. The check fits the crossover
 *
 *     ⟨r²⟩ = 2v²τ²(t/τ − 1 + e^(−t/τ))
 *
 * over three decades of t rather than waiting for a limit the dish is too
 * small to reach, and separately confirms that the asymptote alone fails.
 */

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/chemotaxis.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__chemo, null, { timeout: 20000 });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 1).join(''));

const K = await page.evaluate(() => window.__chemo.constants());
const set = (cfg) => page.evaluate((c) => window.__chemo.set(c), cfg);

/** A small table, printed so a reader of the log sees the numbers, not a verdict. */
function table(title, list) {
  if (!list.length) return;
  const keys = Object.keys(list[0]);
  const w = keys.map((k) => Math.max(k.length, ...list.map((r) => String(r[k]).length)));
  console.log(`\n  ${title}`);
  console.log('  ' + keys.map((k, i) => k.padStart(w[i])).join('  '));
  for (const r of list) console.log('  ' + keys.map((k, i) => String(r[k]).padStart(w[i])).join('  '));
  console.log('');
}

/** Least squares, done here rather than trusted from the page. */
function lsq(xs, ys) {
  const m = xs.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < m; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
  const inter = (sy - slope * sx) / m;
  let ssr = 0, sst = 0; const yb = sy / m;
  for (let i = 0; i < m; i++) {
    const p = slope * xs[i] + inter;
    ssr += (ys[i] - p) ** 2; sst += (ys[i] - yb) ** 2;
  }
  return { slope, inter, r2: 1 - ssr / sst };
}

const crossover = (v, tau, t) => 2 * v * v * tau * tau * (t / tau - 1 + Math.exp(-t / tau));

// ── the mechanism: a direction the cell never measured ──────────────────
/*
 * Sort every sub-step by the angle between the heading it was taken on and
 * the gradient, and count what fraction ended in a tumble. If the rule really
 * is "tumble less when things improve", that rate is λ₀(1 − k·cos θ): a
 * straight line whose intercept is 1/τ and whose slope carries k = βv/W.
 * The cell computes neither θ nor k.
 */
{
  const out = [];
  let worstL = 0, worstK = 0, worstR2 = 1;
  for (const [v, tau, beta] of [[60, 0.6, 2], [90, 0.6, 2], [60, 0.6, 3], [120, 0.4, 1]]) {
    /*
     * Eight short dishes rather than one long one. The gradient response is a
     * property of a cell in a uniform gradient, and a dish left running long
     * enough to gather good statistics is a dish whose cells have piled
     * against the far wall — where a reflection makes the concentration fall
     * while the cell is pointed up the ramp, and the fitted k comes back 6%
     * high. Each replicate is freshly scattered and stopped after ten
     * seconds, over which the population's centre moves about 50 px in a
     * 716 px dish, and the tallies from forty-eight of them are pooled. The
     * The estimator is unbiased — over six trials it sits 0.2% from the truth
     * — so the width below is set by how much walking is paid for, not by how
     * far the model is off. Twenty-four replicates gave a scatter of 1.4%,
     * which made a 4% bound three sigma and flagged two display-only defects
     * before it was paid for; forty-eight give 0.76%, and the bound tightens
     * to 3%.
     */
    const d = await page.evaluate(async (a) => {
      const steps = new Array(12).fill(0), sum = new Array(12).fill(0), tum = new Array(12).fill(0);
      let n = 0;
      for (let r = 0; r < 48; r++) {
        window.__chemo.set({ n: 800, v: a.v, tau: a.tau, beta: a.beta });
        window.__chemo.advance(1);
        window.__chemo.clearStats();
        const q = window.__chemo.advance(10);
        n = q.cosSteps.length;
        for (let i = 0; i < n; i++) { steps[i] += q.cosSteps[i]; sum[i] += q.cosSum[i]; tum[i] += q.cosTumbles[i]; }
      }
      return { cosSteps: steps.slice(0, n), cosSum: sum.slice(0, n), cosTumbles: tum.slice(0, n) };
    }, { v, tau, beta });
    const xs = [], ys = [];
    for (let i = 0; i < K.NCOS; i++) {
      if (d.cosSteps[i] < 500) continue;
      xs.push(d.cosSum[i] / d.cosSteps[i]);
      ys.push(d.cosTumbles[i] / d.cosSteps[i] / K.H_STEP);
    }
    const f = lsq(xs, ys);
    const kFit = -f.slope / f.inter;
    const kWant = beta * v / K.DISH.w;
    const eL = Math.abs(f.inter * tau - 1), eK = Math.abs(kFit / kWant - 1);
    worstL = Math.max(worstL, eL); worstK = Math.max(worstK, eK);
    worstR2 = Math.min(worstR2, f.r2);
    out.push({ v, tau, beta, 'λ₀ fitted': f.inter.toFixed(3), '1/τ': (1 / tau).toFixed(3),
               'k fitted': kFit.toFixed(4), 'k = βv/W': kWant.toFixed(4),
               'k err': (eK * 100).toFixed(1) + '%', 'r²': f.r2.toFixed(4) });
  }
  table('tumble rate against cos θ, from a cell that never computes an angle', out);
  chk('λ₀ from the fit is 1/τ, within 4%', worstL < 0.04, `worst ${(worstL * 100).toFixed(1)}%`);
  chk('the slope gives back k = βv/W, within 3%', worstK < 0.03, `worst ${(worstK * 100).toFixed(1)}%`);
  chk('the rate is straight in cos θ, r² > 0.98', worstR2 > 0.98, `worst ${worstR2.toFixed(4)}`);
}

/*
 * With no memory the rate must not depend on the heading at all: the fitted
 * k has to be zero, not merely small. Anything else would mean the dish is
 * biased by something other than the rule.
 */
{
  /*
   * |k| < 0.01 is a tenth of the smallest bias the page can be set to, so it
   * needs the walking to back it: the fitted k scatters by about 0.004 on
   * 36 000 cell-seconds, and 0.0025 on 96 000, which is what is pooled here.
   */
  const d = await page.evaluate(async () => {
    const steps = new Array(12).fill(0), sum = new Array(12).fill(0), tum = new Array(12).fill(0);
    let n = 0;
    for (let r = 0; r < 8; r++) {
      window.__chemo.set({ n: 600, v: 60, tau: 0.6, beta: 0 });
      window.__chemo.advance(1);
      window.__chemo.clearStats();
      const q = window.__chemo.advance(20);
      n = q.cosSteps.length;
      for (let i = 0; i < n; i++) { steps[i] += q.cosSteps[i]; sum[i] += q.cosSum[i]; tum[i] += q.cosTumbles[i]; }
    }
    return { cosSteps: steps.slice(0, n), cosSum: sum.slice(0, n), cosTumbles: tum.slice(0, n) };
  });
  const xs = [], ys = [];
  for (let i = 0; i < K.NCOS; i++) {
    if (d.cosSteps[i] < 500) continue;
    xs.push(d.cosSum[i] / d.cosSteps[i]);
    ys.push(d.cosTumbles[i] / d.cosSteps[i] / K.H_STEP);
  }
  const f = lsq(xs, ys);
  const kFit = Math.abs(-f.slope / f.inter);
  chk('with the memory off the tumble rate is flat in cos θ, |k| < 0.01',
      kFit < 0.01, `|k| = ${kFit.toFixed(4)}`);
}

// ── spreading: the crossover, not one of its limits ─────────────────────
/*
 * ⟨r²⟩ over three and a half decades of t against 2v²τ²(t/τ − 1 + e^(−t/τ)).
 *
 * Sixteen dishes are stepped once to sixty seconds and read at nine points
 * along the way, rather than sixteen dishes per point: the points are then
 * correlated, which costs nothing for a per-point tolerance, and the sixty
 * seconds of walking pays for all nine instead of one. The elapsed time is
 * taken from the page rather than assumed — advance() rounds to a whole
 * number of sub-steps, and at t = 0.02 s that rounding alone is a 30% error
 * in t².
 */
{
  const v = 60, tau = 0.6, D = v * v * tau / 2;
  const marks = [0.025, 0.05, 0.2, 0.6, 2, 6, 20, 60];
  const got = await page.evaluate(async (a) => {
    const sum = a.marks.map(() => ({ t: 0, r2: 0, folded: 0 }));
    for (let r = 0; r < a.reps; r++) {
      window.__chemo.set({ n: 600, v: a.v, tau: a.tau, beta: 0 });
      let at = 0;
      a.marks.forEach((m, i) => {
        const d = window.__chemo.advance(m - at);
        at = m;
        sum[i].t += d.t; sum[i].r2 += d.msd; sum[i].folded += d.msdFolded;
      });
    }
    return sum.map((q) => ({ t: q.t / a.reps, r2: q.r2 / a.reps, folded: q.folded / a.reps }));
  }, { v, tau, marks, reps: 16 });

  const out = [];
  let worst = 0, worstBallistic = 0, worstDiffusive = 0;
  for (const g of got) {
    const want = crossover(v, tau, g.t);
    const err = Math.abs(g.r2 / want - 1);
    worst = Math.max(worst, err);
    if (g.t / tau <= 0.1) worstBallistic = Math.max(worstBallistic, Math.abs(g.r2 / (v * v * g.t * g.t) - 1));
    if (g.t / tau >= 100) worstDiffusive = Math.max(worstDiffusive, Math.abs(g.r2 / (4 * D * g.t) - 1));
    out.push({ 't (s)': g.t.toFixed(4), 't/τ': (g.t / tau).toFixed(2),
               '⟨r²⟩ unfolded': g.r2.toFixed(0), crossover: want.toFixed(0),
               'v²t²': (v * v * g.t * g.t).toFixed(0), '4Dt': (4 * D * g.t).toFixed(0),
               'folded': g.folded.toFixed(0), err: (err * 100).toFixed(1) + '%' });
  }
  table('⟨r²⟩ against the crossover, one run read at nine points', out);
  chk('⟨r²⟩ tracks 2v²τ²(t/τ − 1 + e^(−t/τ)) to 5% over 2400× in t',
      worst < 0.05, `worst ${(worst * 100).toFixed(1)}%`);
  /*
   * Only below a tenth of a run. At a third of one the ballistic limit is
   * already 10% high — that is the crossover doing its job, not noise, and a
   * check spanning it would be checking a claim that is false there.
   */
  chk('below a tenth of a run it is ballistic, ⟨r²⟩ = v²t² to 4%',
      worstBallistic < 0.04, `worst ${(worstBallistic * 100).toFixed(1)}%`);
  chk('past a hundred runs it is diffusive, ⟨r²⟩ = 4Dt with D = v²τ/2 to 6%',
      worstDiffusive < 0.06, `worst ${(worstDiffusive * 100).toFixed(1)}%`);

  /*
   * The unfolding has to be doing work, or it is decoration. The same walk
   * measured between the walls is on the same rows above: by sixty seconds it
   * has stalled near the ceiling a fully mixed dish would give, (W²+H²)/6,
   * while the unfolded one is still climbing.
   */
  const last = got[got.length - 1];
  const mixed = (K.DISH.w ** 2 + K.DISH.h ** 2) / 6;
  chk('measured between the walls the walk has stalled at the fully mixed ceiling',
      last.folded < 1.05 * mixed && last.folded > 0.6 * mixed,
      `folded ${last.folded.toFixed(0)}, ceiling ${mixed.toFixed(0)}`);
  chk('which is under a third of the truth, so the unfolding is not decoration',
      last.folded < 0.33 * crossover(v, tau, last.t),
      `${(100 * last.folded / crossover(v, tau, last.t)).toFixed(0)}% of ${crossover(v, tau, last.t).toFixed(0)}`);
}

/*
 * Four times as long again. The unfolded walk quadruples, as a diffusive walk
 * must; the folded one barely moves, because there is nowhere left for it to
 * go. That is the saturation stated as a rate rather than as a single number,
 * and because both numbers come off the same cells the ratio is far steadier
 * than either of them alone.
 */
{
  const v = 60, tau = 0.6;
  const g = await page.evaluate(async (a) => {
    const at = [{ r2: 0, folded: 0 }, { r2: 0, folded: 0 }];
    for (let r = 0; r < 6; r++) {
      window.__chemo.set({ n: 600, v: a.v, tau: a.tau, beta: 0 });
      let d = window.__chemo.advance(60);
      at[0].r2 += d.msd; at[0].folded += d.msdFolded;
      d = window.__chemo.advance(180);
      at[1].r2 += d.msd; at[1].folded += d.msdFolded;
    }
    return at.map((q) => ({ r2: q.r2 / 6, folded: q.folded / 6 }));
  }, { v, tau });
  const grewU = g[1].r2 / g[0].r2, grewF = g[1].folded / g[0].folded;
  table('sixty seconds against two hundred and forty', [
    { at: '60 s', unfolded: g[0].r2.toFixed(0), folded: g[0].folded.toFixed(0) },
    { at: '240 s', unfolded: g[1].r2.toFixed(0), folded: g[1].folded.toFixed(0) },
    { at: 'grew by', unfolded: grewU.toFixed(2) + '×', folded: grewF.toFixed(2) + '×' },
  ]);
  chk('the unfolded walk quadruples over four times the time — it is still diffusing',
      grewU > 3.5, `${grewU.toFixed(2)}×`);
  chk('the folded one grows by under a factor of 1.7 — it is running out of dish',
      grewF < 1.7, `${grewF.toFixed(2)}× against ${grewU.toFixed(2)}×`);
}

/*
 * And where the folded walk stops. Run the swimmers at the top of the slider,
 * where a cell crosses the dish diffusively in 87 s rather than 475, so that
 * two minutes leaves it thoroughly mixed; then the folded displacement has to
 * be the one two independent uniform draws give, (W² + H²)/6.
 *
 * Sixteen dishes of six hundred, because (x₁ − x₀)² has a coefficient of
 * variation of about 1.06 — four dishes of three hundred put this at three
 * per cent scatter against a four per cent bound, and it flagged two
 * display-only defects before the statistics were paid for.
 */
{
  const mixed = (K.DISH.w ** 2 + K.DISH.h ** 2) / 6;
  const folded = await page.evaluate(async () => {
    let f = 0;
    for (let r = 0; r < 16; r++) {
      window.__chemo.set({ n: 600, v: 140, tau: 0.6, beta: 0 });
      f += window.__chemo.advance(120).msdFolded;
    }
    return f / 16;
  });
  chk('a thoroughly mixed dish gives the folded walk exactly (W²+H²)/6, within 4%',
      Math.abs(folded / mixed - 1) < 0.04, `${folded.toFixed(0)} vs ${mixed.toFixed(0)}`);
}

/*
 * And the limit that is not reached: at a tenth of a run, 4Dt overstates the
 * spreading more than tenfold. This is the check that stops the asymptote
 * from being quietly substituted for the crossover.
 */
{
  const v = 60, tau = 0.6, D = v * v * tau / 2;
  const d = await page.evaluate(async (a) => {
    let s = 0, t = 0;
    for (let r = 0; r < 4; r++) {
      window.__chemo.set({ n: 600, v: a.v, tau: a.tau, beta: 0 });
      const q = window.__chemo.advance(0.06);
      s += q.msd; t += q.t;
    }
    return { r2: s / 4, t: t / 4 };
  }, { v, tau });
  const ratio = 4 * D * d.t / d.r2;
  chk('at a tenth of a run the diffusive limit alone overstates ⟨r²⟩ more than tenfold',
      ratio > 10, `4Dt is ${ratio.toFixed(1)}× the measurement`);
}

// ── the pile-up ─────────────────────────────────────────────────────────
/*
 * Let the dish settle, then read the histogram it produced. Drift up the
 * gradient against spreading back down gives an exponential whose length is
 * ℓ = D/v_d, with v_d = (v/k)(1 − √(1 − k²)). Both D and v_d come from the
 * closed forms; ℓ is fitted from the bars.
 */
async function profile(v, tau, beta, settle, sample) {
  const d = await page.evaluate(async (a) => {
    window.__chemo.set({ n: 500, v: a.v, tau: a.tau, beta: a.beta });
    window.__chemo.advance(a.settle);
    window.__chemo.clearStats();
    window.__chemo.advance(a.sample);
    return window.__chemo.read();
  }, { v, tau, beta, settle, sample });
  const xs = [], ys = [];
  for (let i = 0; i < K.NBIN; i++) {
    if (d.profile[i] < 1) continue;
    xs.push(K.DISH.w * (i + 0.5) / K.NBIN);
    ys.push(Math.log(d.profile[i] / d.profN));
  }
  const f = lsq(xs, ys);
  return { l: 1 / f.slope, r2: f.r2, want: d.l, D: d.D, drift: d.drift, k: d.k };
}

{
  const out = [];
  let worst = 0, worstR2 = 1;
  for (const [v, tau, beta] of [[60, 0.6, 2], [60, 0.6, 3], [90, 0.6, 2], [60, 1.0, 2]]) {
    // Settle for several traversal times, then average for as long again.
    const p0 = await page.evaluate((a) => window.__chemo.predict(a.v, a.tau, a.beta), { v, tau, beta });
    const settle = Math.min(500, 5 * 716 / p0.drift);
    const r = await profile(v, tau, beta, settle, Math.min(900, 2 * settle));
    const err = Math.abs(r.l / r.want - 1);
    worst = Math.max(worst, err); worstR2 = Math.min(worstR2, r.r2);
    out.push({ v, tau, beta, k: r.k.toFixed(3), D: r.D.toFixed(0),
               'v_d': r.drift.toFixed(2), 'ℓ = D/v_d': r.want.toFixed(0),
               'ℓ fitted': r.l.toFixed(0), err: (err * 100).toFixed(1) + '%',
               'r²': r.r2.toFixed(4) });
  }
  table('the steady pile-up, fitted off the histogram', out);
  chk('the settled population is exponential in x, r² > 0.99', worstR2 > 0.99, `worst ${worstR2.toFixed(4)}`);
  chk('its length is D/v_d with v_d = (v/k)(1 − √(1−k²)), within 9%',
      worst < 0.09, `worst ${(worst * 100).toFixed(1)}%`);
}

/*
 * ℓ = D/v_d works out to τW/β, which contains no v. Triple the swimming
 * speed and the cluster must be the same width — the faster cell drifts nine
 * times harder and spreads nine times harder, and the ratio does not move.
 * A page that had drift without the matching spreading would fail this.
 */
{
  const out = [];
  const ls = [];
  for (const v of [40, 80, 120]) {
    const p0 = await page.evaluate((a) => window.__chemo.predict(a.v, 0.6, 2), { v });
    const settle = Math.min(500, 5 * 716 / p0.drift);
    const r = await profile(v, 0.6, 2, settle, Math.min(900, 2 * settle));
    ls.push(r.l);
    out.push({ v, 'D = v²τ/2': r.D.toFixed(0), 'v_d': r.drift.toFixed(2),
               'τW/β': (0.6 * K.DISH.w / 2).toFixed(0), 'ℓ fitted': r.l.toFixed(0) });
  }
  table('the same pile-up at three swimming speeds', out);
  const spread = (Math.max(...ls) - Math.min(...ls)) / (ls.reduce((a, b) => a + b, 0) / ls.length);
  chk('tripling the swimming speed does not change ℓ, spread under 12%',
      spread < 0.12, `${ls.map((x) => x.toFixed(0)).join(', ')} — spread ${(spread * 100).toFixed(1)}%`);
  const want = 0.6 * K.DISH.w / 2;
  const worst = Math.max(...ls.map((l) => Math.abs(l / want - 1)));
  chk('and all three sit on τW/β, within 10%', worst < 0.10, `worst ${(worst * 100).toFixed(1)}%`);
}

/*
 * With no memory there is no pile-up: the dish must stay flat. Not "nearly
 * flat as a formality" — reflecting walls of this kind add no accumulation of
 * their own, so a slope here would be a real bug.
 */
{
  /*
   * How many independent looks the histogram is worth is n_cells × T / (W²/D),
   * because a cell only tells you something new about where it is once it has
   * had time to cross the dish. At the default speed that is one look per
   * cell per 475 s, which makes |W/ℓ| < 0.15 a one-sigma bound — it passed
   * three runs and then flagged a display-only defect, which is a flake, not
   * a catch. The swimmers are therefore run at the top of the slider, where
   * D is 5880 and a look costs 87 s, and two dishes are pooled: about 12 000
   * looks, and the bound becomes five sigma.
   */
  const both = { prof: new Array(K.NBIN).fill(0), n: 0 };
  for (let dish = 0; dish < 2; dish++) {
    const d = await page.evaluate(async () => {
      window.__chemo.set({ n: 600, v: 140, tau: 0.6, beta: 0 });
      window.__chemo.advance(30);
      window.__chemo.clearStats();
      window.__chemo.advance(900);
      return window.__chemo.read();
    });
    for (let i = 0; i < K.NBIN; i++) both.prof[i] += d.profile[i];
    both.n += d.profN;
  }
  const xs = [], ys = [];
  let mass = 0, mx = 0;
  for (let i = 0; i < K.NBIN; i++) {
    const x = K.DISH.w * (i + 0.5) / K.NBIN;
    mass += both.prof[i]; mx += both.prof[i] * x;
    if (both.prof[i] < 1) continue;
    xs.push(x); ys.push(Math.log(both.prof[i] / both.n));
  }
  const f = lsq(xs, ys);
  chk('with the memory off the dish stays flat: |W/ℓ| < 0.15',
      Math.abs(K.DISH.w * f.slope) < 0.15, `W/ℓ = ${(K.DISH.w * f.slope).toFixed(3)}`);
  chk('and the population sits in the middle of the dish, within 2%',
      Math.abs(mx / mass / K.DISH.w - 0.5) < 0.02,
      `mean x = ${(mx / mass / K.DISH.w).toFixed(4)} of the width`);
}

// ── the page tells the reader the same numbers ──────────────────────────
{
  /*
   * Settle first. The bars are an average over everything since the reset, so
   * reading the fitted ℓ off a dish that started uniform two minutes ago gets
   * 354 against a predicted 213 — and the fault is the reading, not the page,
   * which needs several trips across the dish at v_d = 10.4 px/s before the
   * population has arranged itself.
   */
  await set({ n: 400, v: 60, tau: 0.6, beta: 4 });
  await page.evaluate(() => {
    window.__chemo.advance(400);
    window.__chemo.clearStats();
    window.__chemo.advance(400);
  });
  const shown = await page.evaluate(() => ({
    k: document.getElementById('out-k').textContent,
    d: document.getElementById('out-d').textContent,
    l: document.getElementById('out-l').textContent,
    lfit: document.getElementById('out-lfit').textContent,
    state: document.getElementById('out-state').textContent,
  }));
  const truth = await page.evaluate(() => window.__chemo.read());
  chk('the panel shows k as βv/W', Math.abs(parseFloat(shown.k) / 100 - truth.k) < 0.002, shown.k);
  chk('the panel shows D = v²τ/2', Math.abs(parseFloat(shown.d) - truth.D) < 1, shown.d);
  chk('the panel shows ℓ = D/v_d', Math.abs(parseFloat(shown.l) - truth.l) < 1, shown.l);
  chk('the panel shows a fitted ℓ within 15% of it',
      Math.abs(parseFloat(shown.lfit) / truth.l - 1) < 0.15, `${shown.lfit} vs ${truth.l.toFixed(0)}`);
  chk('the panel names the state', shown.state.length > 3, shown.state);
}

{
  await set({ n: 300, v: 60, tau: 0.6, beta: 0 });
  const shown = await page.evaluate(() => document.getElementById('out-l').textContent);
  chk('with the memory off the panel says the length is infinite', shown === '∞', shown);
}

// ── the mean run really is τ ────────────────────────────────────────────
{
  const out = [];
  let worst = 0;
  for (const tau of [0.3, 0.6, 1.2]) {
    const d = await page.evaluate(async (a) => {
      window.__chemo.set({ n: 400, v: 60, tau: a.tau, beta: 0 });
      window.__chemo.advance(60);
      return window.__chemo.read();
    }, { tau });
    const err = Math.abs(d.meanRun / tau - 1);
    worst = Math.max(worst, err);
    out.push({ 'τ set': tau, 'mean run measured': d.meanRun.toFixed(4),
               err: (err * 100).toFixed(1) + '%' });
  }
  table('the run length the dish actually produces', out);
  chk('runs last τ on average, within 4%', worst < 0.04, `worst ${(worst * 100).toFixed(1)}%`);
}

chk('no console errors during the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

await ctx.close();
await finish('chemotaxis');
