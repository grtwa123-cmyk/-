import { browser, chk, rows, url, BASE as BASE_URL, finish } from '../lib/harness.mjs';

const B = url('experiments/resonance.html');

const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(600);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// ── Closed forms ──────────────────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const R = window.__res, o = {};
    // phase is exactly 90° at r = 1, for every damping there is
    o.phase90 = [0.02,0.1,0.3,0.7071,1,1.5].map(z =>
      Math.abs(R.phaseLag(1, z) * 180/Math.PI - 90));
    // A(ω₀) = Q exactly
    o.gainAtF0 = [0.02,0.05,0.15,0.5,1.2].map(z =>
      Math.abs(R.gain(1, z) - R.qFactor(z)));
    // peak position and height against the closed forms
    o.peaks = [0.02,0.05,0.2,0.5,0.68].map(z => {
      let best = 0, br = 0;
      for (let i = 1; i <= 300000; i++) { const rr = i/100000; const g = R.gain(rr, z);
        if (g > best) { best = g; br = rr; } }
      return { z, br, best, wantR: R.peakRatio(z), wantG: R.peakGain(z) };
    });
    // no peak at all past 1/√2
    o.noPeak = [0.7072, 0.9, 1.2, 1.5].map(z => R.peakRatio(z));
    // velocity resonance sits exactly at r = 1 whatever the damping
    o.velPeaks = [0.05,0.3,0.9,1.5].map(z => {
      let best = 0, br = 0;
      for (let i = 1; i <= 300000; i++) { const rr = i/100000; const v = rr*R.gain(rr, z);
        if (v > best) { best = v; br = rr; } }
      return { z, br };
    });
    // half-power width gives Q back
    o.fwhm = [0.02,0.05,0.1].map(z => {
      const half = R.gain(1,z)/Math.SQRT2, f = rr => R.gain(rr,z) - half;
      let lo=1e-4, hi=1; for (let i=0;i<200;i++){const m=(lo+hi)/2; f(m)<0?lo=m:hi=m;} const r1=(lo+hi)/2;
      lo=1; hi=5; for (let i=0;i<200;i++){const m=(lo+hi)/2; f(m)>0?lo=m:hi=m;} const r2=(lo+hi)/2;
      return { z, q: 1/(r2-r1), want: R.qFactor(z) };
    });
    // static limit
    o.static = [0.05,0.5,1.2].map(z => Math.abs(R.gain(0, z) - 1));
    return o;
  });
  chk('phase lag is exactly 90° at f₀ for every damping',
      r.phase90.every(d => d < 1e-12), r.phase90.map(d=>d.toExponential(1)).join(' '));
  chk('A(f₀)/X₀ = Q exactly', r.gainAtF0.every(d => d < 1e-14),
      r.gainAtF0.map(d=>d.toExponential(1)).join(' '));
  chk('amplitude peaks at √(1−2ζ²) with height 1/(2ζ√(1−ζ²))',
      r.peaks.every(x => Math.abs(x.br - x.wantR) < 2e-5 && Math.abs(x.best - x.wantG) < 1e-6),
      r.peaks.map(x=>`ζ${x.z}:${x.br.toFixed(5)}/${x.wantR.toFixed(5)}`).join(' '));
  chk('no amplitude peak once ζ ≥ 1/√2', r.noPeak.every(v => !Number.isFinite(v)),
      r.noPeak.join(','));
  chk('velocity resonance sits exactly at f₀ for every damping',
      r.velPeaks.every(x => Math.abs(x.br - 1) < 2e-5),
      r.velPeaks.map(x=>`ζ${x.z}:${x.br.toFixed(5)}`).join(' '));
  // Q = ω₀/Δω is asymptotic in light damping, not exact, so the honest check
  // is that it converges: the error must shrink as the damping does.
  {
    const e = r.fwhm.map(x => Math.abs(x.q - x.want)/x.want);
    chk('half-power width returns Q = ω₀/Δω, converging as damping falls',
        e[0] < 2e-3 && e[0] < e[1] && e[1] < e[2],
        r.fwhm.map((x,i)=>`ζ${x.z}:${x.q.toFixed(3)}/${x.want} (${(e[i]*100).toFixed(2)}%)`).join('  '));
  }
  chk('static limit A(0) = X₀', r.static.every(d => d < 1e-15), '');
}

// ── The integrator must reproduce the closed form ──────────────────────
{
  const r = await page.evaluate(async () => {
    const R = window.__res;
    R.setRunning(false);
    const results = [];
    for (const [f0, f, z] of [[1,0.6,0.15],[1,1,0.15],[1,1,0.05],[1,1.6,0.3],
                              [1.4,1.4,0.08],[1,0.997,0.05],[1,2.5,0.5],[1,1,1.0]]) {
      // drive the model directly, far past the transient
      R.reset();
      const p = { f0, f, w0: 2*Math.PI*f0, w: 2*Math.PI*f, z, X0: 1 };
      const settle = 12 / (z * p.w0) + 30 / p.w;      // several time constants
      const step = 1/240;
      for (let t = 0; t < settle; t += step) R.integrate(step, p);
      // one more clean measurement window
      for (let t = 0; t < 3/f; t += step) R.integrate(step, p);
      const st = R.state();
      results.push({ f0, f, z, meas: st.measA, measPhi: st.measPhi*180/Math.PI,
                     want: R.gain(f/f0, z), wantPhi: R.phaseLag(f/f0, z)*180/Math.PI });
    }
    R.reset();
    R.setRunning(true);
    return results;
  });
  const worstA = Math.max(...r.map(x => Math.abs(x.meas - x.want)/x.want));
  const worstP = Math.max(...r.map(x => Math.abs(x.measPhi - x.wantPhi)));
  chk('RK4 amplitude, measured back out of the motion, matches A(ω) (8 configurations)',
      worstA < 2e-3, `worst relative error ${(worstA*100).toExponential(2)} %`);
  chk('RK4 phase, measured back out of the motion, matches φ(ω)',
      worstP < 0.3, `worst ${worstP.toFixed(4)}°`);
  const atRes = r.find(x => x.f0===1 && x.f===1 && x.z===0.05);
  chk('at resonance with ζ = 0.05 the measured gain is Q = 10',
      Math.abs(atRes.meas - 10)/10 < 3e-3, `measured ${atRes.meas.toFixed(4)} vs 10`);
  const at90 = r.find(x => x.f0===1 && x.f===1 && x.z===0.15);
  chk('the measured phase at f₀ is 90°', Math.abs(at90.measPhi - 90) < 0.3,
      `${at90.measPhi.toFixed(4)}°`);
}

// ── UI ────────────────────────────────────────────────────────────────
{
  // A clean page, not a reload: the controls now live in the query string,
  // so reloading would bring back whatever the last section left set.
  await page.goto(B, { waitUntil:'networkidle' }); await page.waitForTimeout(400);
  await setV('natural',1); await setV('drive',1); await setV('zeta',0.05); await setV('static',1);
  await page.waitForTimeout(250);
  chk('readout: A/X₀ = 10.000 at resonance with ζ = 0.05',
      (await txt('out-amp'))==='10.000', await txt('out-amp'));
  chk('readout: φ = 90.0° at f₀', (await txt('out-phase'))==='90.0', await txt('out-phase'));
  chk('readout: Q = 10.00', (await txt('out-q'))==='10.00', await txt('out-q'));
  chk('readout: resonant frequency = 0.997 Hz (below f₀)',
      (await txt('out-peak'))==='0.997', await txt('out-peak'));
  await setV('zeta',1.0); await page.waitForTimeout(250);
  chk('readout: no resonant frequency once ζ ≥ 1/√2',
      !/\d/.test(await txt('out-peak')), await txt('out-peak'));
  await setV('zeta',0.15); await page.waitForTimeout(250);

  // the measurement should settle onto the theory on its own
  await setV('drive',0.6); await page.waitForTimeout(200);
  await page.waitForFunction(() => {
    const t = document.getElementById('out-error').textContent;
    return /%$/.test(t);
  }, { timeout: 30000 }).catch(()=>{});
  // The residual keeps falling as the transient dies, so the honest check is
  // that it converges — poll until it is small rather than sampling once.
  await page.waitForFunction(() => {
    const t = document.getElementById('out-error').textContent;
    const m = t.match(/^([\d.e+-]+)\s*%$/);
    return m && parseFloat(m[1]) < 0.3;
  }, { timeout: 60000 }).catch(()=>{});
  const err = await txt('out-error');
  const measured = parseFloat(await txt('out-measured'));
  const theory = parseFloat(await txt('out-amp'));
  chk('the live measurement converges onto the theory curve',
      /%$/.test(err) && parseFloat(err) < 0.3 && Math.abs(measured - theory)/theory < 3e-3,
      `measured ${measured} vs theory ${theory}, error readout "${err}"`);
}
{
  await page.click('#tune-btn'); await page.waitForTimeout(300);
  const f = parseFloat(await txt('drive-value'));
  const peak = parseFloat(await txt('out-peak'));
  chk('"Tune to resonance" moves the drive onto the peak', Math.abs(f - peak) < 0.011,
      `f=${f} peak=${peak}`);
}
{
  const snap = () => page.evaluate(()=>{
    const p = window.__res.params();
    return JSON.stringify([p.f0,p.f,p.z,p.X0,
      document.getElementById('out-amp').textContent,
      document.getElementById('out-q').textContent,
      document.getElementById('pause-btn').textContent]); });
  const dead = [];
  const acts = [
    ['natural', () => setV('natural',1.5)],
    ['drive', () => setV('drive',2.2)],
    ['zeta', () => setV('zeta',0.4)],
    ['static', () => setV('static',2.5)],
    ['preset light', () => page.click('#preset-list .mol-btn[data-key="light"]')],
    ['pause', () => page.click('#pause-btn')],
  ];
  for (const [name, act] of acts) {
    const b = await snap(); await act(); await page.waitForTimeout(200);
    if (await snap() === b) dead.push(name);
  }
  chk('no dead controls', dead.length===0, dead.join(','));
  await page.click('#reset-btn'); await page.waitForTimeout(200);
}
{
  const g = () => page.evaluate(()=>window.__res.state().t);
  await page.click('#reset-btn'); await page.waitForTimeout(150);
  const a = await g(); await page.waitForTimeout(700); const b = await g();
  await page.click('#pause-btn'); await page.waitForTimeout(200);
  const c = await g(); await page.waitForTimeout(700); const d = await g();
  await page.click('#pause-btn');
  chk('Pause actually stops the integration', b>a && Math.abs(d-c)<1e-9,
      `${a.toFixed(2)}→${b.toFixed(2)} then ${c.toFixed(2)}→${d.toFixed(2)}`);
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
  const a = await shot(); await page.waitForTimeout(600); const b = await shot();
  chk('canvas animates', a!==b && a.length>3000, `len ${a.length}`);
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


await finish('Resonance');
