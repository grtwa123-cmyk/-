/*
 * Radioactive decay.
 *
 * Each nucleus is rolled independently every sub-step and the survivors are
 * *counted*; N₀·2^(−t/T½) is drawn beside them for comparison and is never
 * read back. So the thing to check is that the count follows the law without
 * having been told it — and that means checking it the way you would check a
 * real counting experiment, against the binomial spread of the number of
 * survivors rather than against a tolerance somebody picked.
 *
 * At N₀ = 600 and two half-lives, σ is about 11 nuclei on a mean of 150: any
 * bound tighter than a few percent would be testing luck.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/decay.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
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

/** Run the sim and sample the count as it goes. */
const run = (ms, every = 90) => page.evaluate(async ([dur, step]) => {
  const D = window.__decay;
  D.reset();
  D.setRunning(true);
  const out = [];
  const t0 = performance.now();
  while (performance.now() - t0 < dur) {
    await new Promise((ok) => setTimeout(ok, step));
    out.push({ t: D.time(), alive: D.alive(), total: D.total(),
               pred: D.predicted(), T: D.halfLife() });
  }
  D.setRunning(false);
  return out;
}, [ms, every]);

const nearest = (trace, t) =>
  trace.reduce((b, q) => (Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b));

// ── The survivors follow N₀·2^(−t/T½) ────────────────────────────────
{
  await setV('count', 600); await setV('halflife', 2); await setV('rate', 4);
  await page.waitForTimeout(200);
  const trace = await run(20000);
  const N0 = trace[0].total, T = trace[0].T;

  const rows = [];
  for (const k of [0.5, 1, 1.5, 2, 3, 4]) {
    const q = nearest(trace, k * T);
    if (q.t < k * T * 0.9) continue;
    const p = Math.pow(2, -q.t / T);
    const mu = N0 * p, sd = Math.sqrt(N0 * p * (1 - p));
    rows.push({ k, alive: q.alive, mu, sd, z: (q.alive - mu) / sd });
  }
  const worst = Math.max(...rows.map((r) => Math.abs(r.z)));
  chk(`the counted survivors track N₀·2^(−t/T½) over ${rows.length} half-life marks`,
      rows.length >= 5 && worst < 3.5,
      rows.map((r) => `${r.k}·T½: ${r.alive} vs ${r.mu.toFixed(0)}±${r.sd.toFixed(0)} (z=${r.z.toFixed(2)})`).join(', '));

  // Draws from one run are correlated — the survivors at 2·T½ are a subset of
  // those at 1·T½ — so this mean is close to a single standard
  // normal rather than an average of six — 3σ is the honest bound, and a real
  // bias in the roll (a wrong exponent, a dt that does not scale) walks it
  // well past that.
  const mean = rows.reduce((s, r) => s + r.z, 0) / rows.length;
  chk('and with no systematic lean to the counting',
      Math.abs(mean) < 3, `mean z = ${mean.toFixed(2)} over ${rows.length} marks`);

  // The curve the page draws is the comparison, so it must be the law itself.
  const drift = Math.max(...trace.map((q) =>
    Math.abs(q.pred - q.total * Math.pow(2, -q.t / q.T))));
  chk('the drawn prediction is exactly N₀·2^(−t/T½)', drift < 1e-9,
      `worst |Δ| = ${drift.toExponential(2)} over ${trace.length} samples`);
}

// ── Decay is memoryless ──────────────────────────────────────────────
{
  // The clean statement of a half-life: whatever is left at the start of a
  // half-life, half of it is gone by the end — independent of how long the
  // sample has already been sitting there.
  await setV('count', 600); await setV('halflife', 2); await setV('rate', 4);
  const trace = await run(20000);
  const T = trace[0].T;
  const rows = [];
  for (let k = 0; k < 4; k++) {
    const a = nearest(trace, k * T), b = nearest(trace, (k + 1) * T);
    if (b.t < (k + 1) * T * 0.9 || a.alive < 30) continue;
    // The window is whatever the sampling actually spanned, not exactly one
    // half-life, so the fraction to expect is 2^(−Δt/T½) — which is the claim
    // anyway: what survives depends on how long you waited and on nothing
    // else, least of all on how long the sample had already been sitting.
    const dt = b.t - a.t;
    const want = Math.pow(2, -dt / T);
    const frac = b.alive / a.alive;
    const sd = Math.sqrt((want * (1 - want)) / a.alive);
    rows.push({ k, from: a.alive, to: b.alive, dt, frac, want, z: (frac - want) / sd });
  }
  chk(`what survives depends only on how long you waited — ${rows.length} windows`,
      rows.length >= 3 && rows.every((r) => Math.abs(r.z) < 3.5),
      rows.map((r) => `${r.from}→${r.to} over ${(r.dt / T).toFixed(2)}·T½: `
        + `${r.frac.toFixed(3)} vs ${r.want.toFixed(3)} (z=${r.z.toFixed(2)})`).join(', '));
}

// ── The half-life slider is the half-life ────────────────────────────
{
  const rows = [];
  for (const T of [1, 3, 6]) {
    await setV('count', 400); await setV('halflife', T); await setV('rate', 4);
    await page.waitForTimeout(150);
    const trace = await run(9000, 150);
    // Where the count first crosses half, by interpolating the trace.
    const N0 = trace[0].total;
    let hit = null;
    for (let i = 1; i < trace.length; i++) {
      if (trace[i].alive <= N0 / 2 && trace[i - 1].alive > N0 / 2) {
        const f = (trace[i - 1].alive - N0 / 2) / (trace[i - 1].alive - trace[i].alive);
        hit = trace[i - 1].t + f * (trace[i].t - trace[i - 1].t);
        break;
      }
    }
    rows.push({ set: T, measured: hit });
  }
  const ok = rows.every((r) => r.measured !== null && Math.abs(r.measured / r.set - 1) < 0.18);
  chk('the time the count actually takes to halve is the half-life on the slider',
      ok, rows.map((r) => `set ${r.set} → measured ${r.measured === null ? '—' : r.measured.toFixed(2)}`).join(', '));
}

// ── The live page ────────────────────────────────────────────────────
{
  await setV('count', 300); await setV('halflife', 3); await setV('rate', 2);
  await page.evaluate(() => window.__decay.reset());
  await page.waitForTimeout(300);
  const start = await page.evaluate(() => ({
    alive: window.__decay.alive(), total: window.__decay.total(), t: window.__decay.time(),
  }));
  chk('Reset puts every nucleus back and stops the clock',
      start.alive === 300 && start.total === 300 && start.t === 0, JSON.stringify(start));

  await run(4000);
  const live = await page.evaluate(() => ({
    alive: window.__decay.alive(),
    shown: [...document.querySelectorAll('.readout .num')].map((n) => n.textContent.trim()),
  }));
  chk('and a readout carries the counted survivors',
      live.shown.some((s) => s.replace(/[^0-9]/g, '') === String(live.alive)),
      `alive ${live.alive}, readouts ${live.shown.join(' | ')}`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const sig = async () => {
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const D = window.__decay;
      return JSON.stringify([D.total(), D.halfLife(), D.params(),
        document.getElementById('count-value')?.textContent,
        document.getElementById('halflife-value')?.textContent,
        document.getElementById('rate-value')?.textContent]);
    });
  };
  const dead = [];
  let before = await sig();
  for (const [name, id, v] of [['count', 'count', 450], ['halflife', 'halflife', 7], ['rate', 'rate', 3]]) {
    await setV(id, v);
    await page.evaluate(() => window.__decay.reset());
    const after = await sig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));
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

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  for (const w of [320, 390, 768]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(400);
    const over = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    chk(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
  }
}

await finish('decay');
