/*
 * Titration — the equivalence point located rather than calculated.
 *
 * The pH already came from an exact charge balance solved by bisection, with
 * no regime special-cased. What the panel *printed* was the problem: Cₐ·Vₐ/C_b
 * labelled "the equivalence volume", which is the answer rather than a
 * measurement of it.
 *
 * It is now found the way a chemist finds it — the steepest point of the
 * curve, by golden section on |dpH/dV| — and shown beside the stoichiometric
 * value, which it matches to a fraction of a part per million across both
 * acids and every setting the sliders reach. Two more results are read off
 * the same curve: the pH halfway to that volume, which for the weak acid is
 * pKa, and the pH at it, which is 7 for the strong acid and the hydrolysis
 * result for the weak one.
 *
 * No randomness here, so the bounds are not absorbing run-to-run scatter, and
 * each was watched fail under a planted defect.
 */
import { browser, chk, url, finish } from '../lib/harness.mjs';

const B = url('experiments/titration.html');
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PE: ' + e.message));
await page.goto(B, { waitUntil: 'networkidle' });
chk('page loads without console errors', errs.length === 0, errs.slice(0, 2).join(' | '));

const n = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const ex = (x, d = 2) => (Number.isFinite(x) ? x.toExponential(d) : String(x));

const SETTINGS = [[0.10, 25, 0.10], [0.05, 40, 0.20], [0.20, 10, 0.05],
                  [0.15, 30, 0.12], [0.05, 10, 0.20]];

const all = await page.evaluate((settings) => {
  const T = window.__titration;
  const out = [];
  for (const [key, acid] of Object.entries(T.ACIDS)) {
    for (const [Ca, Va, Cb] of settings) {
      const p = { Ca, Va, Cb, rate: 1, Ka: acid.Ka };
      out.push({ key, Ca, Va, Cb, Ka: acid.Ka, ...T.measure(p) });
    }
  }
  return out;
}, SETTINGS);
const weak = all.filter((s) => s.weak);
const strong = all.filter((s) => !s.weak);

// ── The equivalence point, located ───────────────────────────────────
{
  const worst = Math.max(...all.map((s) => Math.abs(s.veq / s.veqFormula - 1)));
  chk(`the volume where the curve is steepest is Cₐ·Vₐ/C_b — ${all.length} settings, both acids`,
      worst < 1e-5,
      `worst ${ex(worst)}; ` + all.slice(0, 4)
        .map((s) => `${s.key} ${n(s.veq, 4)} vs ${n(s.veqFormula, 4)}`).join(', '));

  /*
   * And it really is the steepest point, not something that happened to land
   * there. A fine scan of the slope, taken here rather than in the page, must
   * not find anywhere steeper.
   */
  const steepest = await page.evaluate((settings) => {
    const T = window.__titration;
    const out = [];
    for (const [key, acid] of Object.entries(T.ACIDS)) {
      for (const [Ca, Va, Cb] of settings.slice(0, 3)) {
        const p = { Ca, Va, Cb, rate: 1, Ka: acid.Ka };
        const veq = T.measure(p).veq;
        const e = 1e-6;
        const slope = (v) => (T.phAt(v + e, p) - T.phAt(v - e, p)) / (2 * e);
        const here = slope(veq);
        let best = -Infinity;
        for (let i = 1; i < 4000; i++) {
          const v = (T.VMAX * i) / 4000;
          const s = slope(v);
          if (s > best) best = s;
        }
        out.push({ key, here, best, ratio: here / best });
      }
    }
    return out;
  }, SETTINGS);
  chk('and nowhere on the curve is steeper than the point it found',
      steepest.every((s) => s.ratio > 0.999),
      steepest.map((s) => `${s.key}: ${n(s.here, 0)} vs best on a 4000-point scan ${n(s.best, 0)}`).join(', '));

  chk('the jump is sharp for the strong acid and far gentler for the weak one',
      Math.min(...steepest.filter((s) => s.key === 'hcl').map((s) => s.here))
      > 5 * Math.max(...steepest.filter((s) => s.key === 'acetic').map((s) => s.here)),
      steepest.map((s) => `${s.key}: ${n(s.here, 0)} pH/mL`).join(', '));
}

// ── pKa, halfway there ───────────────────────────────────────────────
{
  const worst = Math.max(...weak.map((s) => Math.abs(s.halfPH - s.pKa)));
  chk('the pH halfway to the equivalence volume is pKa — the weak acid, five settings',
      worst < 2e-3,
      `worst ${ex(worst)} pH units; ` + weak
        .map((s) => `${n(s.halfPH, 4)} vs ${n(s.pKa, 4)}`).join(', '));

  chk('and it holds while the concentrations move fourfold, because pKa does not depend on them',
      Math.max(...weak.map((s) => s.Ca)) / Math.min(...weak.map((s) => s.Ca)) >= 4
      && new Set(weak.map((s) => s.pKa.toFixed(6))).size === 1,
      `Cₐ from ${Math.min(...weak.map((s) => s.Ca))} to ${Math.max(...weak.map((s) => s.Ca))}, `
      + `pKa ${n(weak[0].pKa, 4)} throughout`);

  /*
   * The strong acid has no buffer and no pKa worth printing — the stand-in
   * Ka = 10³ has a pKa of −3, which is not a pH anything will ever read. The
   * page has to decline the comparison rather than print it.
   */
  chk('the strong acid is not offered a pKa, because it has no buffer to have one',
      strong.length > 0 && strong.every((s) => s.weak === false && s.pKa < 0),
      strong.length ? `pKa would be ${n(strong[0].pKa, 1)}`
                    : 'no acid was treated as strong at all');
}

// ── The pH at the equivalence point ──────────────────────────────────
{
  const ws = strong.length ? Math.max(...strong.map((s) => Math.abs(s.eqPH - 7))) : NaN;
  chk('a strong acid neutralised by a strong base lands on pH 7',
      strong.length > 0 && ws < 2e-3 && strong.every((s) => s.eqFormula === 7),
      `worst ${ex(ws)}; ` + strong.map((s) => n(s.eqPH, 5)).join(', '));

  const ww = Math.max(...weak.map((s) => Math.abs(s.eqPH - s.eqFormula)));
  chk('and a weak one overshoots it, by exactly the hydrolysis of its conjugate base',
      ww < 2e-3 && weak.every((s) => s.eqPH > 8),
      `worst ${ex(ww)}; ` + weak
        .map((s) => `${n(s.eqPH, 4)} vs 7 + ½pKa + ½log C = ${n(s.eqFormula, 4)}`).join(', '));
}

// ── Henderson–Hasselbalch, and where it stops being true ─────────────
{
  const hh = await page.evaluate(() => {
    const T = window.__titration;
    const p = { Ca: 0.10, Va: 25, Cb: 0.10, rate: 1, Ka: T.ACIDS.acetic.Ka };
    const m = T.measure(p);
    return [0.1, 0.25, 0.5, 0.75, 0.9].map((f) => ({
      f, ph: T.phAt(m.veq * f, p),
      hh: m.pKa + Math.log10(f / (1 - f)),
    }));
  });
  const errsHH = hh.map((s) => Math.abs(s.ph - s.hh));
  chk('the buffer follows pH = pKa + log([A⁻]/[HA]) across the plateau',
      Math.max(...errsHH) < 1e-2,
      hh.map((s) => `${(s.f * 100).toFixed(0)}%: ${n(s.ph, 4)} vs ${n(s.hh, 4)}`).join(', '));

  /*
   * Henderson–Hasselbalch is an approximation — it takes the ratio of the two
   * forms straight from the stoichiometry, ignoring the acid's own
   * dissociation. That neglect costs most where there is least conjugate base
   * to swamp it, so the error should shrink as the plateau is crossed. It
   * does, by a factor of 47 from a tenth of the way to nine tenths.
   */
  chk('and the approximation is worst early, where the acid\'s own dissociation is not negligible',
      errsHH[0] > 20 * errsHH[errsHH.length - 1] && errsHH[0] > 5e-3,
      `error falls from ${ex(errsHH[0])} at 10% to ${ex(errsHH[errsHH.length - 1])} at 90%`);
}

// ── The solver is holding itself to the charge balance ───────────────
{
  const res = await page.evaluate(() => {
    const T = window.__titration;
    let worst = 0;
    let monotone = true;
    for (const [, acid] of Object.entries(T.ACIDS)) {
      const p = { Ca: 0.1, Va: 25, Cb: 0.1, rate: 1, Ka: acid.Ka };
      let prev = -Infinity;
      for (let i = 0; i <= 200; i++) {
        const v = (T.VMAX * i) / 200;
        const r = T.residual(v, p);
        worst = Math.max(worst, Math.abs(r.f) / r.scale);
        const ph = T.phAt(v, p);
        if (ph < prev - 1e-12) monotone = false;
        prev = ph;
      }
    }
    return { worst, monotone };
  });
  chk('every pH the solver returns satisfies the charge balance it was solving',
      res.worst < 1e-12, `worst relative residual ${ex(res.worst)} over 402 points`);
  chk('and the curve never goes backwards as base is added',
      res.monotone === true);
}

// ── The live page ────────────────────────────────────────────────────
{
  const live = await page.evaluate(async () => {
    const T = window.__titration;
    T.setRunning(false);
    T.selectAcid('acetic');
    T.setVolume(12.5);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const p = T.params();
    const m = T.measure(p);
    const txt = (id) => document.getElementById('out-' + id).textContent.trim();
    return { p, m, ph: T.phAt(12.5, p),
             veq: txt('veq'), half: txt('half-ph'), eq: txt('eq-ph'),
             phTxt: txt('ph'), region: txt('region'), pct: txt('pct') };
  });
  chk('the panel prints the located volume beside the stoichiometric one',
      live.veq === `${live.m.veq.toFixed(2)} / ${live.m.veqFormula.toFixed(2)}`,
      live.veq);
  chk('and the two pH results beside their closed forms',
      live.half === `${live.m.halfPH.toFixed(3)} / ${live.m.pKa.toFixed(3)}`
      && live.eq === `${live.m.eqPH.toFixed(3)} / ${live.m.eqFormula.toFixed(3)}`,
      `${live.half} | ${live.eq}`);
  /*
   * The located volume and Cₐ·Vₐ/C_b agree to a fraction of a part per
   * million, so nothing printed from either can tell them apart — that is
   * the page's whole point rather than a hole here. The steepness is the
   * readout that can only have come from the measurement: no closed form
   * produces it, and it is fifty times larger for the strong acid than the
   * weak one at the same settings.
   */
  chk('the progress readout is the volume over the equivalence volume, and the pH is the solved one',
      live.pct === String(Math.round((12.5 / live.m.veq) * 100))
      && live.phTxt === live.ph.toFixed(2),
      `${live.pct}% at pH ${live.phTxt}`);

  const steep = await page.evaluate(async () => {
    const T = window.__titration;
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const grab = async () => {
      await settle();
      return { txt: document.getElementById('out-slope').textContent.trim(),
               m: T.measure(T.params()) };
    };
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const out = {};
    // Two acids, and then the same acid at a different concentration — one
    // pair alone could be matched by a constant that happened to be right.
    for (const key of ['acetic', 'hcl']) {
      T.selectAcid(key);
      set('acid-conc', 0.1); set('acid-vol', 25); set('base-conc', 0.1);
      out[key] = await grab();
    }
    T.selectAcid('acetic');
    set('acid-conc', 0.2); set('acid-vol', 10); set('base-conc', 0.2);
    out.acetic2 = await grab();
    return out;
  });
  const shown = (m) => (m.slope >= 1000 ? `${Math.round(m.slope / 100) / 10}k` : m.slope.toFixed(0));
  chk('and the steepness readout is the slope at the point that was located, wherever that is',
      steep.acetic.txt === shown(steep.acetic.m)
      && steep.hcl.txt === shown(steep.hcl.m)
      && steep.acetic2.txt === shown(steep.acetic2.m)
      && steep.acetic2.txt !== steep.acetic.txt
      && steep.hcl.m.slope > 30 * steep.acetic.m.slope,
      `weak ${steep.acetic.txt}, strong ${steep.hcl.txt}, `
      + `weak at 0.2 M ${steep.acetic2.txt} pH/mL`);

  const swapped = await page.evaluate(async () => {
    const T = window.__titration;
    T.selectAcid('hcl');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const half = document.getElementById('out-half-ph').textContent.trim();
    const eq = document.getElementById('out-eq-ph').textContent.trim();
    return { half, eq, m: T.measure(T.params()) };
  });
  chk('switching to the strong acid withdraws the pKa comparison and moves the equivalence pH to 7',
      swapped.half.endsWith('/ —') && swapped.eq.endsWith('/ 7.000'),
      `${swapped.half} | ${swapped.eq}`);

  const moved = await page.evaluate(async () => {
    const T = window.__titration;
    // Set every control this depends on rather than inheriting whatever the
    // previous block left behind — an ambient-state dependency is a check
    // that breaks when something unrelated moves, as this one just did.
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('acid-conc', 0.1); set('acid-vol', 25); set('base-conc', 0.05);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { txt: document.getElementById('out-veq').textContent.trim(),
             m: T.measure(T.params()) };
  });
  chk('and halving the base concentration doubles the located equivalence volume',
      Math.abs(moved.m.veq / 50 - 1) < 1e-5
      && moved.txt === `${moved.m.veq.toFixed(2)} / ${moved.m.veqFormula.toFixed(2)}`,
      `${moved.txt} mL`);
}

// ── Controls ─────────────────────────────────────────────────────────
{
  await page.goto(B, { waitUntil: 'networkidle' });
  const sig = async () => page.evaluate(() => JSON.stringify([
    ['acid-conc', 'acid-vol', 'base-conc', 'rate']
      .map((k) => document.getElementById(k + '-value')?.textContent),
    window.__titration.params(),
    window.__titration.acid(),
  ]));
  const dead = [];
  let before = await sig();
  for (const [id, v] of [['acid-conc', 0.15], ['acid-vol', 35],
                         ['base-conc', 0.06], ['rate', 2.5]]) {
    await page.$eval('#' + id, (el, val) => {
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
    const after = await sig();
    if (after === before) dead.push(id);
    before = after;
  }
  await page.click('#acid-list .mol-btn[data-key="acetic"]');
  if ((await sig()) === before) dead.push('acid');
  chk('every control changes the model it claims to', dead.length === 0, dead.join(','));

  await page.click('#start-btn');
  const ran = await page.evaluate(async () => {
    const T = window.__titration;
    const a = T.volume();
    await new Promise((r) => setTimeout(r, 400));
    return { a, b: T.volume(), running: T.isRunning() };
  });
  chk('Start pours titrant', ran.running && ran.b > ran.a, `${n(ran.a, 2)} → ${n(ran.b, 2)} mL`);

  await page.click('#reset-btn');
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    p: window.__titration.params(), v: window.__titration.volume(),
    acid: window.__titration.acid(), running: window.__titration.isRunning(),
  }));
  chk('Reset restores the defaults and empties the flask',
      after.v === 0 && !after.running && after.p.Ca === 0.1 && after.p.Va === 25
      && after.p.Cb === 0.1 && after.acid === 'hcl',
      JSON.stringify(after));
}

// ── Chrome ───────────────────────────────────────────────────────────
{
  const h1 = () => page.evaluate(() => document.querySelector('h1').textContent.trim());
  // Wait for the title to change rather than a fixed delay: the zh dictionary
  // is fetched on demand and a fixed wait races it.
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

await finish('titration');
