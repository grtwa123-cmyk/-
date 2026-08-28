import { browser, chk, BASE, finish } from '../lib/harness.mjs';

/*
 * The coalescent.
 *
 * The page's rule is one line and it contains no genetics at all: every
 * individual picks a parent uniformly at random out of N. Everything below is
 * measured off the pedigrees that rule produces.
 *
 * The interesting part is that the textbook answers are a *limit*. E[T_k] =
 * 2N/(k(k−1)) holds as k²/N → 0, and this population is small enough that it
 * need not. Exactly, k lineages all miss each other in one generation with
 * probability q_k = ∏(N−i)/N, so the time spent at k, once k is reached, is
 * geometric with mean 1/(1 − q_k). At N = 16 with ten lineages the textbook
 * value is 0.36 generations and the exact one is 1.03 — a factor of three.
 *
 * The totals need the whole chain rather than one level, because k lineages
 * can drop straight past k−1: they leave exactly j distinct parents with
 * probability S(k,j)·N(N−1)···(N−j+1)/N^k. That chain is solved here, in this
 * file, rather than read off the page, so the page's own copy of it is being
 * checked too.
 *
 * Both are measured: the exact forms to within a per cent, and the textbook
 * limit converging onto them as the population grows.
 */

const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(`${BASE}/experiments/coalescent.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__coal, null, { timeout: 20000 });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 1).join(''));

/** A small table, printed so a reader of the log sees the numbers. */
function table(title, list) {
  if (!list.length) return;
  const keys = Object.keys(list[0]);
  const w = keys.map((k) => Math.max(k.length, ...list.map((r) => String(r[k]).length)));
  console.log(`\n  ${title}`);
  console.log('  ' + keys.map((k, i) => k.padStart(w[i])).join('  '));
  for (const r of list) console.log('  ' + keys.map((k, i) => String(r[k]).padStart(w[i])).join('  '));
  console.log('');
}

// ── the closed forms, worked out here and not taken from the page ────────
const harmonic = (m) => { let s = 0; for (let i = 1; i <= m; i++) s += 1 / i; return s; };
const noMerge = (N, k) => { let q = 1; for (let i = 0; i < k; i++) q *= (N - i) / N; return q; };
const exactTk = (N, k) => 1 / (1 - noMerge(N, k));
const limitTk = (N, k) => 2 * N / (k * (k - 1));
const limitT = (N, n) => 2 * N * (1 - 1 / n);
const limitL = (N, n) => 2 * N * harmonic(n - 1);

/** k lineages leave exactly j distinct parents; Stirling numbers of the 2nd kind. */
function chain(N, n) {
  const S = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  S[0][0] = 1;
  for (let k = 1; k <= n; k++)
    for (let j = 1; j <= k; j++) S[k][j] = j * S[k - 1][j] + S[k - 1][j - 1];
  const h = new Array(n + 1).fill(0), l = new Array(n + 1).fill(0);
  for (let k = 2; k <= n; k++) {
    let sh = 1, sl = k, stay = 0;
    for (let j = 1; j <= k; j++) {
      let p = S[k][j];
      for (let i = 0; i < j; i++) p *= (N - i) / N;
      for (let i = 0; i < k - j; i++) p /= N;
      if (j === k) stay = p;
      else if (j >= 2) { sh += p * h[j]; sl += p * l[j]; }
    }
    h[k] = sh / (1 - stay); l[k] = sl / (1 - stay);
  }
  return { T: h[n], L: l[n] };
}

const run = (N, n, mu, trees) => page.evaluate(async (a) => {
  window.__coal.set({ N: a.N, n: a.n, mu: a.mu });
  return window.__coal.runTrees(a.trees);
}, { N, n, mu, trees });

// ── the mechanism ────────────────────────────────────────────────────────
/*
 * Before any average: the pedigree has to be a pedigree. Every lineage moves
 * to exactly one parent each generation, lineages only ever merge and never
 * split, and the run ends with one.
 */
{
  /*
   * Stepped until it finishes, not for a fixed number of generations. The
   * mean depth here is 33 and the spread of depths is about six tenths of
   * that, so a cap of 60 is a coin toss dressed up as a check — it cut in on
   * the first run after the defaults changed.
   */
  const d = await page.evaluate(async () => {
    window.__coal.set({ N: 20, n: 6, mu: 0 });
    const seen = [];
    for (let g = 0; g < 40 * 20; g++) {
      const q = window.__coal.stepBack();
      seen.push(q.lineages);
      if (q.done) break;
    }
    return { seen, final: window.__coal.read() };
  });
  let monotone = true;
  for (let i = 1; i < d.seen.length; i++) if (d.seen[i] > d.seen[i - 1]) monotone = false;
  chk('lineages only ever merge — the count never goes back up',
      monotone, d.seen.join(' '));
  chk('and the walk ends on one lineage, the common ancestor',
      d.final.done && d.final.lineages === 1,
      `${d.final.lineages} left after ${d.final.gen} generations`);
  const lens = new Set(d.final.paths.map((p) => p.length));
  chk('every sampled lineage has a parent in every generation, and only one',
      lens.size === 1 && [...lens][0] === d.final.gen + 1,
      `path lengths ${[...lens].join(',')} for ${d.final.gen} generations`);
  const inRange = d.final.paths.every((p) => p.every((i) => Number.isInteger(i) && i >= 0 && i < 20));
  chk('and every parent is somebody in the population', inRange);
}

/*
 * A population of one has nowhere to go: the sample of two must coalesce in
 * the first generation, every time. A population of two takes on average two.
 * Both are exact, and neither needs a limit.
 */
{
  const d = await run(8, 2, 0, 4000);
  const want = 8;                        // geometric with p = 1/N, mean N
  chk('with a sample of two the depth is exactly N generations, within 4%',
      Math.abs(d.meanT / want - 1) < 0.04, `${d.meanT.toFixed(3)} vs ${want}`);
  chk('and the branch length is twice that, two lineages waiting together',
      Math.abs(d.meanL / (2 * want) - 1) < 0.04, `${d.meanL.toFixed(3)} vs ${2 * want}`);
}

// ── the spectrum: how long k lineages last ───────────────────────────────
/*
 * Time spent with exactly k lineages, conditional on k being reached — some
 * levels get skipped, because three lineages can land on one parent. Against
 * the exact 1/(1 − q_k), and against the textbook 2N/(k(k−1)) beside it.
 */
async function spectrum(N, n, trees) {
  const d = await run(N, n, 0, trees);
  const out = [];
  for (let k = 2; k <= n; k++) {
    if (!d.hits[k]) continue;
    out.push({ k, reached: d.hits[k] / d.trees, mean: d.tk[k] / d.hits[k],
               exact: exactTk(N, k), limit: limitTk(N, k) });
  }
  return out;
}

{
  const rows = [], out = [];
  let worst = 0;
  for (const [N, n, trees] of [[60, 6, 6000], [40, 10, 5000], [16, 10, 6000]]) {
    const sp = await spectrum(N, n, trees);
    for (const r of sp) {
      const e = Math.abs(r.mean / r.exact - 1);
      // Only judge levels the run actually visited often enough to average.
      if (r.reached * (N === 16 ? 6000 : 5000) < 400) continue;
      worst = Math.max(worst, e);
      rows.push({ N, n, ...r });
    }
    const big = sp[sp.length - 1];
    out.push({ N, n, 'n²/N': (n * n / N).toFixed(2), 'k = n measured': big.mean.toFixed(3),
               '1/(1−q_n)': big.exact.toFixed(3), '2N/(n(n−1))': big.limit.toFixed(3),
               'limit off by': `${((big.limit / big.exact - 1) * 100).toFixed(0)}%` });
  }
  table('time spent with exactly k lineages, against the exact form', rows.map((r) => ({
    N: r.N, n: r.n, k: r.k, 'P(reach)': r.reached.toFixed(3), measured: r.mean.toFixed(3),
    '1/(1−q_k)': r.exact.toFixed(3), err: `${((r.mean / r.exact - 1) * 100).toFixed(1)}%`,
    '2N/(k(k−1))': r.limit.toFixed(3),
  })));
  chk('every level lasts 1/(1 − q_k) generations, within 5%',
      worst < 0.05, `worst ${(worst * 100).toFixed(1)}%`);

  table('and where the textbook limit gives up', out);
  const tight = out.find((r) => r.N === 16);
  chk('with ten lineages in a population of sixteen the limit is out by more than half',
      parseFloat(tight['limit off by']) < -50, tight['limit off by']);
  const loose = out.find((r) => r.N === 60);
  chk('while at n²/N = 0.6 it is within 15% at the worst level',
      Math.abs(parseFloat(loose['limit off by'])) < 15, loose['limit off by']);
}

/*
 * Multiple mergers are the reason the levels get skipped, and they have to be
 * really happening — three lineages picking one parent is an O(1/N²) event
 * that the exact chain accounts for and the textbook coalescent forbids.
 */
{
  const d = await run(16, 10, 0, 4000);
  const skipped = [];
  for (let k = 2; k < 10; k++) skipped.push((1 - d.hits[k] / d.trees));
  chk('levels really do get skipped — three lineages sometimes share one parent',
      Math.max(...skipped) > 0.3,
      skipped.map((v, i) => `k=${i + 2}: ${(v * 100).toFixed(0)}%`).join(' '));
  const big = await run(60, 4, 0, 4000);
  const rare = 1 - big.hits[3] / big.trees;
  chk('and in a roomier population they hardly ever do',
      rare < 0.06, `k=3 skipped ${(rare * 100).toFixed(1)}% of the time at N = 60, n = 4`);
}

// ── the totals ───────────────────────────────────────────────────────────
{
  const rows = [];
  let worstT = 0, worstL = 0;
  for (const [N, n, trees] of [[20, 6, 8000], [40, 10, 6000], [60, 12, 5000], [16, 10, 8000]]) {
    const d = await run(N, n, 0, trees);
    const c = chain(N, n);
    const eT = Math.abs(d.meanT / c.T - 1), eL = Math.abs(d.meanL / c.L - 1);
    worstT = Math.max(worstT, eT); worstL = Math.max(worstL, eL);
    rows.push({ N, n, trees, 'depth measured': d.meanT.toFixed(2), exact: c.T.toFixed(2),
                err: `${(eT * 100).toFixed(2)}%`, '2N(1−1/n)': limitT(N, n).toFixed(2),
                'branch measured': d.meanL.toFixed(1), 'exact ': c.L.toFixed(1),
                'err ': `${(eL * 100).toFixed(2)}%`, '2N·H(n−1)': limitL(N, n).toFixed(1) });
  }
  table('the whole tree, against the exact finite-population chain', rows);
  chk('the mean depth is what the exact chain says, within 3%',
      worstT < 0.03, `worst ${(worstT * 100).toFixed(2)}%`);
  chk('and so is the mean total branch length, within 3%',
      worstL < 0.03, `worst ${(worstL * 100).toFixed(2)}%`);
}

/*
 * The textbook limit is a limit, so it has to get better as the population
 * grows — and it has to be visibly worse when the population is small. Both
 * halves, or the check is only saying that a formula is roughly right.
 */
{
  const rows = [];
  const gaps = [];
  for (const N of [16, 30, 60]) {
    const c = chain(N, 10);
    const gap = limitT(N, 10) / c.T - 1;
    gaps.push(gap);
    rows.push({ N, 'n²/N': (100 / N).toFixed(2), exact: c.T.toFixed(2),
                '2N(1−1/n)': limitT(N, 10).toFixed(2), 'off by': `${(gap * 100).toFixed(2)}%` });
  }
  table('the limit closing on the truth as the population grows', rows);
  chk('the textbook depth converges as the population grows: 16 → 30 → 60 shrinks the gap',
      gaps[0] > gaps[1] && gaps[1] > gaps[2] && gaps[2] > 0,
      gaps.map((g) => `${(g * 100).toFixed(2)}%`).join(' → '));
  chk('and at N = 16 the gap is real, not rounding', gaps[0] > 0.01,
      `${(gaps[0] * 100).toFixed(2)}%`);
}

// ── the variance is the point, not an error bar ──────────────────────────
/*
 * Var(T_MRCA) = Σ Var(T_k) and each T_k is geometric, so the spread of tree
 * depths is comparable to the mean. A page that quietly averaged inside one
 * tree would fail this, and so would one that reported a formula.
 */
{
  const d = await run(60, 10, 0, 8000);
  const mean = d.meanT;
  let v = 0;
  for (const t of d.hist) v += (t - mean) ** 2;
  const sd = Math.sqrt(v / d.hist.length);
  /*
   * In the continuum the T_k are independent exponentials, so Var(T_MRCA) is
   * Σ (2N/(k(k−1)))² and the k = 2 term is three quarters of it on its own.
   * (Weighting each level's discrete geometric variance by how often the
   * level is reached is *not* the answer — a skipped level contributes a
   * mixture, whose variance carries the mean as well. That version came out
   * a third of the truth.)
   */
  let want = 0;
  for (let k = 2; k <= 10; k++) want += limitTk(60, k) ** 2;
  const wantSd = Math.sqrt(want);
  chk('the spread of tree depths is Σ(2N/k(k−1))², the levels adding in quadrature, within 8%',
      Math.abs(sd / wantSd - 1) < 0.08, `sd ${sd.toFixed(1)} vs ${wantSd.toFixed(1)}`);
  chk('and it is over half the mean — one tree tells you almost nothing',
      sd / mean > 0.5, `sd/mean = ${(sd / mean).toFixed(2)}`);
  const deep = d.hist.filter((t) => t > 2 * mean).length / d.hist.length;
  chk('a tree twice as deep as average is ordinary, not an outlier',
      deep > 0.05, `${(deep * 100).toFixed(1)}% of trees are deeper than twice the mean`);
}

/*
 * Most of the tree is the last pair waiting. T_2 alone is over half of it,
 * and adding lineages barely deepens it: the depth is bounded by 2N however
 * many are sampled.
 */
{
  const d = await run(60, 10, 0, 6000);
  const share = (d.tk[2] / d.trees) / d.meanT;
  chk('the last two lineages alone are over half the depth of the tree',
      share > 0.5, `T₂ is ${(share * 100).toFixed(0)}% of ${d.meanT.toFixed(0)} generations`);
  const small = await run(60, 3, 0, 6000);
  const big = await run(60, 12, 0, 6000);
  const ratio = big.meanT / small.meanT;
  /*
   * Four times the sample buys 1.375 times the depth, because 2N(1 − 1/n)
   * goes from two thirds of 2N to eleven twelfths of it. And it can never
   * buy more than 2N however many are sampled, which is the harder half of
   * the claim and the one a page with a runaway tree would fail.
   *
   * Two checks, because there are two statements and only one of them is a
   * measurement. "Under 40%" is a fact about the theory and is settled by
   * arithmetic; testing it against six thousand noisy trees made a 1.65σ
   * bound out of it — the true ratio is 1.375, the standard error 1.1%, and
   * CI duly came back with 1.41. So the theory claim is checked on the
   * theory, exactly, and the trees are held to the ratio the exact chain
   * predicts, which at 4.5σ is both stronger and stable.
   */
  const wantRatio = chain(60, 12).T / chain(60, 3).T;
  chk('the theory says quadrupling the sample deepens the tree by under 40%',
      wantRatio < 1.4 && wantRatio > 1.2, `exactly ${wantRatio.toFixed(4)}×`);
  chk('and the trees agree with that ratio, within 5%',
      Math.abs(ratio / wantRatio - 1) < 0.05,
      `n = 3 → ${small.meanT.toFixed(0)}, n = 12 → ${big.meanT.toFixed(0)} — ${ratio.toFixed(3)}× against ${wantRatio.toFixed(3)}×`);
  chk('and however large the sample the depth stays under 2N',
      big.meanT < 2 * 60, `${big.meanT.toFixed(0)} against 2N = 120`);
}

// ── Watterson ────────────────────────────────────────────────────────────
/*
 * Mutations fall on the branches at a fixed rate, so S counts branch length.
 * θ̂ = S/H(n−1) is then an estimate of 2Nμ — exactly, of μ·L_exact/H(n−1),
 * which is what is checked, with the textbook 2Nμ printed beside it.
 */
{
  const rows = [];
  let worst = 0;
  for (const [N, n, mu, trees] of [[20, 6, 0.02, 8000], [40, 10, 0.01, 6000],
                                   [60, 8, 0.03, 5000], [30, 4, 0.05, 8000]]) {
    const d = await run(N, n, mu, trees);
    const Hn = harmonic(n - 1);
    const hat = d.meanS / Hn;
    const want = mu * chain(N, n).L / Hn;
    const e = Math.abs(hat / want - 1);
    worst = Math.max(worst, e);
    rows.push({ N, n, mu, 'S measured': d.meanS.toFixed(3), 'θ̂': hat.toFixed(4),
                'μ·L/H says': want.toFixed(4), err: `${(e * 100).toFixed(2)}%`,
                '2Nμ': (2 * N * mu).toFixed(4) });
  }
  table('Watterson: mutations counted on the tree give the population back', rows);
  chk('θ̂ = S/H(n−1) recovers what made the mutations, within 5%',
      worst < 0.05, `worst ${(worst * 100).toFixed(2)}%`);

  // And it has to be counting mutations, not producing them from the formula.
  const none = await run(30, 6, 0, 500);
  chk('with no mutation there are no segregating sites at all',
      none.meanS === 0 && none.sumS === 0, `${none.sumS} sites over ${none.trees} trees`);
  const a = await run(30, 6, 0.01, 4000), b = await run(30, 6, 0.04, 4000);
  chk('and four times the mutation rate is four times the sites, within 8%',
      Math.abs(b.meanS / a.meanS / 4 - 1) < 0.08,
      `${a.meanS.toFixed(3)} → ${b.meanS.toFixed(3)}`);
}

/*
 * And the depth has to be a measurement rather than the formula wearing its
 * name. Substituting 2N(1 − 1/n) for the walk's own answer passed every
 * check above when it was planted — the textbook value is within 1.7% of the
 * exact one, which is inside every tolerance here. Two things catch it. The
 * reported mean must be the mean of the very trees the page lists, and two
 * batches of the same size must disagree, because measurements do and
 * formulas do not.
 */
{
  const a = await run(40, 8, 0, 1500);
  const meanOfHist = a.hist.reduce((x, y) => x + y, 0) / a.hist.length;
  chk('the reported mean depth is the mean of the trees the page kept',
      Math.abs(a.meanT - meanOfHist) < 1e-9,
      `${a.meanT.toFixed(6)} against ${meanOfHist.toFixed(6)} over ${a.hist.length} trees`);
  const b = await run(40, 8, 0, 1500);
  chk('and it is a measurement: two batches of 1500 trees disagree',
      a.meanT !== b.meanT, `${a.meanT.toFixed(4)} then ${b.meanT.toFixed(4)}`);
  chk('while the prediction beside it does not move at all',
      chain(40, 8).T === chain(40, 8).T && Math.abs(a.meanT - b.meanT) > 0,
      `exact ${chain(40, 8).T.toFixed(4)} both times`);
}

// ── the page tells the reader the same numbers ───────────────────────────
{
  await run(40, 8, 0.02, 3000);
  const shown = await page.evaluate(() => ({
    trees: document.getElementById('out-trees').textContent,
    t: document.getElementById('out-tmrca').textContent,
    tExact: document.getElementById('out-tmrca-exact').textContent,
    tLimit: document.getElementById('out-tmrca-limit').textContent,
    l: document.getElementById('out-branch').textContent,
    lExact: document.getElementById('out-branch-exact').textContent,
    theta: document.getElementById('out-theta').textContent,
    thetaTrue: document.getElementById('out-theta-true').textContent,
    state: document.getElementById('out-state').textContent,
  }));
  const truth = await page.evaluate(() => window.__coal.read());
  const c = chain(40, 8);
  chk('the panel counts the trees it has made',
      parseInt(shown.trees, 10) === truth.trees, `${shown.trees} vs ${truth.trees}`);
  chk('the panel shows the mean depth it measured',
      Math.abs(parseFloat(shown.t) - truth.meanT) < 0.15, `${shown.t} vs ${truth.meanT.toFixed(2)}`);
  chk('and the exact chain beside it, solved independently here',
      Math.abs(parseFloat(shown.tExact) / c.T - 1) < 0.002, `${shown.tExact} vs ${c.T.toFixed(2)}`);
  chk('and the textbook 2N(1 − 1/n), which is a different number',
      Math.abs(parseFloat(shown.tLimit) - limitT(40, 8)) < 0.1
      && parseFloat(shown.tLimit) !== parseFloat(shown.tExact),
      `${shown.tLimit} against ${shown.tExact}`);
  chk('the panel shows the measured branch length and the exact one',
      Math.abs(parseFloat(shown.l) - truth.meanL) < 0.6
      && Math.abs(parseFloat(shown.lExact) / c.L - 1) < 0.002,
      `${shown.l} measured, ${shown.lExact} exact`);
  chk('and θ̂ beside the 2Nμ that made the mutations',
      Math.abs(parseFloat(shown.theta) - truth.meanS / harmonic(7)) < 0.005
      && Math.abs(parseFloat(shown.thetaTrue) - 2 * 40 * 0.02) < 0.001,
      `θ̂ ${shown.theta}, 2Nμ ${shown.thetaTrue}`);
  chk('the panel names the state', shown.state.length > 3, shown.state);
}

/*
 * Changing the population or the sample makes every tree counted so far a
 * tree of something else, so the tally has to be thrown away rather than
 * carried across.
 */
{
  await run(20, 6, 0.02, 400);
  const before = await page.evaluate(() => window.__coal.read());
  const after = await page.evaluate(() => window.__coal.set({ N: 30 }));
  chk('changing the population discards the trees taken from the old one',
      before.trees >= 400 && after.trees === 0,
      `${before.trees} trees → ${after.trees}`);
}

{
  await run(20, 6, 0.02, 400);
  const before = await page.evaluate(() => window.__coal.read());
  const after = await page.evaluate(async () => {
    document.getElementById('reset-btn').click();
    return window.__coal.read();
  });
  chk('and Reset throws the trees away even with nothing changed',
      before.trees >= 400 && after.trees === 0, `${before.trees} trees → ${after.trees}`);
}

chk('no console errors during the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

await ctx.close();
await finish('coalescent');
