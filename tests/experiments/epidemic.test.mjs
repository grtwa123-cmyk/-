/*
 * The epidemic page, held against the two closed forms it is never told.
 *
 * The mechanism is small: individuals meet at random, a contact sometimes
 * transmits, an infection eventually ends. R₀ is not in it. What the page
 * reports is counted — transmissions divided by the infectious time that was
 * available to cause one, times the measured length of an infection — and the
 * final size and the peak then have to land on
 *
 *     r = 1 − e^(−R₀ r)          and          1 − (1 + ln R₀)/R₀
 *
 * neither of which appears in the simulation.
 *
 * The comparison is made at the MEASURED R₀, not at the one the sliders imply.
 * Using the sliders would be checking arithmetic; using the measurement asks
 * whether the population really behaved like a population with that R₀.
 *
 * Everything below runs headlessly through __epi.run, so a check is a whole
 * epidemic rather than a few seconds of animation — no wall-clock anywhere.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/epidemic.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);
const txt = (id) => page.evaluate((i) => document.getElementById(i)?.textContent.trim(), id);

/** Average several epidemics at one setting, keeping only the ones that took off. */
const sweep = (cases, N = 4000, reps = 4) => page.evaluate(
  ([list, pop, n]) => list.map(([c, p, g]) => {
    const runs = [];
    for (let k = 0; k < n; k++) {
      const r = window.__epi.run({ N: pop, c, p, g, speed: 1 });
      if (r.finalFraction > 0.02) runs.push(r);
    }
    const avg = (f) => runs.map(f).reduce((a, b) => a + b, 0) / runs.length;
    return {
      set: (c * p) / g, took: runs.length,
      r0: avg((x) => x.r0), beta: avg((x) => x.beta), period: avg((x) => x.period),
      fin: avg((x) => x.finalFraction), finT: avg((x) => x.finalTheory),
      peak: avg((x) => x.peakFraction), peakT: avg((x) => x.peakTheory),
    };
  }), [cases, N, reps]);

// ── R₀ is counted, and it is the right number ────────────────────────
const CASES = [[3, 0.5, 1], [4, 0.5, 1], [5, 0.5, 1], [3, 0.8, 1], [6, 0.4, 1.2]];
const runs = await sweep(CASES);
{
  /*
   * β and the infectious period are what the mechanism was actually set to, so
   * they can be checked against the dials directly — this is the half that
   * says the counting is right before anything is concluded from it.
   */
  const worstB = Math.max(...runs.map((r, i) => Math.abs(r.beta / (CASES[i][0] * CASES[i][1]) - 1)));
  const worstP = Math.max(...runs.map((r, i) => Math.abs(r.period * CASES[i][2] - 1)));
  chk(`the counted transmission rate is the contact rate times the transmission chance — ${runs.length} diseases`,
      worstB < 0.05,
      runs.map((r, i) => `${r.beta.toFixed(3)} vs ${(CASES[i][0] * CASES[i][1]).toFixed(2)}`).join(', '));
  chk('and the measured infectious period is 1/γ',
      worstP < 0.05,
      runs.map((r, i) => `${r.period.toFixed(3)} vs ${(1 / CASES[i][2]).toFixed(3)}`).join(', '));

  const worst0 = Math.max(...runs.map((r) => Math.abs(r.r0 / r.set - 1)));
  chk('so R₀ comes out of the run as β/γ, without being told',
      worst0 < 0.06,
      runs.map((r) => `${r.r0.toFixed(3)} vs ${r.set.toFixed(2)}`).join(', '));
}

// ── The final size solves an equation with no closed form ────────────
{
  /*
   * The heart of it. r = 1 − e^(−R₀r) cannot be rearranged for r, so the page
   * bisects for it — and the fraction of the population that was actually
   * infected has to agree. Held at 3%: over these five settings the worst
   * offline replicate ran 0.5%, and the run-to-run scatter of a finite
   * population is what the rest of the margin is for.
   */
  const worst = Math.max(...runs.map((r) => Math.abs(r.fin - r.finT)));
  chk('the fraction ever infected solves r = 1 − e^(−R₀·r), for the R₀ that was measured',
      worst < 0.03,
      runs.map((r) => `R₀=${r.r0.toFixed(2)}: ${r.fin.toFixed(4)} vs ${r.finT.toFixed(4)}`).join(', '));

  /*
   * Monotone in R₀ — but only where the theory says two settings are far
   * enough apart to be told apart.
   *
   * The first version sorted all five by measured R₀ and demanded a strict
   * order. Two of the five are built to share an R₀ with different dials, so
   * it was demanding an order between two things the theory says are
   * identical: predicted gap 0.00 percentage points. Over twenty sweeps it
   * inverted five times. It was a coin, and it had been landing right.
   *
   * So a pair is evidence only when the final sizes predicted for the two
   * measured R₀s differ by more than four points. That admits two pairs of
   * the four, and leaves them enormous: over twenty sweeps the smallest
   * surviving margin averaged 7.80 ± 0.66 points and never fell below 6.57,
   * which is twelve sigma from an inversion. Nothing was loosened — the
   * comparisons that were carrying the claim still carry it, and the two
   * that were carrying noise are now checked below for what they can
   * actually say.
   */
  const byR0 = [...runs].sort((a, b) => a.r0 - b.r0);
  const judged = [];
  for (let i = 1; i < byR0.length; i++) {
    if (byR0[i].finT - byR0[i - 1].finT > 0.04) judged.push([byR0[i - 1], byR0[i]]);
  }
  chk('and a more contagious disease reaches more of the population, but never all of it',
      judged.length >= 2 && judged.every(([lo, hi]) => hi.fin > lo.fin)
      && runs.every((r) => r.fin < 1),
      `${judged.length} pairs far enough apart to judge: `
      + judged.map(([lo, hi]) => `${lo.r0.toFixed(2)}→${(lo.fin * 100).toFixed(1)}% `
        + `vs ${hi.r0.toFixed(2)}→${(hi.fin * 100).toFixed(1)}%`).join(', ')
      + ` — all five: ${byR0.map((r) => `${r.r0.toFixed(2)}→${(r.fin * 100).toFixed(1)}%`).join(' ')}`);

  /*
   * And the near-ties say the thing worth saying. Two of the settings reach
   * the same R₀ by different routes — four contacts a day at p = 0.5 with
   * γ = 1, against six at p = 0.4 with γ = 1.2 — and if R₀ is really what
   * governs an outbreak they must end in the same place, even though every
   * dial differs. Over twenty sweeps they landed 0.73 points apart on
   * average and never more than 2.79, against final sizes that range from
   * 59% to 90% across the sweep. The bound is 4 points, a little over four
   * sigma of the difference.
   */
  const twins = [];
  for (let a = 0; a < runs.length; a++) {
    for (let b = a + 1; b < runs.length; b++) {
      if (Math.abs(runs[a].set - runs[b].set) < 1e-9) twins.push([runs[a], runs[b]]);
    }
  }
  chk('two outbreaks with the same R₀ but no dial in common end in the same place',
      twins.length >= 1 && twins.every(([x, y]) => Math.abs(x.fin - y.fin) < 0.04),
      twins.map(([x, y]) => `R₀ ${x.set.toFixed(2)}: `
        + `${(x.fin * 100).toFixed(1)}% vs ${(y.fin * 100).toFixed(1)}% `
        + `(measured ${x.r0.toFixed(2)}, ${y.r0.toFixed(2)})`).join('; ')
      || 'no pair of settings shares an R₀');
}

// ── The peak, and the threshold ──────────────────────────────────────
{
  const worst = Math.max(...runs.map((r) => Math.abs(r.peak - r.peakT)));
  chk('the highest fraction infectious at once is 1 − (1 + ln R₀)/R₀',
      worst < 0.02,
      runs.map((r) => `R₀=${r.r0.toFixed(2)}: ${r.peak.toFixed(4)} vs ${r.peakT.toFixed(4)}`).join(', '));

  /*
   * Below R₀ = 1 an outbreak cannot take off. Asked over many seedings,
   * because a single one says nothing.
   *
   * "Takes off" needs a number, and the first one chosen — 2% of the
   * population — was inside the noise. Sixteen seeds in four thousand are
   * already 0.4%, and each of them infects about 1/(1−R₀) people before the
   * chain dies, so a subcritical run routinely reaches a couple of percent.
   * It went red at R₀ = 0.6 with 2.95%.
   *
   * Twenty-five seedings at each of four settings put the ceiling where it
   * actually is:
   *
   *   R₀ 0.40   0.45 – 1.18%        R₀ 0.80   0.50 – 3.80%
   *   R₀ 0.60   0.57 – 3.13%        R₀ 1.00   0.75 – 16.48%
   *
   * against 58–89% once R₀ is safely above one. Ten percent sits in the gap
   * with room on both sides. R₀ = 1 itself is left out of the claim: on the
   * threshold the outcome really is a coin toss, which is what the page's
   * fourth note says.
   */
  const sub = await page.evaluate(() => {
    const out = [];
    for (const [c, p, g] of [[1.2, 0.5, 1], [1.0, 0.4, 1]]) {
      let major = 0, worstFrac = 0;
      for (let k = 0; k < 12; k++) {
        const r = window.__epi.run({ N: 4000, c, p, g, speed: 1 });
        if (r.finalFraction > 0.10) major++;
        worstFrac = Math.max(worstFrac, r.finalFraction);
        }
      out.push({ r0: (c * p) / g, major, worstFrac });
    }
    return out;
  });
  chk('below R₀ = 1 no outbreak takes off, however many times it is seeded',
      sub.every((x) => x.major === 0),
      sub.map((x) => `R₀=${x.r0.toFixed(2)}: ${x.major}/12 major, worst ${(x.worstFrac * 100).toFixed(2)}%`).join(', '));

  // And the theory agrees there is nothing to predict.
  const zero = await page.evaluate(() => [0.5, 0.9, 1].map((r) => window.__epi.finalSize(r)));
  chk('and the final-size equation has no root there either',
      zero.every((v) => v === 0), zero.join(', '));
}

// ── The bisection actually solves the equation ───────────────────────
{
  /*
   * finalSize is the one piece of arithmetic on the page, so it is checked as
   * arithmetic: substitute the root back in. A bisection that converged on the
   * wrong side, or stopped early, fails here rather than being blamed on the
   * epidemic.
   */
  const res = await page.evaluate(() =>
    [1.1, 1.5, 2, 3, 5, 12].map((r0) => {
      const r = window.__epi.finalSize(r0);
      return { r0, r, residual: Math.abs(1 - Math.exp(-r0 * r) - r) };
    }));
  chk('the root it bisects for satisfies the equation to 1e-12',
      res.every((x) => x.residual < 1e-12),
      res.map((x) => `R₀=${x.r0}: r=${x.r.toFixed(6)} (${x.residual.toExponential(1)})`).join(', '));
}

// ── The page shows what it measured ──────────────────────────────────
{
  await setV('pop', 1500); await setV('contact', 5); await setV('transmit', 0.5);
  await setV('recover', 1);
  await page.evaluate(() => { window.__epi.reset(); window.__epi.setRunning(true); });
  // Wait on the epidemic, not on the clock.
  await page.waitForFunction(() => {
    const s = window.__epi.state();
    return s && s.nI === 0 && s.nR > 100;
  }, null, { timeout: 60000 });

  const shown = await page.evaluate(() => {
    const m = window.__epi.measure(window.__epi.state());
    const num = (id) => document.getElementById(id).textContent.trim();
    return { m, r0: num('out-r0'), beta: num('out-beta'), period: num('out-period'),
             fin: num('out-final'), finT: num('out-final-theory'),
             peak: num('out-peak'), peakT: num('out-peak-theory'),
             verdict: num('out-verdict'), s: num('out-s'), i: num('out-i'), r: num('out-r') };
  });
  chk('the panel prints the R₀ it counted', shown.r0 === shown.m.r0.toFixed(3),
      `${shown.r0} vs ${shown.m.r0.toFixed(3)}`);
  chk('with the two halves it was counted from beside it',
      shown.beta === shown.m.beta.toFixed(3) && shown.period === shown.m.period.toFixed(2),
      `β ${shown.beta}, period ${shown.period}`);
  /*
   * Two numbers side by side, each showing what it claims to.
   *
   * The first version of this asked for them to DIFFER, which is exactly
   * backwards — it went red reading "86.5% vs 86.5%", a measurement landing on
   * the closed form to the precision the panel shows, which is the best thing
   * that can happen here. What matters is not that they disagree but that they
   * come from different places: one from the population, one from the
   * equation. So each is checked against its own source.
   */
  const both = await page.evaluate(() => {
    const s = window.__epi.state(), m = window.__epi.measure(s);
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    return {
      finFromPopulation: pct(s.nR / s.N),
      finFromEquation: pct(window.__epi.finalSize(m.r0)),
      peakFromRun: pct(s.peakI / s.N),
      peakFromFormula: pct(1 - (1 + Math.log(m.r0)) / m.r0),
    };
  });
  chk('the "ever infected" readout is the population, and the one beside it is the equation',
      shown.fin === both.finFromPopulation && shown.finT === both.finFromEquation,
      `shown ${shown.fin}/${shown.finT}, sources ${both.finFromPopulation}/${both.finFromEquation}`);
  chk('and the same for the peak — the run on the left, the formula on the right',
      shown.peak === both.peakFromRun && shown.peakT === both.peakFromFormula,
      `shown ${shown.peak}/${shown.peakT}, sources ${both.peakFromRun}/${both.peakFromFormula}`);
  chk('nobody is left infectious when it is over, and the three counts add up',
      shown.i === '0' && Number(shown.s) + Number(shown.r) === 1500,
      `S ${shown.s} + I ${shown.i} + R ${shown.r}`);
  chk('and the verdict describes what this run did',
      /burnt|번짐|烧穿/.test(shown.verdict), shown.verdict);
}

// ── Controls, translation, chrome ────────────────────────────────────
{
  const before = await page.evaluate(() => window.__epi.state().N);
  await setV('pop', 900);
  const after = await page.evaluate(() => window.__epi.state().N);
  chk('changing the population starts a new epidemic at that size',
      after === 900 && before !== after, `${before} → ${after}`);

  // Speed is how fast it is watched, not what is watched: it must not restart.
  await page.evaluate(() => { window.__epi.setRunning(true); });
  await page.waitForFunction(() => window.__epi.state().t > 1, null, { timeout: 20000 });
  const t0 = await page.evaluate(() => window.__epi.state().t);
  await setV('speed', 12);
  const t1 = await page.evaluate(() => window.__epi.state().t);
  chk('but changing the playback speed does not throw the run away',
      t1 >= t0, `t ${t0.toFixed(2)} → ${t1.toFixed(2)}`);
  await page.evaluate(() => { window.__epi.setRunning(false); });
}

{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]');
  await page.waitForFunction((prev) => document.querySelector('h1').textContent.trim() !== prev,
                             en, { timeout: 20000 });
  const ko = await h1();
  await page.click('.lang-btn[data-lang="en"]');
  await page.waitForFunction((prev) => document.querySelector('h1').textContent.trim() === prev,
                             en, { timeout: 20000 });
  chk('title translates en/ko and returns', ko !== en && (await h1()) === en, `${en} | ${ko}`);

  const unresolved = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const k = el.dataset.i18n;
      if (!window.i18n.t(k)) bad.push(k);
    }
    return bad;
  });
  chk('every data-i18n key resolves', unresolved.length === 0, unresolved.slice(0, 4).join(', '));

  const badge = await page.evaluate(() => ({
    method: document.querySelector('.method-tag')?.dataset.method,
    verified: !!document.querySelector('.method-verified'),
  }));
  chk('the page badges itself as measured and verified',
      badge.method === 'measured' && badge.verified, JSON.stringify(badge));
}

{
  /*
   * Provenance, checked in the source rather than in a number.
   *
   * "Measured" is a claim about where R₀ comes from, and a page could type it
   * in from the dials and still agree with every comparison above — planting
   * exactly that tripped only one check, and by luck rather than by design.
   * So the file is read: R₀ must be the product of the two counted quantities
   * and must never be assembled out of the contact rate, the transmission
   * chance and the recovery rate.
   */
  const src = await page.evaluate(async (u) => (await fetch(u)).text(),
                                  url('experiments/epidemic.js'));
  chk('R₀ is the product of the two things that were counted',
      /const r0 = beta \* period;/.test(src), '');
  chk('and nowhere in the file is it assembled from the sliders instead',
      !/r0\s*=\s*[^;\n]*\b[cs]\.c\b[^;\n]*[cs]\.p\b/.test(src)
      && !/r0\s*=\s*[^;\n]*\/\s*[cs]?\.?g\b/.test(src),
      'no c·p/γ shortcut for R₀');
}

chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 2).join(' | '));

for (const w of [320, 390, 768]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(200);
  const o = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win + 1, `doc=${o.doc} win=${o.win}`);
}

await finish('epidemic');
