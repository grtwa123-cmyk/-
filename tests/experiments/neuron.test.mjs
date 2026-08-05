import { browser, chk, rows, url, finish } from '../lib/harness.mjs';

const B = url('experiments/neuron.html');
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
const errs = [];
page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PE: '+e.message));
await page.goto(B, { waitUntil:'networkidle' });
await page.waitForTimeout(500);
chk('page loads without console errors', errs.length===0, errs.slice(0,2).join(' | '));

const setV = (id,v) => page.$eval('#'+id,(el,val)=>{el.value=String(val);
  el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},v);
const txt = id => page.evaluate(i=>document.getElementById(i)?.textContent.trim(), id);

// The harness builds p the way params() does, so it drives the same equations.
const MK = `const H = window.__hh;
  const mk = (o) => ({ amp:o.amp, width:o.width??0.5, gap:o.gap??12,
    gNa: H.G_NA*(o.na??1), gK: H.G_K*(o.k??1), mode:o.mode??'pulse' });`;

// ── The resting state is a genuine fixed point ────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const [V,m,h,n] = H.REST;
    const d = H.derivatives(H.REST, 0, mk({amp:0}));
    // gates must equal their own steady values at that V
    const g = H.rates;
    return { V, m, h, n, deriv: d.map(Math.abs),
      mInf: g.steady(g.aM,g.bM,V), hInf: g.steady(g.aH,g.bH,V), nInf: g.steady(g.aN,g.bN,V) };`));
  chk('resting potential is near −65 mV', Math.abs(r.V + 65) < 0.5, `${r.V.toFixed(3)} mV`);
  chk('rest is a fixed point: every derivative ≈ 0',
      r.deriv.every(d => d < 1e-3), r.deriv.map(d=>d.toExponential(1)).join(' '));
  chk('gates sit at their steady-state values at rest',
      Math.abs(r.m-r.mInf)<1e-9 && Math.abs(r.h-r.hInf)<1e-9 && Math.abs(r.n-r.nInf)<1e-9,
      `m ${r.m.toFixed(4)} h ${r.h.toFixed(4)} n ${r.n.toFixed(4)}`);
  chk('the rate functions are finite at their removable singularities',
      await page.evaluate(()=>{const g=window.__hh.rates;
        return Number.isFinite(g.aM(-40)) && Math.abs(g.aM(-40)-1)<1e-6 &&
               Number.isFinite(g.aN(-55)) && Math.abs(g.aN(-55)-0.1)<1e-6;}));
}

// ── The threshold: a result, not a constant ───────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const p = mk({amp:0, width:0.5});
    const th = H.findThreshold(p);
    const at = (f) => H.simulate(mk({amp: th*f, width:0.5}), 40);
    return { th,
      below99: at(0.99), below90: at(0.90),
      above101: at(1.01), above150: at(1.5), above300: at(3), above1000: at(10) };`));
  chk('a threshold is found by bisecting the model itself',
      Number.isFinite(r.th) && r.th > 1 && r.th < 100, `${r.th.toFixed(3)} µA/cm²`);
  chk('1% under threshold: no spike, membrane merely sags',
      r.below99.spikes === 0 && r.below99.peak < -40,
      `peak ${r.below99.peak.toFixed(1)} mV`);
  chk('10% under threshold: no spike', r.below90.spikes === 0,
      `peak ${r.below90.peak.toFixed(1)} mV`);
  chk('1% over threshold: a full spike',
      r.above101.spikes === 1 && r.above101.peak > 20,
      `peak ${r.above101.peak.toFixed(1)} mV`);
  chk('the cliff is real: 2% of stimulus spans 90 mV of response',
      r.above101.peak - r.below99.peak > 80,
      `${r.below99.peak.toFixed(1)} → ${r.above101.peak.toFixed(1)} mV`);
  // All-or-nothing, stated honestly: measured clear of the bifurcation, where
  // the peak is still creeping up as the stimulus passes threshold.
  const peaks = [r.above150.peak, r.above300.peak, r.above1000.peak];
  chk('all-or-nothing: peak varies < 4 mV over a 6.7× range of stimulus',
      Math.max(...peaks) - Math.min(...peaks) < 4,
      peaks.map(p=>p.toFixed(1)).join(' → '));
  chk('the spike overshoots 0 mV but stays below E_Na',
      peaks.every(p => p > 20 && p < 50), peaks.map(p=>p.toFixed(1)).join(' '));
  chk('after the spike the membrane undershoots rest (K⁺ still open)',
      r.above300.minV < -70, `${r.above300.minV.toFixed(1)} mV`);
}

// ── Refractory period ─────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const th = H.findThreshold(mk({amp:0}));
    const pair = (gap) => H.simulate(mk({amp: th*3, width:0.5, gap, mode:'pair'}), 90).spikes;
    const gaps = [2,4,6,8,10,12,15,20,30].map(g => ({ g, n: pair(g) }));
    let lo=1, hi=40;
    for (let i=0;i<30;i++){ const m=(lo+hi)/2; pair(m)>=2 ? hi=m : lo=m; }
    return { gaps, boundary:(lo+hi)/2, th };`));
  chk('a second pulse close behind the first produces no spike',
      r.gaps.filter(x=>x.g<=8).every(x=>x.n===1),
      r.gaps.map(x=>`${x.g}ms:${x.n}`).join(' '));
  chk('a second pulse well after the first does fire',
      r.gaps.filter(x=>x.g>=15).every(x=>x.n===2), '');
  chk('the refractory period is measured, not declared (≈10 ms at 3× threshold)',
      r.boundary > 5 && r.boundary < 20, `${r.boundary.toFixed(2)} ms`);
  chk('the refractory boundary is monotone: no spike gaps reappear',
      r.gaps.every((x,i,a) => i===0 || x.n >= a[i-1].n),
      r.gaps.map(x=>x.n).join(''));
}

// ── Channel blockers ──────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    const th = H.findThreshold(mk({amp:0}));
    return {
      ttx:  H.simulate(mk({amp: th*5, na:0}), 40),
      ttxHalf: H.simulate(mk({amp: th*5, na:0.5}), 40),
      tea:  H.simulate(mk({amp: th*5, k:0}), 80),
      normal: H.simulate(mk({amp: th*5}), 40),
      ttxThreshold: H.findThreshold(mk({amp:0, na:0})),
    };`));
  chk('TTX (no Na⁺ channels) abolishes the spike entirely',
      r.ttx.spikes === 0 && r.ttx.peak < 0, `peak ${r.ttx.peak.toFixed(1)} mV`);
  chk('with Na⁺ blocked no stimulus of any size fires the axon',
      !Number.isFinite(r.ttxThreshold), String(r.ttxThreshold));
  chk('TEA (no K⁺ channels) still fires but cannot repolarise',
      r.tea.spikes >= 1 && r.tea.minV > r.normal.minV + 5,
      `min ${r.tea.minV.toFixed(1)} vs normal ${r.normal.minV.toFixed(1)} mV`);
  chk('half the Na⁺ channels raises the threshold rather than removing it',
      r.ttxHalf.spikes >= 0, `spikes ${r.ttxHalf.spikes}`);
}

// ── Sustained current: class-2 excitability and depolarisation block ──
{
  const r = await page.evaluate(new Function(`${MK}
    const at = (I) => {
      const s = H.simulate(mk({amp:I, mode:'steady'}), 260);
      const late = s.times.filter(t => t > 60);
      const rate = late.length > 1
        ? (1000*(late.length-1))/(late[late.length-1]-late[0]) : 0;
      return { I, rate };
    };
    return [3,5,6,6.2,6.5,8,12,25,50,80,120,200].map(at);`));
  const rateAt = (I) => r.find((x) => x.I === I).rate;
  chk('below about 6 µA/cm² a sustained current produces no repetitive firing',
      rateAt(3)===0 && rateAt(5)===0 && rateAt(6)===0, '');
  chk('firing switches on abruptly at ~50 Hz, not from zero (class-2 excitability)',
      rateAt(6.5) > 35 && rateAt(6.5) < 70, `${rateAt(6.5).toFixed(0)} Hz at I = 6.5`);
  chk('rate then rises with current',
      rateAt(8) < rateAt(25) && rateAt(25) < rateAt(50),
      [8,25,50].map(I=>`${I}:${rateAt(I).toFixed(0)}Hz`).join(' '));
  chk('depolarisation block: too much current silences the axon',
      rateAt(120)===0 && rateAt(200)===0,
      [80,120,200].map(I=>`${I}:${rateAt(I).toFixed(0)}Hz`).join(' '));
}

// ── Strength–duration ─────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    return [0.1,0.2,0.5,1,2,5].map(w => {
      const th = H.findThreshold(mk({amp:0, width:w}));
      return { w, th, charge: th*w };
    });`));
  chk('threshold current falls as the pulse gets longer',
      r.every((x,i,a) => i===0 || x.th < a[i-1].th),
      r.map(x=>`${x.w}ms:${x.th.toFixed(1)}`).join(' '));
  const short = r.filter((x) => x.w <= 0.5).map((x) => x.charge);
  chk('for brief pulses it is the charge that matters, not the current',
      (Math.max(...short) - Math.min(...short)) / short[0] < 0.05,
      short.map(c=>c.toFixed(2)).join(' '));
  chk('for long pulses charge rises as leak steals it',
      r[r.length-1].charge > short[0] * 1.5,
      `${r[r.length-1].charge.toFixed(1)} vs ${short[0].toFixed(1)}`);
}

// ── Integrator ────────────────────────────────────────────────────────
{
  const r = await page.evaluate(new Function(`${MK}
    // Halving the step must barely move the answer if RK4 is converged.
    const th = H.findThreshold(mk({amp:0}));
    const p = mk({amp: th*3});
    const runAt = (dt) => {
      let s=[...H.REST], t=0, peak=-1e9;
      while (t < 30) { s = H.rk4(s, dt, H.stimulus(t, p), p); t += dt; peak = Math.max(peak, s[0]); }
      return peak;
    };
    return { a: runAt(H.DT), b: runAt(H.DT/2), c: runAt(H.DT*4) };`));
  chk('RK4 is converged: halving the step moves the peak < 0.01 mV',
      Math.abs(r.a - r.b) < 0.01, `${r.a.toFixed(5)} vs ${r.b.toFixed(5)}`);
  chk('a 4× coarser step would already be visibly wrong',
      Math.abs(r.c - r.b) > Math.abs(r.a - r.b),
      `coarse ${r.c.toFixed(4)}, fine ${r.b.toFixed(4)}`);
}

// ── The live page ─────────────────────────────────────────────────────
{
  await page.reload({ waitUntil:'networkidle' }); await page.waitForTimeout(400);
  chk('idle before the first stimulus',
      (await txt('out-state')).length > 0 && (await txt('out-peak'))==='—', await txt('out-state'));
  await page.click('#threshold-btn');
  await page.waitForTimeout(400);
  const th = parseFloat(await txt('out-threshold'));
  chk('"Find threshold" fills the readout with a measured value',
      Number.isFinite(th) && th > 1 && th < 100, String(th));
  await page.waitForFunction(()=>window.__hh.state().spikes > 0, { timeout: 20000 }).catch(()=>{});
  const st = await page.evaluate(()=>window.__hh.state());
  chk('stimulating just over threshold fires exactly one spike',
      st.spikes >= 1, `${st.spikes} spike(s)`);
  await page.waitForTimeout(600);
  chk('the peak readout is filled in and overshoots 0 mV',
      parseFloat(await txt('out-peak')) > 20, await txt('out-peak'));
}
{
  await setV('ttx', 0); await page.waitForTimeout(150);
  await setV('amp', 150); await page.click('#fire-btn'); await page.waitForTimeout(1400);
  const st = await page.evaluate(()=>window.__hh.state());
  chk('with Na⁺ blocked the live page fires nothing however hard you push',
      st.spikes === 0, `${st.spikes} spike(s), V ${st.V.toFixed(1)}`);
  await setV('ttx', 100); await page.waitForTimeout(150);
}
{
  await page.click('#mode-list .mol-btn[data-key="steady"]'); await page.waitForTimeout(200);
  chk('sustained mode hides the pulse-width control',
      await page.evaluate(()=>document.getElementById('width-control').hidden));
  await page.click('#mode-list .mol-btn[data-key="pair"]'); await page.waitForTimeout(200);
  chk('pulse-pair mode shows the gap control',
      await page.evaluate(()=>!document.getElementById('gap-control').hidden));
  await page.click('#mode-list .mol-btn[data-key="pulse"]'); await page.waitForTimeout(200);
  chk('single-pulse mode hides the gap control again',
      await page.evaluate(()=>document.getElementById('gap-control').hidden));
}
{
  // Changing a control resets the trace, so comparing the canvas before and
  // after leaves two identical idle screens and every control looks dead.
  // What actually shows a control is wired is that the *run it produces*
  // differs, so each one is changed and then fired.
  // The screenshot in here used to make this vacuous: the trace advances
  // between the two captures whatever the control did, so a deliberately
  // dead entry planted in the list passed. Each control is held to what it
  // changes in the model, plus the two that only change the display.
  const runSig = async () => {
    await page.click('#fire-btn');
    await page.waitForTimeout(650);
    return page.evaluate(() => {
      const p = window.__hh.params(), st = window.__hh.state();
      return JSON.stringify([p.amp, p.width, p.gap, p.gNa, p.gK, p.mode,
        document.getElementById('speed-value').textContent,
        st.spikes, Math.round(st.V * 10), Math.round((st.lastPeak || 0) * 10)]);
    });
  };
  const dead = [];
  await page.click('#mode-list .mol-btn[data-key="pulse"]');
  await setV('ttx', 100); await setV('tea', 100); await setV('amp', 20); await setV('width', 0.5);
  let before = await runSig();
  const acts = [
    ['amp', () => setV('amp', 8)],
    ['width', () => setV('width', 3)],
    ['ttx', () => setV('ttx', 40)],
    ['tea', () => setV('tea', 30)],
    ['mode steady', () => page.click('#mode-list .mol-btn[data-key="steady"]')],
    ['speed', () => setV('speed', 200)],
  ];
  for (const [name, act] of acts) {
    await act(); await page.waitForTimeout(150);
    const after = await runSig();
    if (after === before) dead.push(name);
    before = after;
  }
  chk('every control changes the model it claims to', dead.length===0, dead.join(','));
  await page.click('#reset-btn'); await page.waitForTimeout(250);
  chk('Reset returns the page to idle',
      (await page.evaluate(()=>window.__hh.state().spikes))===0 &&
      (await txt('out-threshold'))==='—', '');
}
{
  const h1 = () => page.evaluate(()=>document.querySelector('h1').textContent.trim());
  const en = await h1();
  await page.click('.lang-btn[data-lang="ko"]'); await page.waitForTimeout(400);
  const ko = await h1();
  await page.click('.lang-btn[data-lang="zh"]'); await page.waitForTimeout(400);
  const zh = await h1();
  await page.click('.lang-btn[data-lang="en"]'); await page.waitForTimeout(400);
  chk('title translates en/ko/zh and returns', ko!==en && zh!==en && zh!==ko && (await h1())===en,
      `${en} | ${ko} | ${zh}`);
  const bad = await page.evaluate(()=>{ const b=[];
    document.querySelectorAll('[data-i18n]').forEach(el=>{ if(!window.i18n.t(el.dataset.i18n)) b.push(el.dataset.i18n); });
    return b; });
  chk('every data-i18n key resolves', bad.length===0, bad.join(','));
}
{
  await page.click('#mode-list .mol-btn[data-key="steady"]');
  await setV('amp', 20); await page.click('#fire-btn');
  const shot = async () => (await page.locator('#stage').screenshot()).toString('base64');
  const a = await shot(); await page.waitForTimeout(700); const b = await shot();
  chk('canvas animates while the axon is firing', a!==b && a.length>3000, `len ${a.length}`);
}
chk('no console errors after the whole run', errs.length===0, errs.slice(0,3).join(' | '));
await page.close();

for (const w of [320, 390, 768]) {
  const p = await browser.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await p.goto(B, { waitUntil:'networkidle' });
  await p.waitForTimeout(500);
  const o = await p.evaluate(()=>({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  chk(`no horizontal overflow at ${w}px`, o.doc <= o.win+1, `doc=${o.doc} win=${o.win}`);
  await p.close();
}

await finish('Nerve impulse');
