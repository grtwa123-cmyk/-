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

// ── Closed forms, evaluated in-page against the shipped model ──────────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    const P = { lam: 550e-9, N: 2, a: 20e-6, d: 100e-6, L: 2 };
    const out = {};
    out.centre = D.intensity(0, P);                          // must be 1
    // interference maxima at d sinθ = mλ must equal the envelope sinc² there
    out.maxima = [];
    for (let m = 1; m <= 6; m++) {
      const s = m * P.lam / P.d;
      const y = D.yOf(s, P.L);
      const al = Math.PI * P.a * s / P.lam;
      out.maxima.push({ m, got: D.intensity(y, P), want: (Math.sin(al)/al) ** 2 });
    }
    // envelope zeros at a sinθ = mλ
    out.zeros = [1,2,3].map(m => D.intensity(D.yOf(m * P.lam / P.a, P.L), P));
    // N = 2 must equal 4cos²β·sinc² / N²  (normalised)
    let worst = 0;
    for (let i = 1; i < 500; i++) {
      const y = (i/500) * 0.06;
      const s = D.sinTheta(y, P.L);
      const al = Math.PI*P.a*s/P.lam, be = Math.PI*P.d*s/P.lam;
      const want = (Math.sin(al)/al)**2 * 4*Math.cos(be)**2 / 4;
      worst = Math.max(worst, Math.abs(D.intensity(y, P) - want));
    }
    out.twoSlit = worst;
    // N = 1 must be pure sinc²
    let w1 = 0;
    const S = { ...P, N: 1 };
    for (let i = 1; i < 500; i++) {
      const y = (i/500) * 0.12;
      const s = D.sinTheta(y, P.L);
      const al = Math.PI*P.a*s/P.lam;
      w1 = Math.max(w1, Math.abs(D.intensity(y, S) - (Math.sin(al)/al)**2));
    }
    out.oneSlit = w1;
    // principal maxima height is N² before normalising -> 1 after, times envelope
    out.principal = [3,5,8,10].map(N => {
      const Q = { ...P, N };
      const s = P.lam / P.d, y = D.yOf(s, P.L);
      const al = Math.PI*P.a*s/P.lam;
      return { N, got: D.intensity(y, Q), want: (Math.sin(al)/al)**2 };
    });
    // N-1 zeros between neighbouring principal maxima
    out.zerosBetween = [3,5,8].map(N => {
      const Q = { ...P, N };
      let count = 0;
      for (let k = 1; k < N; k++) {
        const beta = Math.PI * k / N;                 // sin(Nβ)=0, sin(β)≠0
        const s = beta * P.lam / (Math.PI * P.d);
        const v = D.intensity(D.yOf(s, P.L), Q);
        if (v < 1e-20) count++;
      }
      return { N, count, want: N - 1 };
    });
    // missing orders for integer d/a
    out.missing = [2,3,4,5].map(p => {
      const Q = { ...P, a: P.d / p };
      return { p, orders: D.missingOrders(Q) };
    });
    // fringe spacing vs λL/d
    out.spacing = { got: D.fringeSpacing(P), small: P.lam * P.L / P.d };
    out.envZero = { got: D.envelopeZero(P), small: P.lam * P.L / P.a };
    // exact geometry, not the small-angle shortcut
    out.exactGeom = D.sinTheta(0.06, 2) - 0.06/Math.hypot(0.06,2);
    return out;
  });

  chk('centre intensity is exactly 1 after normalising', Math.abs(r.centre-1) < 1e-12, String(r.centre));
  chk('interference maxima (d·sinθ = mλ) sit exactly on the envelope',
      r.maxima.every(x => Math.abs(x.got - x.want) < 1e-12),
      r.maxima.map(x=>`m${x.m}:${x.got.toExponential(2)}`).join(' '));
  chk('envelope zeros (a·sinθ = mλ) are zero', r.zeros.every(v => v < 1e-24),
      r.zeros.map(v=>v.toExponential(1)).join(' '));
  chk('N=2 reduces to 4cos²β·sinc² over 500 points', r.twoSlit < 1e-15, r.twoSlit.toExponential(2));
  chk('N=1 reduces to pure sinc² over 500 points', r.oneSlit < 1e-15, r.oneSlit.toExponential(2));
  chk('principal maxima reach the envelope for N = 3,5,8,10',
      r.principal.every(x => Math.abs(x.got - x.want) < 1e-12),
      r.principal.map(x=>`N${x.N}:${x.got.toFixed(6)}`).join(' '));
  chk('N−1 zeros between neighbouring maxima (N = 3,5,8)',
      r.zerosBetween.every(x => x.count === x.want),
      r.zerosBetween.map(x=>`N${x.N}:${x.count}/${x.want}`).join(' '));
  chk('missing orders are the multiples of d/a',
      r.missing.every(({p,orders}) => orders.length>0 && orders.every(m => m % p === 0)),
      r.missing.map(x=>`d/a=${x.p}→${x.orders.join(',')}`).join('  '));
  chk('fringe spacing matches λL/d to 0.01%',
      Math.abs(r.spacing.got - r.spacing.small)/r.spacing.small < 1e-4,
      `${(r.spacing.got*1000).toFixed(4)} vs ${(r.spacing.small*1000).toFixed(4)} mm`);
  chk('envelope zero matches λL/a to 0.1%',
      Math.abs(r.envZero.got - r.envZero.small)/r.envZero.small < 1e-3,
      `${(r.envZero.got*1000).toFixed(3)} vs ${(r.envZero.small*1000).toFixed(3)} mm`);
  chk('sinθ uses the exact geometry, not the small-angle shortcut',
      Math.abs(r.exactGeom) < 1e-18, r.exactGeom.toExponential(2));
}

// ── Photon sampling really follows the curve ───────────────────────────
{
  const r = await page.evaluate(() => {
    const D = window.__diff;
    const P = { lam: 550e-9, N: 2, a: 20e-6, d: 100e-6, L: 2 };
    const half = D.viewHalf(P);
    const BINS = 40, NPH = 40000;
    const hist = new Array(BINS).fill(0);
    let kept = 0;
    for (let i = 0; i < NPH; i++) {
      const y = D.samplePhoton(P, half);
      if (y === null) continue;
      kept++;
      hist[Math.min(BINS-1, Math.floor(((y+half)/(2*half))*BINS))]++;
    }
    // expected share of each bin from the true intensity
    const exp = new Array(BINS).fill(0);
    let tot = 0;
    for (let b = 0; b < BINS; b++) {
      let s = 0;
      for (let k = 0; k < 200; k++) {
        const y = (-half) + ((b + k/200) / BINS) * 2*half;
        s += D.intensity(y, P);
      }
      exp[b] = s / 200; tot += exp[b];
    }
    let worst = 0;
    for (let b = 0; b < BINS; b++) {
      const obs = hist[b] / kept, want = exp[b] / tot;
      worst = Math.max(worst, Math.abs(obs - want));
    }
    return { worst, kept };
  });
  chk('sampled photons reproduce the intensity curve (40 bins, 40k photons)',
      r.worst < 0.006, `max bin error ${r.worst.toFixed(5)} over ${r.kept} photons`);
}

// ── UI ────────────────────────────────────────────────────────────────
{
  await setV('wavelength',550); await setV('slits',2); await setV('width',20);
  await setV('sep',100); await setV('dist',2);
  await page.waitForTimeout(300);
  const sp = parseFloat(await txt('out-spacing'));
  chk('readout: Δy = 11.00 mm at 550 nm / 100 µm / 2 m', Math.abs(sp-11.00)<0.02, String(sp));
  chk('readout: envelope zero = 55.02 mm',
      Math.abs(parseFloat(await txt('out-envelope'))-55.02)<0.05, await txt('out-envelope'));
  chk('readout: 9 fringes in the envelope at d/a = 5',
      (await txt('out-fringes'))==='9', await txt('out-fringes'));
  chk('readout: missing orders ±5, ±10 at d/a = 5',
      /^±5,±10(…)?$/.test((await txt('out-missing')).replace(/\s/g,'')), await txt('out-missing'));
  chk('readout: first-order angle = 0.315°',
      Math.abs(parseFloat(await txt('out-angle'))-0.315)<0.002, await txt('out-angle'));

  await setV('width',25); await page.waitForTimeout(250);   // d/a = 4
  chk('changing a to give d/a = 4 renames the missing orders',
      /^±4,±8(…)?$/.test((await txt('out-missing')).replace(/\s/g,'')), await txt('out-missing'));

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
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(500);
  const snap = () => page.evaluate(()=>{
    const p = window.__diff.params();
    return JSON.stringify([p.lam,p.N,p.a,p.d,p.L,
      document.getElementById('out-spacing').textContent,
      document.getElementById('out-envelope').textContent,
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
