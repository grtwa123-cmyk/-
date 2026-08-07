/*
 * Diffraction from N slits.
 *
 * The page is given Huygens' principle and nothing else: every point of every
 * open slit radiates in phase, and the amplitude toward a direction is the sum
 * of them all. Because the slits are alike that double sum separates into one
 * slit's own sum times the sum over slit centres, and both are added term by
 * term — the closed form (sin α/α)²(sin Nβ/sin β)² appears nowhere in the file.
 *
 * So these checks hold the *located* peaks to the grating equation rather than
 * assuming it, and hold the page honest about two things it cannot help:
 * the single-slit envelope drags every maximum off d·sinθ = mλ by an amount
 * that dies as 1/N², and the far field is an assumption whose cost the page
 * has to measure rather than assert.
 */

import { browser, chk, rows, url, BASE as BASE_URL, finish } from '../lib/harness.mjs';

const B = url('experiments/diffraction.html');

const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(700);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// ── The sum has actually converged ─────────────────────────────────────
{
  // A midpoint sum over the aperture is second order in the sample count, so
  // each doubling should quarter the change. If it did not, the "sum" would be
  // a discretisation artefact dressed up as physics.
  const r = await page.evaluate(() => {
    const D = window.__diff;
    const p = { ...D.params(), N: 4 };
    const half = 6 * D.fringeSpacing(p);
    const at = (M) => {
      const out = [];
      for (let i = 0; i < 1200; i++) {
        const y = -half + (2 * half * i) / 1199;
        out.push(D.intensityAt(D.sinTheta(y, p.L), p, M));
      }
      return out;
    };
    const steps = [12, 24, 48, 96, 192].map(at);
    const d = [];
    for (let i = 1; i < steps.length; i++) {
      let w = 0;
      for (let j = 0; j < steps[i].length; j++) w = Math.max(w, Math.abs(steps[i][j] - steps[i - 1][j]));
      d.push(w);
    }
    return { d, M: D.slitSamples(p, D.sinTheta(half, p.L)) };
  });
  const ratios = r.d.slice(1).map((v, i) => r.d[i] / v);
  chk('the aperture sum is converged — each doubling quarters the change',
      ratios.every((q) => q > 3.6 && q < 4.4) && r.d[r.d.length - 1] < 1e-4,
      `${r.d.map((v) => v.toExponential(2)).join(' → ')}  (ratios ${ratios.map((q) => q.toFixed(2)).join(', ')})`);
  chk('and the page picks a sample count on the converged side of that',
      r.M >= 24, `${r.M} points across each slit`);
}

// ── It reproduces the closed form it never uses ────────────────────────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    // The textbook expression, written here in the checks — the page has no
    // such line, which is the point of the grep further down.
    const closed = (y, p) => {
      const s = D.sinTheta(y, p.L);
      const al = (Math.PI * p.a * s) / p.lam, be = (Math.PI * p.d * s) / p.lam;
      const sinc = al === 0 ? 1 : Math.sin(al) / al;
      let g = 1;
      if (p.N > 1) { const sb = Math.sin(be); g = Math.abs(sb) < 1e-12 ? p.N : Math.sin(p.N * be) / sb; }
      return (sinc * sinc * g * g) / (p.N * p.N);
    };
    const out = [];
    for (const o of [{}, { N: 1 }, { N: 10 }, { N: 6, d: 300e-6, a: 60e-6 },
                     { lam: 380e-9 }, { lam: 750e-9, a: 5e-6 }, { L: 0.5 },
                     { a: 100e-6, d: 400e-6, N: 4 }]) {
      const p = { ...D.params(), ...o };
      const half = 6 * D.fringeSpacing(p);
      let worst = 0;
      for (let i = 0; i < 2400; i++) {
        const y = -half + (2 * half * i) / 2399;
        worst = Math.max(worst, Math.abs(D.intensityAt(D.sinTheta(y, p.L), p, 128) - closed(y, p)));
      }
      out.push({ N: p.N, worst });
    }
    return out;
  });
  const worst = Math.max(...r.map((x) => x.worst));
  chk(`the summed pattern is the closed form, to the sum's own resolution — ${r.length} geometries`,
      worst < 3e-5, `worst |ΔI| = ${worst.toExponential(2)} over 19200 points`);
}

// ── The grating equation, measured off the peaks that were found ───────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    return [2, 3, 4, 5, 6, 8, 10].map((N) => {
      const m = D.measure({ ...D.params(), N, a: 10e-6 });
      return { N, dev: m.orderDev, between: m.between, orders: m.orders.length,
               fwhmN: (N * m.fwhm) / m.approxSpacing,
               spacing: m.spacing, approx: m.approxSpacing };
    });
  });
  chk('every located principal maximum is within a tenth of an order of the one it belongs to',
      r.every((x) => x.dev < 0.05 && x.orders >= 4),
      r.map((x) => `N${x.N}: ${x.dev.toExponential(1)}`).join(', '));

  // The displacement is the envelope leaning on the peak, so it dies as the
  // peak narrows: N²·dev is flat where a power law of any other index is not.
  const flat = r.slice(2).map((x) => x.N * x.N * x.dev);
  const lo = Math.min(...flat), hi = Math.max(...flat);
  chk('and the displacement dies as 1/N² — N²·dev is constant to a few percent',
      (hi - lo) / lo < 0.12 && r[0].dev / r[6].dev > 15,
      `N²·dev = ${flat.map((v) => v.toFixed(3)).join(', ')};  N=2 is ${(r[0].dev / r[6].dev).toFixed(0)}× worse than N=10`);

  chk('the subsidiary maxima between neighbours are counted, and there are N−2',
      r.every((x) => x.between === x.N - 2),
      r.map((x) => `N${x.N}:${x.between}`).join(' '));

  // N·FWHM/(λL/d) → 0.886. N=2 is a cos² pattern and sits at exactly 1.
  chk('the principal maxima narrow as 1/N, settling at 0.886 λL/d',
      Math.abs(r[0].fwhmN - 1) < 0.01 && Math.abs(r[6].fwhmN - 0.886) < 0.01
      && r.slice(1).every((x, i) => x.fwhmN <= r[i].fwhmN + 1e-9),
      r.map((x) => `N${x.N}:${x.fwhmN.toFixed(4)}`).join(' '));

  chk('and the measured spacing closes on λL/d as they do',
      Math.abs(r[6].spacing / r[6].approx - 1) < Math.abs(r[0].spacing / r[0].approx - 1) / 8,
      `N=2 is ${((r[0].spacing / r[0].approx - 1) * 100).toFixed(2)}% off, `
      + `N=10 is ${((r[6].spacing / r[6].approx - 1) * 100).toFixed(3)}%`);
}

// ── The envelope, measured off the same aperture with one slit open ────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    return [[20, 2], [50, 2], [100, 2], [10, 2], [20, 0.5], [20, 5], [5, 3]].map(([a, L]) => {
      const m = D.measure({ ...D.params(), N: 1, a: a * 1e-6, L });
      return { a, L, got: m.envZero, want: m.approxEnvZero };
    });
  });
  const worst = Math.max(...r.map((x) => Math.abs(x.got / x.want - 1)));
  chk(`the first envelope zero is found where a·sinθ = λ puts it — ${r.length} geometries`,
      r.every((x) => Number.isFinite(x.got)) && worst < 1e-4,
      `worst ${(worst * 100).toExponential(2)}%`);
}

// ── Missing orders, decided by measuring the envelope ──────────────────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    return [[20, 100], [25, 100], [50, 100], [20, 60], [30, 100], [35, 100], [33, 100]]
      .map(([a, d]) => {
        const m = D.measure({ ...D.params(), a: a * 1e-6, d: d * 1e-6, N: 4 });
        const rule = [];
        for (let q = 1; q <= D.ORDERS; q++) {
          const t = (q * a) / d;
          if (Math.abs(t - Math.round(t)) < 1e-9 && t >= 1) rule.push(q);
        }
        return { a, d, missing: m.missing, rule, fringes: m.inEnvelope };
      });
  });
  const exact = r.filter((x) => x.rule.length);
  chk('where d/a is a whole number the measured collapse names exactly those orders',
      exact.length >= 4 && exact.every((x) => x.missing.join() === x.rule.join()),
      exact.map((x) => `d/a=${(x.d / x.a).toFixed(0)}: ${x.missing.join(',')}`).join('  '));
  chk('and the count of fringes inside the envelope follows from it',
      exact.every((x) => x.fringes === 2 * Math.round(x.d / x.a) - 1),
      exact.map((x) => `d/a=${(x.d / x.a).toFixed(0)}: ${x.fringes}`).join('  '));
  // 2.86 and 3.33 are far enough from a whole number to leave every order
  // standing; 3.03 is not, and the measurement says so where the rule cannot.
  const near = r.find((x) => x.a === 33);
  chk('a near-miss ratio still loses the order, which the whole-number rule cannot say',
      near.rule.length === 0 && near.missing.length > 0
      && r.find((x) => x.a === 35).missing.length === 0
      && r.find((x) => x.a === 30).missing.length === 0,
      `d/a = 3.03 loses ${near.missing.join(',')}; 2.86 and 3.33 lose nothing`);
}

// ── The far field is an assumption, and the page prices it ─────────────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    return [{ N: 2 }, { N: 4 }, { N: 6, d: 200e-6 }, { N: 10 },
            { N: 10, d: 400e-6, L: 0.5 }].map((o) => {
      const p = { ...D.params(), ...o };
      const span = (p.N - 1) * p.d + p.a;
      return { N: p.N, d: p.d, span2: (span * span) / (p.lam * p.L), gap: D.measure(p).gap };
    });
  });
  chk('at the defaults the far-field sum and the exact one agree to a part in 10⁴',
      r[0].gap < 2e-4, `${(r[0].gap * 100).toFixed(4)}% of the peak`);
  // Ordered by how much of the screen distance the aperture spans, which is
  // what governs it — not by N. Ten slits 100 µm apart are a smaller aperture
  // than six slits 200 µm apart, and the gap follows the aperture.
  const byspan = [...r].sort((x, z) => x.span2 - z.span2);
  chk('and the gap grows with the span of the aperture, so the readout is worth reading',
      byspan.every((x, i) => i === 0 || x.gap > byspan[i - 1].gap)
      && byspan[byspan.length - 1].gap > 0.3,
      byspan.map((x) => `span²/λL=${x.span2.toFixed(2)} → ${(x.gap * 100).toFixed(3)}%`).join(', '));
}

// ── Photon sampling really follows the curve ───────────────────────────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    const P = { lam: 550e-9, N: 2, a: 20e-6, d: 100e-6, L: 2 };
    const half = D.viewHalf(P);
    const COLS = 700;
    const BINS = 40, NPH = 40000;
    const hist = new Array(BINS).fill(0);
    let kept = 0;
    for (let i = 0; i < NPH; i++) {
      const y = D.samplePhoton(P, half, COLS);
      if (y === null) continue;
      kept++;
      hist[Math.min(BINS-1, Math.floor(((y+half)/(2*half))*BINS))]++;
    }
    /*
     * What each bin should hold, taken off the same scanned profile the dots
     * are rejection-sampled against — so this checks the sampler, not the
     * optics, which the checks above already cover.
     *
     * A column is a uniform interval, not a point, and 700 columns do not
     * divide into 40 bins: a column that straddles a bin edge has to give
     * each side its share. Assigning the whole column to whichever bin holds
     * its centre biases the answer by more than the counting noise does.
     */
    const pr = D.profile(P, half, COLS);
    const exp = new Array(BINS).fill(0);
    let tot = 0;
    const binOf = (y) => ((y + half) / (2 * half)) * BINS;
    for (let c = 0; c < COLS; c++) {
      const w = pr.full[c];
      if (w <= 0) continue;
      tot += w;
      let lo = binOf((c / (COLS - 1)) * 2 * half - half);
      let hi = binOf(((c + 1) / (COLS - 1)) * 2 * half - half);
      lo = Math.max(0, Math.min(BINS, lo)); hi = Math.max(0, Math.min(BINS, hi));
      if (hi <= lo) { exp[Math.min(BINS - 1, Math.floor(lo))] += w; continue; }
      for (let b = Math.floor(lo); b < Math.min(BINS, Math.ceil(hi)); b++) {
        const ov = Math.min(hi, b + 1) - Math.max(lo, b);
        if (ov > 0) exp[b] += (w * ov) / (hi - lo);
      }
    }
    // The bound comes out of the run: each bin is a binomial draw, so five
    // standard errors of the largest share is what "agrees" means here.
    let worst = 0, bound = 0;
    for (let b = 0; b < BINS; b++) {
      const want = exp[b] / tot;
      worst = Math.max(worst, Math.abs(hist[b] / kept - want));
      bound = Math.max(bound, 5 * Math.sqrt((want * (1 - want)) / kept));
    }
    return { worst, bound, kept };
  });
  chk('sampled photons reproduce the profile they are drawn from (40 bins, 40k photons)',
      r.worst < r.bound,
      `max bin error ${r.worst.toExponential(2)} against a 5σ bound of ${r.bound.toExponential(2)}, `
      + `${r.kept} photons`);
}

// ── UI ────────────────────────────────────────────────────────────────
{
  await setV('wavelength',550); await setV('slits',2); await setV('width',20);
  await setV('sep',100); await setV('dist',2);
  await page.waitForTimeout(300);
  const live = await page.evaluate(() => {
    const m = window.__diff.measure(window.__diff.params());
    return { spacing: m.spacing, approx: m.approxSpacing, env: m.envZero,
             envApprox: m.approxEnvZero, dev: m.orderDev, between: m.between, gap: m.gap };
  });
  const sp = await txt('out-spacing');
  chk('the fringe-spacing readout is the measured gap, with λL/d beside it',
      /^\d+\.\d{3} \/ \d+\.\d{3} \([-+]\d+\.\d{2}%\)$/.test(sp)
      && Math.abs(parseFloat(sp) - live.spacing * 1000) < 0.002
      && Math.abs(live.spacing * 1000 - 10.852) < 0.01, sp);
  const env = await txt('out-envelope');
  chk('and the envelope readout is the measured zero, with λL/a beside it',
      /^\d+\.\d{3} \/ \d+\.\d{3} \([-+]?\d+\.\d{2}%\)$/.test(env)
      && Math.abs(parseFloat(env) - live.env * 1000) < 0.002
      && Math.abs(live.env * 1000 - 55.021) < 0.01, env);
  chk('readout: 9 fringes counted in the envelope at d/a = 5',
      (await txt('out-fringes'))==='9', await txt('out-fringes'));
  chk('readout: order 5 is the one the envelope switched off',
      (await txt('out-missing')).replace(/\s/g,'')==='±5', await txt('out-missing'));
  const ord = await txt('out-order');
  chk('the grating-equation readout carries the measured displacement and the count',
      /^\d\.\de[-+]\d\s+·\s+0\s+×/.test(ord)
      && Math.abs(parseFloat(ord) - live.dev) < live.dev * 0.05, ord);
  const ff = await txt('out-farfield');
  chk('and the far-field readout is the measured disagreement',
      /^\d+\.\d+%$/.test(ff) && Math.abs(parseFloat(ff) - live.gap * 100) < 0.0002, ff);

  await setV('width',25); await page.waitForTimeout(250);   // d/a = 4
  chk('changing a to give d/a = 4 renames the missing order',
      (await txt('out-missing')).replace(/\s/g,'')==='±4', await txt('out-missing'));

  await setV('slits',1); await page.waitForTimeout(250);
  const sepHidden = await page.evaluate(()=>document.getElementById('sep-control').hidden);
  chk('single slit hides the separation control and its fringe readouts',
      sepHidden && (await txt('out-spacing'))==='—', `hidden=${sepHidden}`);
  await setV('slits',2);
}
{
  // slits cannot overlap: d is clamped above a
  await setV('sep',20); await setV('width',100); await page.waitForTimeout(300);
  const r = await page.evaluate(()=>{ const p = window.__diff.params();
    return { a: p.a*1e6, d: p.d*1e6, slider: parseFloat(document.getElementById('sep').value) }; });
  chk('slit separation is clamped so the slits cannot overlap', r.d > r.a,
      `a=${r.a}µm d=${r.d}µm slider=${r.slider}`);
  await page.click('#reset-btn'); await page.waitForTimeout(300);
}
{
  await page.click('#reset-btn'); await page.waitForTimeout(200);
  const before = parseInt((await txt('out-photons')).replace(/,/g,''),10);
  await page.$eval('#photons-on', e=>{ e.checked = true; e.dispatchEvent(new Event('change',{bubbles:true})); });
  await page.waitForTimeout(2200);
  const after = parseInt((await txt('out-photons')).replace(/,/g,''),10);
  chk('photon counter accumulates when switched on', before===0 && after>200, `${before} → ${after}`);
  const rateShown = await page.evaluate(()=>!document.getElementById('rate-control').hidden);
  chk('rate control appears with the photon counter', rateShown);
  await setV('wavelength', 460); await page.waitForTimeout(300);
  const reset = parseInt((await txt('out-photons')).replace(/,/g,''),10);
  chk('changing the optics discards photons drawn from the old curve', reset < after, `${after} → ${reset}`);
  await page.$eval('#photons-on', e=>{ e.checked = false; e.dispatchEvent(new Event('change',{bubbles:true})); });
}
{
  // no dead controls
  // A clean page, not a reload: the controls now live in the query string,
  // so reloading would bring back whatever the last section left set.
  await page.goto(B, { waitUntil:'networkidle' }); await page.waitForTimeout(500);
  const snap = () => page.evaluate(()=>{
    const p = window.__diff.params();
    return JSON.stringify([p.lam,p.N,p.a,p.d,p.L,
      document.getElementById('out-spacing').textContent,
      document.getElementById('out-envelope').textContent,
      document.getElementById('out-order').textContent,
      document.getElementById('out-farfield').textContent,
      document.getElementById('rate-value').textContent]); });
  const dead = [];
  for (const [id, v] of [['wavelength',700],['slits',6],['width',40],['sep',300],['dist',4],['rate',2000]]) {
    const b = await snap(); await setV(id, v); await page.waitForTimeout(180);
    if (await snap() === b) dead.push(id);
  }
  chk('no dead controls', dead.length===0, dead.join(','));
}
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(350);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(350);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(350);
  chk('title translates en/ko/zh and returns', ko!==en && zh!==en && zh!==ko && (await h1())===en,
      `${en} | ${ko} | ${zh}`);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}
{
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot();
  await setV('slits', 7); await page.waitForTimeout(400);
  const b = await shot();
  chk('canvas repaints when the optics change', a!==b && a.length>3000, `len ${a.length}/${b.length}`);
}
{
  chk('the page badges itself as measured and verified',
      await page.$('.method-tag[data-method="measured"]') !== null
      && await page.$('.method-verified') !== null);

  const src = await page.evaluate(async (u) => (await fetch(u)).text(), url('experiments/diffraction.js'));
  const sinc = /Math\.sin\s*\(\s*(al|alpha)[^)]*\)\s*\//.test(src);
  const grating = /Math\.sin\s*\([^)]*N[^)]*\)\s*\/\s*Math\.sin/.test(src);
  chk('neither closed form is in the source — the pattern is only ever summed',
      !sinc && !grating,
      `sinc ${sinc ? 'present' : 'absent'}, sin Nβ/sin β ${grating ? 'present' : 'absent'}`);

  chk('no console errors after the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));
}
await page.close();

for (const w of [320, 390, 768]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await p.close();
}


await finish('Diffraction');
