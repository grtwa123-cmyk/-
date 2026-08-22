import { browser, chk, rows, BASE, finish } from '../lib/harness.mjs';

/*
 * Diffusion across a membrane.
 *
 * The page's rule is one line: every sub-step, each walker moves a fixed
 * distance in a uniformly random direction. Nothing in it knows where the
 * crowd is. So everything below is a measurement of what that rule produces,
 * and none of the four results it produces is written down anywhere in the
 * file.
 *
 * The fifth thing checked here is the one that turned out *not* to be true,
 * and it is worth as much as the four that are. The plan for this page said
 * the flow would be proportional to the size of the hole. It is not: eight
 * times the opening gives about three times the flow, because in two
 * dimensions a walker that misses the hole slides along the wall and tries
 * again, so what limits the traffic is finding the hole rather than fitting
 * through it. The proportionality was withdrawn before the page was written
 * and what replaced it is the sub-linearity, which is checked below with the
 * numbers that killed the original claim.
 */

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/diffusion.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__diffusion, null, { timeout: 20000 });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 1).join(''));

const set = (cfg) => page.evaluate((c) => window.__diffusion.set(c), cfg);
const K = await page.evaluate(() => window.__diffusion.constants());

/*
 * The net flow at a fixed imbalance, by replicates. Not by one long run: the
 * quantity being varied is the imbalance itself, and a window long enough to
 * gather good statistics is long enough for the imbalance to move. Each
 * replicate is freshly seeded and short, and the tallies are pooled.
 */
async function flux(cfg, secs, reps) {
  return page.evaluate(async (a) => {
    let lr = 0, rl = 0;
    for (let r = 0; r < a.reps; r++) {
      window.__diffusion.set(a.cfg);
      const q = window.__diffusion.advance(a.secs);
      lr += q.lr; rl += q.rl;
    }
    const t = a.reps * a.secs;
    return { out: lr / t, back: rl / t, net: (lr - rl) / t };
  }, { cfg, secs, reps });
}

// ── the walk itself: ⟨r²⟩ = 4Dt with D = L²/4h ───────────────────────────
{
  const rowsOut = [];
  let worst = 0;
  for (const step of [5, 9, 14]) {
    // Gather everyone at one point in an open box, then let them spread. The
    // hole is opened to the full height so the membrane is not in the way.
    /*
     * A fixed number of sub-steps rather than a fixed time, and a small
     * number of them. ⟨r²⟩ = 4Dt is free diffusion, and it stops being true
     * the moment the walls are felt: measured over three quarters of a
     * second the longest step reached an r_rms of 133 in a box only 125
     * from the middle to the top, reflected off it, and came back 22% low.
     * Twenty steps keeps the cloud well inside the box at every step size.
     */
    /*
     * Ten dishes, pooled. ⟨r²⟩ = mL² is exact for a walk of m fixed steps in
     * random directions — the cross terms vanish — so there is no bias here
     * at all, only sampling noise, and r² has a coefficient of variation of
     * about one. Eight hundred walkers in a single dish is therefore a 3.5%
     * standard error against an 8% bound, worst of three step sizes: it
     * failed one CI run in ten. Eight thousand walkers make it 1.1%, and the
     * bound tightens to 5%.
     */
    const got = await page.evaluate(async (a) => {
      const h = window.__diffusion.constants().H_STEP;
      const sum = [0, 0, 0, 0];
      const at = [0, 0, 0, 0];
      for (let r = 0; r < 10; r++) {
        window.__diffusion.set({ n: 800, share: 100, poreH: 320, pores: 1, step: a.step });
        window.__diffusion.gather();
        for (let i = 0; i < 4; i++) {
          const q = window.__diffusion.advance(5 * h);
          sum[i] += q.r2; at[i] = q.t;
        }
      }
      return sum.map((v, i) => ({ t: at[i], r2: v / 10, D: v / 10 / (4 * at[i]) }));
    }, { step });
    const want = step * step / (4 * K.H_STEP);
    for (const g of got) worst = Math.max(worst, Math.abs(g.D / want - 1));
    rowsOut.push(`L=${step}: ${got[got.length - 1].D.toFixed(0)} vs ${want.toFixed(0)}`);
  }
  chk('the walk spreads as ⟨r²⟩ = 4Dt, and D is the L²/4h its own step size implies',
      worst < 0.05, rowsOut.join('  ') + `  — worst ${(worst * 100).toFixed(1)}%`);
}

// ── Fick: the net flow is proportional to the difference ─────────────────
{
  /*
   * Two hundred and fifty short replicates per point, not twenty-four. The
   * net is the difference of two large Poisson tallies, so its noise is
   * √(2·gross/T): at ΔN = 0 the traffic is about 27 a second each way and
   * twenty-four replicates of 1.2 s leave a standard error near 0.9/s
   * against a bound of 1.1/s. That is a one-sigma bound and it failed four
   * of thirty local runs. Ten times the replicates put the error at 0.28/s
   * and the same bound at four sigma — the window stays short, because the
   * quantity being varied is the imbalance and a long window lets it move.
   */
  const pts = [];
  for (const share of [100, 85, 70, 55, 50]) {
    const f = await flux({ n: 400, share, poreH: 60, pores: 1, step: 9 }, 1.2, 250);
    const dN = Math.round(400 * (share / 100) - 400 * (1 - share / 100));
    pts.push({ dN, ...f });
  }
  let sxy = 0, sxx = 0;
  for (const p of pts) { sxy += p.dN * p.net; sxx += p.dN * p.dN; }
  const slope = sxy / sxx;
  // The noise on a net is the noise on two large gross tallies, so judge the
  // fit on the scale of the largest point rather than of each one.
  const big = Math.max(...pts.map((p) => Math.abs(slope * p.dN)));
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, Math.abs(p.net - slope * p.dN) / big);
  chk('the net flow is a straight line through the origin in ΔN — Fick\'s first law',
      worst < 0.15,
      pts.map((p) => `Δ${p.dN}: ${p.net.toFixed(2)}/s`).join('  ') + `  slope ${slope.toFixed(4)}`);

  const even = pts[pts.length - 1];
  chk('and with the sides already equal there is no net flow at all',
      Math.abs(even.net) < 0.1 * Math.abs(pts[0].net),
      `${even.net.toFixed(2)}/s at ΔN = 0 against ${pts[0].net.toFixed(2)}/s at ΔN = 400`);
}

// ── the point of the whole page: gross traffic, small net ────────────────
{
  const f = await flux({ n: 400, share: 100, poreH: 60, pores: 1, step: 9 }, 1.2, 30);
  chk('at full imbalance the traffic is heavy in both directions, not one',
      f.back > 0.5 * f.out && f.out > 10,
      `${f.out.toFixed(1)}/s out, ${f.back.toFixed(1)}/s back`);
  chk('and the flow is the small difference between them, not a current',
      f.net < 0.45 * f.out,
      `net ${f.net.toFixed(2)}/s is ${(100 * f.net / f.out).toFixed(0)}% of the outward traffic`);
}

// ── the gap closes, and closes exponentially ─────────────────────────────
{
  /*
   * Averaged over eighteen runs of eight hundred. One run's ΔN carries a
   * noise of order √N, which near the end of the decay is a good fraction of
   * what is left of the signal, and the averaging is not there to make the
   * bar easier — it is there because one run does not have the evidence in
   * it. How much averaging is not a matter of taste either; it can be worked
   * out. The residual in ln ΔN at a point where the gap is ΔN is √(n/R)/ΔN,
   * the sum over the fitted points is dominated by the last few and comes to
   * about (n/R)·10/c² with a cut at c, and against a total sum of squares of
   * N·(ln(n/c))²/12 that gives
   *
   *     four runs of six hundred    1 − r² ≈ 0.019
   *     eighteen runs of eight      1 − r² ≈ 0.003
   *
   * The first of those is a bound of 0.985 sitting on top of its own noise:
   * it failed two runs in six here, on a page nothing had touched. Raising
   * the cut does not help — the fitted range shrinks with it and the ratio
   * barely moves — and neither does sampling more often, for the same
   * reason. Only walkers and replicates move it, and they move it as 1/nR.
   */
  const series = await page.evaluate(() => {
    const runs = [];
    for (let r = 0; r < 18; r++) {
      window.__diffusion.set({ n: 800, share: 100, poreH: 60, pores: 1, step: 9 });
      const one = [];
      for (let i = 0; i < 40; i++) {
        const q = window.__diffusion.advance(2);
        one.push([q.t, q.left - q.right]);
      }
      runs.push(one);
    }
    return runs[0].map((_, i) => [runs[0][i][0],
      runs.reduce((s, one) => s + one[i][1], 0) / runs.length]);
  });
  let falls = true;
  for (let i = 1; i < series.length; i++) if (series[i][1] > series[i - 1][1] + 30) falls = false;
  chk('the gap closes and keeps closing', falls && series[series.length - 1][1] < series[0][1] * 0.5,
      `ΔN ${series[0][1].toFixed(0)} → ${series[series.length - 1][1].toFixed(0)}`
      + ` over ${series[series.length - 1][0].toFixed(0)} s`);

  // ln ΔN against t, over the range where the gap is still bigger than its
  // own noise.
  const xs = [], ys = [];
  for (const [t, d] of series) { if (d < 80) break; xs.push(t); ys.push(Math.log(d)); }
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += xs[i] * ys[i]; sxx += xs[i] ** 2; syy += ys[i] ** 2; }
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  const tau = -1 / ((n * sxy - sx * sy) / (n * sxx - sx * sx));
  chk('and it closes exponentially — the log of the gap falls in a straight line',
      n >= 8 && r * r > 0.995, `r² = ${(r * r).toFixed(4)} over ${n} points, τ = ${tau.toFixed(1)} s`);
}

// ── a sealed wall passes nothing ─────────────────────────────────────────
{
  await set({ n: 400, share: 100, poreH: 0, pores: 1, step: 9 });
  const q = await page.evaluate(() => window.__diffusion.advance(20));
  chk('a wall with no hole in it passes nothing at all, however long you wait',
      q.right === 0 && q.lr === 0 && q.rl === 0,
      `${q.right} on the right after ${q.t.toFixed(0)} s, ${q.lr + q.rl} crossings`);
  chk('and the panel says so rather than showing a stalled experiment',
      /sealed|밀폐|密封/i.test(q.shownState), q.shownState);
}

// ── a bigger hole passes more, but not in proportion ─────────────────────
{
  const out = [];
  for (const poreH of [20, 40, 80, 160]) {
    const f = await flux({ n: 400, share: 100, poreH, pores: 1, step: 9 }, 1.2, 24);
    out.push({ poreH, net: f.net });
  }
  let rises = true;
  for (let i = 1; i < out.length; i++) if (out[i].net <= out[i - 1].net) rises = false;
  chk('a bigger hole passes more', rises,
      out.map((o) => `${o.poreH}: ${o.net.toFixed(2)}/s`).join('  '));

  const holeRatio = out[3].poreH / out[0].poreH;          // 8
  const flowRatio = out[3].net / out[0].net;
  chk('but not in proportion — eight times the opening is nowhere near eight times the flow',
      flowRatio > 1.8 && flowRatio < 5,
      `×${holeRatio} the hole gives ×${flowRatio.toFixed(2)} the flow`);
}

// ── chrome ───────────────────────────────────────────────────────────────
{
  const title = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await title();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await title();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await title();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns',
      en !== ko && ko !== zh && (await title()) === en, `${en} / ${ko} / ${zh}`);

  const missing = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', missing.length === 0, missing.slice(0, 4).join(', '));

  chk('the page badges itself measured',
      await page.locator('.method-tag[data-method="measured"]').count() === 1);
}

chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const w of [320, 390, 768]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(180);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
}

console.log('=== diffusion ===');
let f = 0;
for (const r of rows) { if (!r.ok) f++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.n}${r.ok || !r.d ? '' : '  ::  ' + r.d}`); }
console.log(`\n${rows.length - f}/${rows.length} passed`);
await finish('diffusion');
process.exit(f ? 1 : 0);
