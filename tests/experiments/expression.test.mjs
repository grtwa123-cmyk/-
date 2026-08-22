/*
 * Gene expression noise, held against the two closed forms it is never told.
 *
 * The mechanism is a gene flipping between two states, transcribing while it
 * is on, and molecules degrading one at a time. No distribution appears in
 * it. What has to come out of it, across a field of independent cells, is
 *
 *     m = k·kon / (γ(kon + koff))        F = 1 + k·koff / ((kon+koff)(kon+koff+γ))
 *
 * and the case worth the page: with the gene never switching off, F = 1 —
 * the variance equals the mean, which is what "Poisson noise" means and is
 * not something any line of the model was told.
 *
 * Everything runs headlessly through __expr.run, so a check is a whole field
 * carried to steady state rather than a few seconds of animation, and
 * nothing samples the clock.
 *
 * The bounds are measured, not picked. Over ten repetitions of four
 * never-off settings the Fano factor landed in [0.910, 1.086] with σ ≈ 0.045,
 * so the bound below is 0.18 — four sigma. Over four bursty settings the
 * relative error against the formula stayed inside 6% on any single run with
 * σ ≈ 2.9%, so that bound is 15%. Mean error never exceeded 3.2% and the
 * duty cycle never missed by more than 2.1 points.
 */
import { browser, chk, url, finish, lang } from '../lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const B = url('experiments/expression.html');
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

const CELLS = 1500;
const sweep = (list) => page.evaluate(
  ([cases, cells]) => cases.map((q) => ({ q, ...window.__expr.run({ cells, ...q }) })),
  [list, CELLS]);

// Never off: the gene transcribes without interruption, so the only thing
// left to make cells differ is when each molecule happened to arrive or go.
const POISSON = [
  { k: 20, kon: 1, koff: 0, g: 1 },
  { k: 60, kon: 1, koff: 0, g: 0.5 },
  { k: 8, kon: 1, koff: 0, g: 1 },
  { k: 30, kon: 1, koff: 0, g: 2 },
];
// Switching on and off, from slow rare bursts to fast flickering.
const BURSTY = [
  { k: 30, kon: 1, koff: 1, g: 1 },
  { k: 40, kon: 0.5, koff: 2, g: 0.5 },
  { k: 60, kon: 1, koff: 4, g: 1 },
  { k: 30, kon: 5, koff: 5, g: 1 },
];

const flat = await sweep([...POISSON, ...BURSTY]);
const poisson = flat.slice(0, POISSON.length);
const bursty = flat.slice(POISSON.length);
const show = (r) => `k=${r.q.k} kon=${r.q.kon} koff=${r.q.koff} γ=${r.q.g}`;

// ── The Poisson nobody put there ─────────────────────────────────────
{
  /*
   * The claim the page exists for. Nothing in step() knows what a Poisson
   * distribution is; the cells are only told to transcribe and degrade. Yet
   * with the gene never switching off, the variance across them comes out
   * equal to the mean — over four settings spanning means of 8 to 120.
   */
  const worst = Math.max(...poisson.map((r) => Math.abs(r.fano - 1)));
  chk('with the gene never switching off the variance equals the mean — Fano is 1',
      poisson.every((r) => Math.abs(r.fano - 1) < 0.18),
      poisson.map((r) => `${show(r)}: F=${r.fano.toFixed(3)}`).join(', ')
      + ` — worst |F−1| = ${worst.toFixed(3)}`);

  // And it is 1 for every one of them, not on average: a model that got the
  // width right only in the mean would pass the line above and fail here.
  const lean = poisson.reduce((s, r) => s + (r.fano - 1), 0) / poisson.length;
  chk('and it is 1 at every setting, with no lean across them',
      Math.abs(lean) < 0.09,
      `mean F−1 = ${lean.toFixed(4)} over ${poisson.length} settings`);
}

// ── The mean is k·kon / (γ(kon+koff)) ────────────────────────────────
{
  const rows = flat.map((r) => ({ r, e: r.mean / r.meanTheory - 1 }));
  const worst = Math.max(...rows.map((x) => Math.abs(x.e)));
  chk(`the mean copy number is k·kon/(γ(kon+koff)) — ${flat.length} settings`,
      worst < 0.08,
      rows.map(({ r, e }) => `${show(r)}: ${r.mean.toFixed(1)} vs `
        + `${r.meanTheory.toFixed(1)} (${(e * 100).toFixed(1)}%)`).join(', '));
}

// ── The Fano factor is the telegraph formula ─────────────────────────
{
  /*
   * Bursting widens the population beyond Poisson by a factor the two
   * switching rates fix exactly. These four span F from 2.4 to 11.7, so a
   * model that had the shape but not the width would miss by far more than
   * the bound.
   */
  const rows = bursty.map((r) => ({ r, e: r.fano / r.fanoTheory - 1 }));
  const worst = Math.max(...rows.map((x) => Math.abs(x.e)));
  chk(`switching the gene off widens it by exactly 1 + k·koff/((kon+koff)(kon+koff+γ))`,
      worst < 0.15,
      rows.map(({ r, e }) => `${show(r)}: F=${r.fano.toFixed(2)} vs `
        + `${r.fanoTheory.toFixed(2)} (${(e * 100).toFixed(1)}%)`).join(', '));

  // The direction on its own, which is the thing a reader sees: every bursty
  // setting is wider than any never-off one, with no overlap between them.
  const widestFlat = Math.max(...poisson.map((r) => r.fano));
  const narrowestBursty = Math.min(...bursty.map((r) => r.fano));
  chk('and every switching gene is wider than every steady one, with clear air between',
      narrowestBursty > widestFlat + 0.8,
      `widest steady F=${widestFlat.toFixed(3)}, narrowest bursty F=${narrowestBursty.toFixed(3)}`);
}

// ── The gene is on as often as its rates say ─────────────────────────
{
  const rows = flat.map((r) => ({ r, d: r.duty - r.dutyTheory }));
  const worst = Math.max(...rows.map((x) => Math.abs(x.d)));
  chk('the fraction of genes switched on is kon/(kon+koff)',
      worst < 0.06,
      rows.map(({ r, d }) => `${show(r)}: ${(r.duty * 100).toFixed(1)}% vs `
        + `${(r.dutyTheory * 100).toFixed(1)}% (${(d * 100).toFixed(1)}pp)`).join(', '));
}

// ── Bursting at a fixed mean ─────────────────────────────────────────
{
  /*
   * The cleanest statement of what bursting costs, because it holds the mean
   * still. Two genes expressed at the same average: one transcribing
   * steadily, one in rare bursts. Same mean, and the second spreads its
   * cells far wider — including many holding nothing at all.
   */
  const pair = await sweep([
    { k: 10, kon: 1, koff: 0, g: 1 },       // steady, mean 10
    { k: 60, kon: 0.2, koff: 1, g: 1 },     // bursty, mean 60·0.2/1.2 = 10
  ]);
  const [steady, burst] = pair;
  chk('two genes with the same mean but different bursting are different cells to be',
      Math.abs(steady.mean - burst.mean) < 1.5
      && burst.fano > 4 * steady.fano
      && burst.silent > steady.silent + 0.2,
      `means ${steady.mean.toFixed(2)} vs ${burst.mean.toFixed(2)}; `
      + `Fano ${steady.fano.toFixed(2)} vs ${burst.fano.toFixed(2)}; `
      + `empty cells ${(steady.silent * 100).toFixed(1)}% vs ${(burst.silent * 100).toFixed(1)}%`);
}

// ── The histogram is the cells ───────────────────────────────────────
{
  /*
   * The bars are what is being claimed about, so they have to be the cells
   * themselves — not a curve fitted to them, and not the Poisson drawn on
   * top. Rebuilding the mean out of the histogram has to give the readout.
   */
  const q = await page.evaluate(() => {
    const st = window.__expr.build({ cells: 1200, k: 25, kon: 1, koff: 1, g: 1, speed: 1 });
    for (let i = 0; i < 1400; i++) window.__expr.step(st);
    const m = window.__expr.measure(st);
    const bins = Math.ceil(m.max) + 2;
    const h = Array.from(window.__expr.histogram(st, bins));
    const total = h.reduce((a, b) => a + b, 0);
    const mean = h.reduce((s, c, n) => s + c * n, 0) / total;
    return { total, mean, measured: m.mean, cells: st.m.length };
  });
  chk('every cell is in the histogram exactly once, and it carries the mean that is reported',
      q.total === q.cells && Math.abs(q.mean - q.measured) < 1e-9,
      `${q.total} of ${q.cells} cells binned, mean from bars ${q.mean.toFixed(6)} `
      + `vs readout ${q.measured.toFixed(6)}`);
}

// ── More cells, a sharper answer ─────────────────────────────────────
{
  /*
   * A statistical claim should get better with more data, and by the right
   * amount. The spread of the Fano estimate should fall like 1/√cells, so
   * sixteen times the cells should quarter it.
   *
   * Forty runs at each size, batched into one call rather than one round trip
   * apiece — which makes forty cheaper than the eight this used to do. Eight
   * is not enough to estimate a standard deviation, let alone the ratio of
   * two: measured over twelve trials the ratio ranged 0.13 to 0.82 against a
   * bound of 0.6, and went over it once in twelve. At forty the same twelve
   * trials sit between 0.19 and 0.31 with a median of 0.25, which is the
   * quarter the theory asks for, so the bound comes down to 0.4.
   */
  const spread = (cells, reps) => page.evaluate(([c, r]) => {
    const v = [];
    for (let i = 0; i < r; i++) {
      v.push(window.__expr.run({ cells: c, k: 20, kon: 1, koff: 0, g: 1 }).fano);
    }
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  }, [cells, reps]);
  const small = await spread(200, 40);
  const big = await spread(3200, 40);
  chk('the estimate sharpens as more cells are counted, roughly as 1/√cells',
      big < small * 0.4,
      `σ(F) = ${small.toFixed(3)} at 200 cells, ${big.toFixed(3)} at 3200 `
      + `(ratio ${(big / small).toFixed(2)}, 1/4 expected)`);
}

// ── Where the numbers come from ──────────────────────────────────────
{
  /*
   * The page would look identical if measure() returned the formulas instead
   * of counting the cells, and every check above would pass. So the source
   * is read: the reported mean and Fano must be built out of the array.
   */
  const src = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', 'experiments', 'expression.js'), 'utf8');
  const body = src.slice(src.indexOf('function measure'), src.indexOf('function poissonPmf'));

  chk('the reported Fano is variance over mean, taken from the cells',
      /fano:\s*total\s*>=\s*200\s*\?\s*variance\s*\/\s*mean/.test(body)
      && /sum\s*\+=\s*v;\s*sumSq\s*\+=\s*v\s*\*\s*v;/.test(body),
      'measure() no longer accumulates the cells and divides');

  chk('and it is not quietly the formula wearing the measurement\'s name',
      !/fano:\s*[^,]*(?:fanoTheory|kon|koff)/.test(body)
      && !/mean:\s*[^,]*(?:meanTheory|kon\b)/.test(body),
      'measure() builds its reported values out of the parameters');

  // The Poisson curve is for the eye. If the histogram were drawn from it the
  // page would be showing its own answer back to itself.
  const stepBody = src.slice(src.indexOf('function step'), src.indexOf('// ── What the field'));
  chk('and the mechanism never consults a distribution',
      !/poissonPmf/.test(stepBody) && !/Theory/.test(stepBody),
      'step() reaches for a closed form');
}

// ── The live page ────────────────────────────────────────────────────
{
  await page.evaluate(() => window.__expr.reset());
  await page.waitForTimeout(200);
  const shown = await page.evaluate(() => {
    const st = window.__expr.state();
    for (let i = 0; i < 900; i++) window.__expr.step(st);
    return null;
  });
  await page.evaluate(() => window.__expr.setRunning(true));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__expr.setRunning(false));

  const live = await page.evaluate(() => {
    const q = window.__expr.measure(window.__expr.state());
    return {
      q,
      mean: document.getElementById('out-mean').textContent.trim(),
      fano: document.getElementById('out-fano').textContent.trim(),
      variance: document.getElementById('out-variance').textContent.trim(),
    };
  });
  chk('the readouts are the field in front of them',
      live.mean === live.q.mean.toFixed(2)
      && live.fano === live.q.fano.toFixed(3)
      && live.variance === live.q.variance.toFixed(2),
      `shown ${live.mean}/${live.variance}/${live.fano}, `
      + `field ${live.q.mean.toFixed(2)}/${live.q.variance.toFixed(2)}/${live.q.fano.toFixed(3)}`);

  chk('and the theory is shown beside it rather than in place of it',
      (await txt('out-mean-theory')) !== (await txt('out-mean'))
      || Math.abs(live.q.mean - live.q.meanTheory) < 0.005,
      `${await txt('out-mean')} vs ${await txt('out-mean-theory')}`);

  const shape = await txt('out-shape');
  chk('and the page says in words what the width came to',
      typeof shape === 'string' && shape.length > 3 && shape !== 'exprShapePoisson',
      shape);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const sig = async () => {
    await page.waitForTimeout(120);
    return page.evaluate(() => {
      const p = window.__expr.params();
      return JSON.stringify([p, window.__expr.state().m.length,
        document.getElementById('cells-value')?.textContent,
        document.getElementById('rate-value')?.textContent,
        document.getElementById('kon-value')?.textContent,
        document.getElementById('koff-value')?.textContent,
        document.getElementById('decay-value')?.textContent]);
    });
  };
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['cells', 1200], ['rate', 45], ['kon', 2.5],
                         ['koff', 3.0], ['decay', 1.5], ['speed', 20]]) {
    await setV(id, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  // Changing the biology restarts the field; changing the playback speed
  // must not, or a reader cannot speed up a run to watch it settle.
  await setV('speed', 5);
  const t0 = await page.evaluate(() => {
    const st = window.__expr.state();
    for (let i = 0; i < 300; i++) window.__expr.step(st);
    return st.t;
  });
  await setV('speed', 25);
  const t1 = await page.evaluate(() => window.__expr.state().t);
  chk('and speeding the run up does not throw the field away',
      t1 >= t0 - 1e-9, `t was ${t0.toFixed(2)} min, then ${t1.toFixed(2)} min`);

  await setV('kon', 3.3);
  const restarted = await page.evaluate(() => window.__expr.state().t);
  chk('while changing the biology starts a fresh one',
      restarted === 0, `t = ${restarted}`);
}

// ── Language changes reach the strings JS owns ───────────────────────
{
  /*
   * paint() rewrites every data-i18n node, which hides a page that stopped
   * listening: the moment it repaints a running page's Start/Pause button it
   * writes "Start" in the new language over a button that means Pause, and
   * only the page's own langchange handler puts it right. This page shipped
   * listening for "i18n:change" — an event nothing has ever fired — so the
   * button lied in Korean and the koff dial's "never" stayed English.
   */
  await setV('koff', 0);                       // the dial whose label is a word
  await page.evaluate(() => window.__expr.setRunning(true));
  await lang(page, 'ko');
  const running = await page.evaluate(() => window.__expr.isRunning());
  const btn = await txt('start-btn');
  const koff = await txt('koff-value');
  await page.evaluate(() => window.__expr.setRunning(false));
  await lang(page, 'en');
  chk('switching language mid-run keeps the button meaning Pause, in the new language',
      running && btn === '일시정지', `running=${running}, button says "${btn}"`);
  chk('and the "never switches off" label follows the language too',
      koff === '안 꺼짐', `koff label says "${koff}"`);
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await lang(page, 'ko');
  const ko = await h1();
  await lang(page, 'zh');
  const zh = await h1();
  await lang(page, 'en');
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
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('expression');
