/*
 * Ideal gas — pressure as bookkeeping.
 *
 * Nothing here evaluates PV = NkT. Every wall bounce deposits an impulse and
 * those are summed over a rolling window and divided by (time × wall length);
 * that sum IS the measured pressure, and N·T/A is printed beside it.
 *
 * So the checks are the gas laws themselves, measured: P against N, against T,
 * and against 1/A. Those are the strong ones, because a page that had simply
 * been drawing N·T/A would pass them trivially — which is why they come with
 * two others that would not have. One holds the geometry: the box the impulse
 * is divided by has to be the box the particles are actually in, and it was
 * not, which read as a piston-dependent 2.6–10% "effect". The other holds
 * equipartition: with a global thermostat and no particle interactions there
 * was nothing to move energy between x and y, so whatever imbalance the
 * initial draw produced was frozen for the run and the pressure sat a stable
 * 11% off. Diffuse thermal walls fixed that, and the check is that the two
 * axes actually exchange — not that they happen to be equal right now.
 *
 * The pressure reading is a smoothed rolling window, so consecutive samples
 * are strongly correlated and the run-to-run spread is about 6%. Bounds here
 * come from that measured spread, not from a number that looked tidy.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/gas.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const setV = (id, v) => page.$eval('#' + id, (el, val) => {
  el.value = String(val);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

/** Settle, then average the reading. Never via Reset — that restores defaults. */
/*
 * Sample by pressure windows, not by seconds.
 *
 * This waited 2 600 ms for the gas to settle and then averaged for seven
 * seconds of wall-clock, which meant the evidence behind every number here
 * depended on how busy the machine was. It failed on a loaded runner with the
 * worst point 32% off its ideal and four checks going down together — a
 * shortage of samples, not a disagreement about physics.
 *
 * The pressure is a rolling average over PWINDOW = 0.4 s, so a closed window
 * is the natural unit of evidence and gas.js now counts them. Six windows to
 * settle and eighteen to average are what seven idle seconds used to buy; a
 * loaded machine now takes longer and gets the same number of them.
 */
const SETTLE_WINDOWS = 6;
const AVG_WINDOWS = 18;

async function sample(cfg, windows = AVG_WINDOWS) {
  for (const [k, v] of Object.entries(cfg)) await setV(k, v);
  const from = await page.evaluate(() => window.__gas.windows());
  await page.waitForFunction(
    (w) => window.__gas.windows() >= w, from + SETTLE_WINDOWS, { timeout: 60000 });
  return page.evaluate(async (want) => {
    const g = window.__gas;
    const ps = [], ax = [], kt = [];
    const start = g.windows();
    while (g.windows() - start < want) {
      await new Promise((ok) => setTimeout(ok, 170));
      ps.push(g.measuredPressure());
      let sx = 0, sy = 0;
      const list = g.particles();
      for (const q of list) { sx += q.vx * q.vx; sy += q.vy * q.vy; }
      ax.push((sx - sy) / (sx + sy));
      kt.push((sx + sy) / (2 * list.length * 25));
    }
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    return { P: mean(ps), ideal: g.predictedPressure(), area: g.area(),
             n: g.count(), imbalance: ax, kT: mean(kt), T: g.params().T };
  }, windows);
}

const fit = (xs, ys) => {
  const lx = xs.map(Math.log), ly = ys.map(Math.log);
  const mx = lx.reduce((a, b) => a + b) / lx.length;
  const my = ly.reduce((a, b) => a + b) / ly.length;
  let n = 0, d = 0;
  for (let i = 0; i < lx.length; i++) { n += (lx[i] - mx) * (ly[i] - my); d += (lx[i] - mx) ** 2; }
  return n / d;
};

// ── The gas laws, measured off the impulse tally ─────────────────────
const all = [];
{
  const rows = [];
  for (const N of [60, 140, 240]) rows.push({ x: N, ...(await sample({ temp: 300, volume: 80, count: N })) });
  all.push(...rows);
  const e = fit(rows.map((r) => r.x), rows.map((r) => r.P));
  chk('pressure is proportional to how many particles are in the box',
      Math.abs(e - 1) < 0.15,
      `P ∝ N^${e.toFixed(3)} — ${rows.map((r) => `${r.n}:${r.P.toFixed(3)}`).join(' ')}`);
}
{
  const rows = [];
  for (const T of [150, 350, 600]) rows.push({ x: T, ...(await sample({ temp: T, volume: 80, count: 160 })) });
  all.push(...rows);
  const e = fit(rows.map((r) => r.x), rows.map((r) => r.P));
  chk('and to the temperature the walls hold them at',
      Math.abs(e - 1) < 0.15,
      `P ∝ T^${e.toFixed(3)} — ${rows.map((r) => `${r.x}:${r.P.toFixed(3)}`).join(' ')}`);
}
{
  const rows = [];
  for (const V of [35, 60, 100]) rows.push({ x: V, ...(await sample({ temp: 300, volume: V, count: 160 })) });
  all.push(...rows);
  const e = fit(rows.map((r) => r.area), rows.map((r) => r.P));
  chk('and inversely to the area the piston leaves them — Boyle, counted out of the bounces',
      Math.abs(e + 1) < 0.15,
      `P ∝ A^${e.toFixed(3)} — ${rows.map((r) => `${Math.round(r.area)}:${r.P.toFixed(3)}`).join(' ')}`);
}
{
  const off = all.map((r) => r.P / r.ideal);
  const worst = Math.max(...off.map((v) => Math.abs(v - 1)));
  const mean = off.reduce((a, b) => a + b) / off.length;
  /*
   * Per point the spread is about 6%, and the largest of nine such draws
   * reaches into the mid teens often enough — 20% is the honest bound on the
   * worst one. The mean is where the strength is: nine settings averaged has
   * a standard error near 2%, so a lean of 6% is three sigma and any of the
   * defects this page actually had walks straight past it.
   */
  chk(`and the tally sits on N·T/A at every one of the ${all.length} settings`,
      worst < 0.20, `worst ${(worst * 100).toFixed(1)}% off, mean ratio ${mean.toFixed(4)}`);
  chk('with no lean left in it once the nine are averaged',
      Math.abs(mean - 1) < 0.06, `mean measured/ideal = ${mean.toFixed(4)}`);
}

// ── The box the impulse is divided by is the box the gas is in ───────
{
  // Deterministic, no statistics: the particles turn around at R from each
  // wall, so the extremes they reach have to bound exactly the area the
  // prediction is computed over. Dividing by the drawn box instead put a
  // piston-dependent 2.6–10% into the reading and it looked like physics.
  const r = await page.evaluate(async () => {
    const g = window.__gas;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await new Promise((ok) => setTimeout(ok, 40));
      for (const q of g.particles()) {
        if (q.x < x0) x0 = q.x; if (q.x > x1) x1 = q.x;
        if (q.y < y0) y0 = q.y; if (q.y > y1) y1 = q.y;
      }
    }
    return { span: (x1 - x0) * (y1 - y0), area: g.area() };
  });
  chk('the area the prediction uses is the area the particles reach',
      Math.abs(r.span / r.area - 1) < 0.02,
      `centres span ${Math.round(r.span)}, prediction uses ${Math.round(r.area)}`);
}

// ── The walls do the thermalising ────────────────────────────────────
{
  const r = await sample({ temp: 400, volume: 80, count: 200 }, 15);
  // Averaged over the window, not read off one frame: a snapshot of 200
  // particles carries a 7% standard error all by itself, so a single-frame
  // reading against a 12% bound is a coin toss — which it duly lost on the
  // second run, at 338 against a set point of 400.
  chk('the gas comes out at the temperature on the dial',
      Math.abs(r.kT / 400 - 1) < 0.12, `set 400, measured ${r.kT.toFixed(1)}`);

  // The point of the diffuse walls: they are the only thing coupling x to y.
  // A frozen imbalance is constant to the last bit; an exchanging one moves.
  const imb = r.imbalance;
  const mean = imb.reduce((a, b) => a + b) / imb.length;
  const sd = Math.sqrt(imb.reduce((a, b) => a + (b - mean) ** 2, 0) / imb.length);
  chk('the two axes exchange energy rather than keeping whatever the first draw gave them',
      sd > 1e-3 && Math.abs(mean) < 0.09,
      `imbalance drifts by ${(sd * 100).toFixed(2)}% about a mean of ${(mean * 100).toFixed(2)}%`);
}

// ── The speeds are Maxwell–Boltzmann ─────────────────────────────────
{
  await setV('temp', 300); await setV('volume', 90); await setV('count', 240);
  await page.waitForTimeout(2600);
  const r = await page.evaluate(async () => {
    // Pool many frames so the histogram is not one snapshot of 240 particles.
    const g = window.__gas;
    const BINS = 14;
    const hist = new Array(BINS).fill(0);
    let n = 0, sv2 = 0;
    const t0 = performance.now();
    const speeds = [];
    while (performance.now() - t0 < 9000) {
      await new Promise((ok) => setTimeout(ok, 400));
      for (const q of g.particles()) {
        const v = Math.hypot(q.vx, q.vy);
        speeds.push(v); sv2 += v * v; n++;
      }
    }
    const mv2 = sv2 / n;                       // ⟨v²⟩ = 2kT/m in 2D
    const top = Math.sqrt(mv2) * 2.6;
    for (const v of speeds) {
      const b = Math.floor((v / top) * BINS);
      if (b >= 0 && b < BINS) hist[b]++;
    }
    // 2D Maxwell speed law: f(v) = (2v/⟨v²⟩)·exp(−v²/⟨v²⟩)
    const exp = [];
    for (let b = 0; b < BINS; b++) {
      const lo = (b / BINS) * top, hi = ((b + 1) / BINS) * top;
      exp.push(Math.exp(-lo * lo / mv2) - Math.exp(-hi * hi / mv2));
    }
    const tot = exp.reduce((a, c) => a + c);
    return { hist, exp: exp.map((v) => v / tot), n };
  });
  /*
   * A particle's speed only changes when it hits a wall, so pooling frames
   * does not buy independent draws: over nine seconds each particle turns
   * over a handful of times, which is a few thousand real samples, not the
   * tens of thousands the raw count suggests. Five points is about 3σ on that
   * — and a first pass at 2.5 points passed on the clean page and failed under
   * a planted defect that cannot touch a velocity, which is how a bound gets
   * found out. It still has no trouble with a distribution of the wrong shape:
   * Gaussian instead of Rayleigh misses by twenty.
   */
  let worst = 0;
  for (let b = 0; b < r.hist.length; b++) {
    worst = Math.max(worst, Math.abs(r.hist[b] / r.n - r.exp[b]));
  }
  chk('the speeds the walls hand back are Maxwell–Boltzmann',
      worst < 0.05, `worst bin off by ${(worst * 100).toFixed(2)} points over ${r.n} samples`);
}

// ── The live page ────────────────────────────────────────────────────
{
  await sample({ temp: 300, volume: 70, count: 120 }, 10);
  // One round trip: the tally moves between frames, so reading the DOM in a
  // second call and comparing it to a windowed mean would only be measuring
  // how long the round trip took.
  const shown = await page.evaluate(() => ({
    meas: document.getElementById('out-pmeas')?.textContent.trim(),
    ideal: document.getElementById('out-pideal')?.textContent.trim(),
    n: document.getElementById('out-n')?.textContent.trim(),
    tally: window.__gas.measuredPressure(),
    pred: window.__gas.predictedPressure(),
    count: window.__gas.count(),
  }));
  chk('each readout carries its own number',
      Math.abs(parseFloat(shown.meas) - shown.tally) < 0.01
      && Math.abs(parseFloat(shown.ideal) - shown.pred) < 0.01,
      `shown ${shown.meas} vs tally ${shown.tally.toFixed(4)}; `
      + `prediction ${shown.ideal} vs ${shown.pred.toFixed(4)}`);

  /*
   * And the measured one is a measurement. A first pass asked that the two
   * readouts differ, which is exactly backwards — agreeing is the point of the
   * page, and the check duly failed the second time it ran, on a frame where
   * both rounded to 0.74. What separates them is not their value but their
   * behaviour: a tally over a rolling window wanders from frame to frame and
   * N·T/A does not move at all until a slider does.
   */
  const drift = await page.evaluate(async () => {
    const g = window.__gas;
    const m = [], i = [];
    for (let k = 0; k < 12; k++) {
      await new Promise((ok) => setTimeout(ok, 220));
      m.push(g.measuredPressure()); i.push(g.predictedPressure());
    }
    const spread = (a) => Math.max(...a) - Math.min(...a);
    return { m: spread(m), i: spread(i), mean: m.reduce((x, y) => x + y) / m.length };
  });
  chk('and it is a measurement — it wanders where the prediction sits still',
      drift.m > drift.mean * 0.004 && drift.i === 0,
      `tally moved ${(100 * drift.m / drift.mean).toFixed(2)}% over 12 frames, `
      + `prediction moved ${drift.i}`);
  chk('and the particle count readout is the particles there are',
      parseInt(shown.n, 10) === shown.count, `${shown.n} vs ${shown.count}`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const sig = async () => {
    await page.waitForTimeout(500);
    return page.evaluate(() => JSON.stringify([
      window.__gas.params(), window.__gas.count(), Math.round(window.__gas.area()),
      document.getElementById('temp-value')?.textContent,
      document.getElementById('volume-value')?.textContent,
      document.getElementById('count-value')?.textContent]));
  };
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['temp', 500], ['volume', 45], ['count', 200]]) {
    await setV(id, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#reset-btn');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__gas.params());
  chk('Reset restores the defaults',
      after.T === 300 && Math.abs(after.fr - 0.7) < 1e-9 && after.N === 80,
      JSON.stringify(after));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns', en !== ko && ko !== zh && (await h1()) === en,
      `${en} / ${ko} / ${zh}`);

  const unresolved = await page.evaluate(() => [...document.querySelectorAll('[data-i18n]')]
    .filter((el) => el.textContent.trim() === el.dataset.i18n).map((el) => el.dataset.i18n));
  chk('every data-i18n key resolves', unresolved.length === 0, unresolved.slice(0, 4).join(', '));

  chk('the page badges itself as measured and verified',
      await page.$('.method-tag[data-method="measured"]') !== null
      && await page.$('.method-verified') !== null);

  const src = await page.evaluate(async (u) => (await fetch(u)).text(), url('experiments/gas.js'));
  chk('the reading is never taken from the prediction',
      !/pMeas\s*=\s*[^;\n]*idealP/.test(src) && /impulseAcc\s*\/\s*\(windowT/.test(src),
      'pMeas comes from the impulse sum over the window');

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('gas');
